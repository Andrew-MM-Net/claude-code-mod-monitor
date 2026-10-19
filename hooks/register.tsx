import { atom, read, update } from 'claude-code'
import type { Color, Register, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { Activity, Meter } from '../types'
import {
  bar,
  clip,
  countdown,
  describe,
  elapsed,
  expectedPercent,
  fill,
  forecast,
  levelColor,
  limitLabel,
  modelLabel,
  paceOf,
  rule,
  SUMMARY_SYSTEM,
  summaryPrompt,
  tokens,
} from './lib'
import type { Pace, Sample } from './lib'

const PANE = 'mod-monitor'
// The card's edges, and the darker groove the meters fill along.
const EDGE = '#4a5263'
const TRACK = '#333a47'

// One styled run of a card row; its length is its width in cells.
type Seg = { text: string; color?: Color; dim?: boolean; bold?: boolean }

// The glyph after a limit's percent: ahead of, on, or behind an even burn through its window.
const PACE: Record<Pace, { glyph: string; color: Color }> = {
  over: { glyph: '▲', color: 'error' },
  on: { glyph: '●', color: 'success' },
  under: { glyph: '▼', color: 'suggestion' },
}

// A meter's runs, with a tick at `mark` percent: where an even burn would be now.
const meterSegs = (percent: number, width: number, color: Color, mark: number | null): Seg[] => {
  const { fill: done, track } = bar(percent, width)
  if (mark === null) return [{ text: done, color }, { text: track, color: TRACK }]
  const cells = [...done, ...track].map(c => ({ text: c, color }) as Seg)
  cells.forEach((c, i) => i >= done.length && (c.color = TRACK))
  cells[Math.min(width - 1, Math.floor((mark / 100) * width))] = { text: '┃', color: 'text', bold: true }
  return cells.reduce<Seg[]>((runs, c) => {
    const last = runs[runs.length - 1]
    if (last && last.color === c.color && last.bold === c.bold) last.text += c.text
    else runs.push({ ...c })
    return runs
  }, [])
}

const meter = atom({ plugin: 'mod-monitor', key: 'meter' } as const, null)
const now = atom({ plugin: 'mod-monitor', key: 'now' } as const, null)
const feed = atom({ plugin: 'mod-monitor', key: 'feed' } as const, [])
const goal = atom({ plugin: 'mod-monitor', key: 'goal' } as const, null)
const summary = atom({ plugin: 'mod-monitor', key: 'summary' } as const, null)
const isSummarizing = atom({ plugin: 'mod-monitor', key: 'isSummarizing' } as const, false)
const isSummaryOn = atom({ plugin: 'mod-monitor', key: 'isSummaryOn' } as const, true)
const aiUsage = atom({ plugin: 'mod-monitor', key: 'aiUsage' } as const, { calls: 0, input: 0, output: 0 })
const tick = atom({ plugin: 'mod-monitor', key: 'tick' } as const, 0)

const toMeter = (u: SessionUsage | SessionMeasureInput): Meter => ({
  limits: u.rateLimits.map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt })),
  contextPercent: u.context.percent,
  contextTokens: u.context.tokens,
  contextWindow: u.context.window,
  costUsd: u.cost?.usd,
})

export const register: Register = on => {
  let turnStart = 0
  let startedAt = 0
  // Recent 5h readings, for the "full in" forecast.
  let fiveHour: Sample[] = []
  const sample = (m: Meter, at: number) => {
    const percent = m.limits.find(l => l.kind === 'five_hour')?.percent
    if (percent === undefined) return
    // A drop means the window reset: the old pace no longer applies.
    const last = fiveHour[fiveHour.length - 1]
    if (last && percent < last.percent) fiveHour = []
    fiveHour = [...fiveHour.filter(s => at - s.at <= 60 * 60_000), { at, percent }]
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'monitor',
      description: 'Open the monitor pane. "/monitor off" or "/monitor on" turns the AI turn summary off or on.',
    })
    void $.session.usage().then(async u => {
      startedAt = u.startedAt
      sample(toMeter(u), await $.clock.now())
      await update($, meter, () => toMeter(u))
    })
    // Redraw once a minute so the reset countdowns move.
    $.clock.every(60_000, () => {
      void update($, tick, n => n + 1)
    })
    void $.ui.open({ id: PANE, title: 'Monitor' })

    return next(e)
  })

  on('command.run', { command: 'monitor' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isSummaryOn, () => arg === 'on')
      return { text: `AI turn summaries ${arg === 'on' ? 'on' : 'off'}.` }
    }
    await $.ui.open({ id: PANE, title: 'Monitor' })
    return { text: 'Monitor pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    sample(toMeter(e), await $.clock.now())
    await update($, meter, () => toMeter(e))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined) {
      turnStart = await $.clock.now()
      await update($, goal, () => clip(e.text, 200))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    const text = (e.agentId ? '↳ ' : '') + describe(String(e.tool), args)
    const item: Activity = { id: e.tool_use_id, at: await $.clock.now(), text, state: 'running' }
    if (!e.agentId) await update($, now, () => text)
    await update($, feed, list => [...list, item].slice(-60))

    const ran = await next(e)

    const state: Activity['state'] = ran.deny !== undefined || ran.isError ? 'error' : 'done'
    await update($, feed, list => list.map(a => (a.id === item.id ? { ...a, state } : a)))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, now, () => null)
      const answer = e.answer
      // Summarize off the turn's own dispatch, so the turn ends right away.
      $.clock.after(0, () => {
        void (async () => {
          if (!(await read($, isSummaryOn))) return
          const steps = (await read($, feed)).filter(a => a.at >= turnStart).map(a => a.text).slice(-20)
          await update($, isSummarizing, () => true)
          try {
            const reply = await $.model.complete({
              model: 'haiku',
              system: SUMMARY_SYSTEM,
              prompt: summaryPrompt(await read($, goal), steps, answer),
              maxTokens: 120,
              effort: 'low',
            })
            if (reply.isAnswered) {
              const u = reply.usage
              await update($, aiUsage, a => ({
                calls: a.calls + 1,
                input: a.input + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
                output: a.output + u.output_tokens,
              }))
            }
            if (reply.isAnswered && reply.text.trim()) {
              await update($, summary, () => clip(reply.text, 300))
            }
          } finally {
            // A failed call must not leave the pane saying "updating…" forever.
            await update($, isSummarizing, () => false)
          }
        })()
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const m = await read($, meter)
    const doing = await read($, now)
    const said = await read($, summary)
    const model = modelLabel(await $.session.model())
    const clock = await $.clock.now()

    // A rounded card drawn by hand, so the title and model can sit in its top edge.
    const cols = e.props.bodyColumns
    const inner = cols - 2
    const limits = m?.limits ?? []
    const SEP: Seg = { text: ' │', color: EDGE }
    const widthOf = (segs: Seg[]) => segs.reduce((n, s) => n + s.text.length, 0)

    const limitSegs = (w: number): Seg[] =>
      limits.length === 0
        ? [{ text: ' limits: waiting for first reply', dim: true }, SEP]
        : limits.flatMap(l => {
            const resetsIn = l.resetsAt ? Date.parse(l.resetsAt) - clock : undefined
            const resets = resetsIn !== undefined ? countdown(resetsIn) : ''
            const expected = expectedPercent(l.kind, resetsIn)
            const pace = expected === null ? null : PACE[paceOf(l.percent, expected)]
            return [
              { text: ` ${limitLabel(l.kind)} `, dim: true },
              ...meterSegs(l.percent, w, levelColor(l.percent), expected),
              { text: ` ${String(Math.round(l.percent)).padStart(3)}%`, color: levelColor(l.percent), bold: true },
              ...(pace ? [{ text: ` ${pace.glyph}`, color: pace.color, bold: true }] : []),
              { text: ` ${resets.padEnd(6)}`, dim: true },
              SEP,
            ]
          })

    const pct = m?.contextPercent
    const ctxPlain: Seg[] =
      pct === undefined ? [] : [{ text: ' ctx ', dim: true }, { text: `${pct}%`, color: levelColor(pct), bold: true }, SEP]
    // On a wide band: a mini meter and the token count, lavender until it nears full.
    const ctxColor: Color = pct !== undefined && pct >= 70 ? levelColor(pct) : 'permission'
    const ctxRich: Seg[] =
      pct === undefined || m?.contextTokens === undefined || !m.contextWindow
        ? ctxPlain
        : [
            { text: ' ctx ', dim: true },
            { text: bar(pct, 8).fill, color: ctxColor },
            { text: bar(pct, 8).track, color: TRACK },
            { text: ` ${pct}%`, color: ctxColor, bold: true },
            { text: ` ${tokens(m.contextTokens)}/${tokens(m.contextWindow)}`, dim: true },
            SEP,
          ]

    const usd = m?.costUsd
    const ran = startedAt > 0 ? clock - startedAt : 0
    const costPlain: Seg[] = usd === undefined ? [] : [{ text: ` $${usd.toFixed(2)}` }, SEP]
    const costRich: Seg[] =
      usd === undefined
        ? []
        : [
            { text: ` $${usd.toFixed(2)}`, bold: true },
            ...(ran >= 5 * 60_000 ? [{ text: ` ≈$${(usd / (ran / 3_600_000)).toFixed(2)}/h`, dim: true }] : []),
            SEP,
          ]
    const session: Seg[] = ran > 0 ? [{ text: ' ◷ ', dim: true }, { text: countdown(ran) }, SEP] : []

    const steps = turnStart > 0 ? (await read($, feed)).filter(a => a.at >= turnStart) : []
    const failed = steps.filter(a => a.state === 'error').length
    const tally: Seg[] = steps.length
      ? [
          { text: ' ✓', color: 'success' },
          { text: `${steps.length - failed} `, color: 'success', bold: true },
          { text: '✗', color: failed ? 'error' : undefined, dim: !failed },
          { text: `${failed}`, color: failed ? 'error' : undefined, dim: !failed, bold: failed > 0 },
          SEP,
        ]
      : []

    const five = limits.find(l => l.kind === 'five_hour')
    const eta = five ? forecast(fiveHour, clock, five.resetsAt ? Date.parse(five.resetsAt) - clock : undefined) : null
    const pace: Seg[] =
      eta === null
        ? []
        : [
            { text: ' 5h full in ', dim: true },
            { text: eta === 0 ? 'now' : `~${countdown(eta)}`, color: 'warning', bold: true },
            { text: ' at this pace', dim: true },
            SEP,
          ]

    // The mod's own Haiku summary calls this session: count, then tokens in and out.
    const own = await read($, aiUsage)
    const ai: Seg[] = own.calls
      ? [
          { text: ' ✦ ', color: 'permission' },
          { text: `${own.calls}×`, bold: true },
          { text: ` ${tokens(own.input)} in · ${tokens(own.output)} out`, dim: true },
          SEP,
        ]
      : []

    // The richest row that fits; a narrow band falls back to the plain one with shrinking meters.
    const wide = limitSegs(12)
    const stats = [
      [...wide, ...ctxRich, ...costRich, ...session, ...tally, ...pace, ...ai],
      [...wide, ...ctxRich, ...costRich, ...session, ...tally, ...ai],
      [...wide, ...ctxRich, ...costRich, ...session, ...tally],
      [...wide, ...ctxRich, ...costRich, ...session],
      [...wide, ...ctxRich, ...costPlain],
    ].find(segs => widthOf(segs) <= inner) ?? [
      ...limitSegs(Math.max(4, Math.min(12, Math.floor((inner - 20 * limits.length - 20) / Math.max(1, limits.length))))),
      ...ctxPlain,
      ...costPlain,
    ]

    const tail = turnStart > 0 ? `  ${elapsed(clock - turnStart)}` : ''
    const status: Seg[] | null =
      e.props.isWorking && doing
        ? [
            { text: ' ● ', color: 'claude' },
            { text: clip(doing, inner - 4 - tail.length) },
            { text: tail, dim: true },
          ]
        : !e.props.isWorking && said
          ? [
              { text: ' ✓ ', color: 'success', bold: true },
              { text: clip(said, inner - 4), dim: true },
            ]
          : null

    const row = (segs: Seg[]) => (
      <Text wrap="truncate-end">
        <Text color={EDGE}>│</Text>
        {segs.map(s => (
          <Text color={s.color} dimColor={s.dim} bold={s.bold}>
            {s.text}
          </Text>
        ))}
        <Text>{fill(widthOf(segs), inner)}</Text>
        <Text color={EDGE}>│</Text>
      </Text>
    )

    return (
      <Box flexDirection="column" width="100%">
        <Text wrap="truncate-end">
          <Text color={EDGE}>╭─</Text>
          <Text color="claude" bold>
            {' monitor '}
          </Text>
          <Text color={EDGE}>{rule('─', cols - 16 - model.length)}</Text>
          <Text> </Text>
          <Text color="success" bold>{model}</Text>
          <Text> </Text>
          <Text color={EDGE}>──╮</Text>
        </Text>
        {row(stats)}
        {status && <Text color={EDGE}>├{rule('─', inner)}┤</Text>}
        {status && row(status)}
        <Text color={EDGE}>╰{rule('─', inner)}╯</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const asked = await read($, goal)
    const said = await read($, summary)
    const busy = await read($, isSummarizing)
    const isOn = await read($, isSummaryOn)
    const list = await read($, feed)
    const room = Math.max(3, e.props.scroll.bodyRows - 9)
    const heading = (icon: string, label: string, color: Color, note?: string) => (
      <Text wrap="truncate-end">
        <Text color={color} bold>
          {icon} {label}
        </Text>
        {note && <Text dimColor> · {note}</Text>}
      </Text>
    )

    return (
      <Box flexDirection="column" backgroundColor="black" width="100%" minHeight={e.props.scroll.bodyRows}>
        {heading('◆', 'TASK', 'suggestion')}
        <Text wrap="wrap">{asked ?? 'Nothing asked yet.'}</Text>
        <Text> </Text>
        {heading('✦', 'SUMMARY', 'permission', busy ? 'updating…' : isOn ? undefined : 'off')}
        <Text wrap="wrap" dimColor={!said}>
          {isOn ? (said ?? 'Appears after the first turn finishes.') : 'Off. Type /monitor on to turn it back on.'}
        </Text>
        <Text> </Text>
        {heading('▶', 'ACTIVITY', 'claude', list.length ? `${list.length} steps` : undefined)}
        {list.length === 0 && <Text dimColor>No tool calls yet.</Text>}
        {list.slice(-room).map(a => (
          <Text
            wrap="truncate-end"
            color={a.state === 'error' ? 'error' : a.state === 'running' ? 'claude' : 'success'}
          >
            {a.state === 'running' ? '●' : a.state === 'error' ? '✗' : '✓'} {a.text}
          </Text>
        ))}
      </Box>
    )
  })
}
