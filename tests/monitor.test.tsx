import { describe, expect, mock, test } from 'claude-code/testing'

import { bar, countdown, describe as describeCall, elapsed, expectedPercent, fill, forecast, levelColor, limitLabel, modelLabel, paceOf, rule, tokens } from '../hooks/lib'

const PANE_PROPS = {
  title: 'Monitor',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

describe('helpers', () => {
  test('meter bar, colors, labels and countdowns', async () => {
    expect(bar(50, 10)).toEqual({ fill: '█████', track: '█████' })
    expect(bar(120, 4)).toEqual({ fill: '████', track: '' })
    expect(bar(55, 10)).toEqual({ fill: '█████▌', track: '████' })
    expect(levelColor(10)).toBe('success')
    expect(levelColor(75)).toBe('warning')
    expect(levelColor(95)).toBe('error')
    expect(limitLabel('five_hour')).toBe('5h')
    expect(limitLabel('seven_day')).toBe('7d')
    expect(countdown(2 * 3_600_000 + 13 * 60_000)).toBe('2h13m')
    expect(countdown(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d4h')
  })

  test('tool calls read as plain language', async () => {
    expect(describeCall('Read', { file_path: 'D:\\game\\src\\cave.js' })).toBe('Reading cave.js')
    expect(describeCall('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Running: Run tests')
    expect(describeCall('mcp__claude_ai_Gmail__search_threads', {})).toBe('Using Gmail: search threads')
  })

  test('card edges and elapsed time', async () => {
    expect(rule('─', 3)).toBe('───')
    expect(rule('─', -2)).toBe('')
    expect(fill(7, 10)).toBe('   ')
    expect(elapsed(12_400)).toBe('12s')
    expect(elapsed(185_000)).toBe('3m05s')
  })

  test('token counts and the 5h forecast', async () => {
    expect(tokens(62_400)).toBe('62k')
    expect(tokens(1_000_000)).toBe('1.0M')
    const min = 60_000
    const climbing = [{ at: 0, percent: 40 }, { at: 20 * min, percent: 50 }]
    // 10% per 20 min from 50%: full 100 minutes after the last reading.
    expect(forecast(climbing, 20 * min)).toBe(100 * min)
    expect(forecast(climbing, 20 * min, 60 * min)).toBeNull()
    expect(forecast([{ at: 0, percent: 40 }, { at: 5 * min, percent: 50 }], 5 * min)).toBeNull()
    expect(forecast([{ at: 0, percent: 50 }, { at: 20 * min, percent: 50 }], 20 * min)).toBeNull()
  })

  test('pace against an even burn through the window', async () => {
    const day = 86_400_000
    // 7d window with 3.5 days left: half way, so 50% is on track.
    expect(expectedPercent('seven_day', 3.5 * day)).toBe(50)
    expect(expectedPercent('five_hour', 5 * 3_600_000)).toBe(0)
    expect(expectedPercent('spend_limit', day)).toBeNull()
    expect(expectedPercent('seven_day')).toBeNull()
    expect(paceOf(70, 50)).toBe('over')
    expect(paceOf(53, 50)).toBe('on')
    expect(paceOf(30, 50)).toBe('under')
  })

  test('model label drops the claude- prefix', async () => {
    expect(modelLabel('claude-opus-5-5')).toBe('opus-5-5')
    expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
  })
})

// Stands in for the engine for a session drawn on `surfaces`.
const engine = (on: Parameters<Parameters<typeof test>[1]>[1], surfaces: string[]) => {
  mock.clock(on)
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { percent: 0, tokens: 0, window: 200_000 } } }) as never)
  on('command.register', () => ({ value: { command: 'monitor' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  // What the engine draws when the mod leaves a drawing to it.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

test('in the CLI, a tool call shows in the activity pane and as "now" in the band', async ($, on) => {
  engine(on, ['terminal'])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/cave.js' } as never)

  const pane = await $.ui.mount({ plugin: 'mod-monitor', surface: 'terminal', component: 'Pane', requestId: 'mod-monitor', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /Reading cave\.js/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /opus-5-5/ })).toBeUndefined()
  await pane.unmount()

  const band = await $.ui.mount({ plugin: 'mod-monitor', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: /waiting for first reply/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'opus-5-5' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Reading cave\.js/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' monitor ' })).toBeDefined()
  await band.unmount()
})

test('in the desktop app, the mod stays out of the way', async ($, on) => {
  engine(on, ['desktop'])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/cave.js' } as never)

  for (const [component, props] of [['Pane', PANE_PROPS], ['AbovePrompt', BAND_PROPS]] as const) {
    const ui = await $.ui.mount({ plugin: 'mod-monitor', surface: 'desktop', component, requestId: 'mod-monitor', props } as never)
    expect(await ui.find({ type: 'Text', text: /Reading cave\.js/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})
