import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bar, countdown, describe as describeCall, elapsed, expectedPercent, fill, forecast, levelColor, limitLabel, meterSvg, modelLabel, paceOf, parseGitStatus, remoteLabel, rule, sparkSvg, tokens } from '../hooks/lib'

const GIT_STATUS = [
  '# branch.oid 5d58157aa0b1c2d3e4f5',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb hooks/lib.ts',
  '? x-launchpad.py',
  '',
].join('\n')

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
const engine = (on: Parameters<TestBody>[1], surfaces: string[]) => {
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

test('in the desktop app, the band is drawn its own way and there is no pane', async ($, on) => {
  engine(on, ['desktop'])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/cave.js' } as never)

  const band = await $.ui.mount({ plugin: 'mod-monitor', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: /Reading cave\.js/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'opus-5-5' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /waiting for first reply/ })).toBeDefined()
  // None of the terminal card's hand-drawn edges.
  expect(await band.find({ type: 'Text', text: /[╭╰│]/ })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'mod-monitor', surface: 'desktop', component: 'Pane', requestId: 'mod-monitor', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text' }))?.text).toBe('engine')
  await pane.unmount()
})

test('where nothing draws (-p), the mod stays out of the way', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: false } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/cave.js' } as never)

  const band = await $.ui.mount({ plugin: 'mod-monitor', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
})

test('git status and remotes read as the card shows them', () => {
  expect(parseGitStatus(GIT_STATUS)).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, changed: 2 })
  expect(parseGitStatus('# branch.oid 5d58157aa0b1\n# branch.head (detached)\n')).toEqual({
    branch: '@5d58157',
    upstream: null,
    ahead: 0,
    behind: 0,
    changed: 0,
  })
  expect(parseGitStatus('')).toBeNull()
  expect(remoteLabel('https://github.com/Andrew-MM-Net/claude-code-mod-monitor.git')).toBe('Andrew-MM-Net/claude-code-mod-monitor')
  expect(remoteLabel('git@github.com:owner/repo.git')).toBe('owner/repo')
  expect(remoteLabel('ssh://git@gitlab.example.com:2222/team/app.git')).toBe('gitlab.example.com/team/app')
  expect(remoteLabel('D:\\repos\\app')).toBe('D:\\repos\\app')
})

test('in the CLI, the card edge and the pane show the branch and remote', async ($, on) => {
  engine(on, ['terminal'])
  on('process.run', () => ({ value: { exitCode: 0, stdout: GIT_STATUS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('session.repo', () => ({ value: { root: '/', remote: 'https://github.com/owner/repo.git', internal: false, name: null } }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)

  const band = await $.ui.mount({ plugin: 'mod-monitor', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 120 } })
  expect(await band.find({ type: 'Text', text: 'main' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' ↑2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'owner/repo' })).toBeDefined()
  await band.unmount()

  // A narrow card keeps the branch and drops the remote.
  const narrow = await $.ui.mount({ plugin: 'mod-monitor', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 50 } })
  expect(await narrow.find({ type: 'Text', text: 'main' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: 'owner/repo' })).toBeUndefined()
  await narrow.unmount()

  const pane = await $.ui.mount({ plugin: 'mod-monitor', surface: 'terminal', component: 'Pane', requestId: 'mod-monitor', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /GIT/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: ' → origin/main' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'origin https://github.com/owner/repo.git' })).toBeDefined()
  await pane.unmount()
})

test('in the desktop app, the band shows the branch and remote', async ($, on) => {
  engine(on, ['desktop'])
  on('process.run', () => ({ value: { exitCode: 0, stdout: GIT_STATUS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('session.repo', () => ({ value: { root: '/', remote: 'git@github.com:owner/repo.git', internal: false, name: null } }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)

  const band = await $.ui.mount({ plugin: 'mod-monitor', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: 'main' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' ↑2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' · owner/repo' })).toBeDefined()
  await band.unmount()
})

test('desktop drawings: meter and sparkline SVGs', () => {
  const meter = meterSvg(62, 88, '#000', 48)
  expect(meter).toContain('width="55"')
  expect(meter).toContain('x="41"')
  expect(meterSvg(0, 88, '#000', null)).not.toContain('fill="#000"')
  expect(sparkSvg([{ at: 0, percent: 10 }], 0, 120, 20, '#000')).toBeNull()
  const spark = sparkSvg([{ at: -60 * 60_000, percent: 10 }, { at: 0, percent: 20 }], 0, 120, 20, '#000')
  expect(spark).toContain('points="0.0,18.0 120.0,2.0"')
})
