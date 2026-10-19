// Pure helpers: no `$`, so the tests can call them directly.

export const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A solid meter: `fill` is drawn in the level color, `track` (solid blocks) dimmed behind it.
export const bar = (percent: number, width: number): { fill: string; track: string } => {
  const eighths = Math.max(0, Math.min(width * 8, Math.round((percent / 100) * width * 8)))
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8]!
  return { fill: '█'.repeat(full) + part, track: '█'.repeat(width - full - (part ? 1 : 0)) }
}

export const levelColor = (percent: number): 'success' | 'warning' | 'error' =>
  percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

export const limitLabel = (kind: string): string =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind === 'spend_limit' ? 'spend' : kind

export const countdown = (ms: number): string => {
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

const base = (path: unknown): string =>
  typeof path === 'string' ? (path.split(/[\\/]/).pop() ?? path) : 'a file'

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

// One plain-language line for a tool call, from its name and arguments.
export const describe = (tool: string, args: Record<string, unknown>): string => {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return `Running: ${clip(str(args.description) || str(args.command), 60)}`
    case 'Read':
      return `Reading ${base(args.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${base(args.file_path)}`
    case 'Write':
      return `Writing ${base(args.file_path)}`
    case 'NotebookEdit':
      return `Editing notebook ${base(args.notebook_path)}`
    case 'Grep':
      return `Searching code for "${clip(str(args.pattern), 40)}"`
    case 'Glob':
      return `Finding files ${clip(str(args.pattern), 40)}`
    case 'WebSearch':
      return `Searching the web: ${clip(str(args.query), 50)}`
    case 'WebFetch': {
      const url = str(args.url)
      try {
        return `Fetching ${new URL(url).host}`
      } catch {
        return 'Fetching a web page'
      }
    }
    case 'Agent':
    case 'Task':
      return `Started a helper agent: ${clip(str(args.description), 50)}`
    case 'Skill':
      return `Using skill ${str(args.skill)}`
    case 'ToolSearch':
      return 'Loading tools'
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
      if (mcp) return `Using ${mcp[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ')}: ${mcp[2]!.replace(/_/g, ' ')}`
      return `Using ${tool}`
    }
  }
}

export const summaryPrompt = (goal: string | null, steps: readonly string[], answer: string): string =>
  [
    `The user asked: ${goal ? clip(goal, 400) : '(unknown)'}`,
    '',
    'Steps the coding assistant took:',
    ...(steps.length ? steps.map(s => `- ${s}`) : ['- (no tool calls)']),
    '',
    `Its final reply (may be cut): ${clip(answer, 1500)}`,
  ].join('\n')

export const SUMMARY_SYSTEM =
  'You write a status line for someone watching a coding assistant work. ' +
  'In one or two short, plain sentences, say what was just done and where things stand. ' +
  'No preamble, no markdown, under 40 words.'

// A short model label: "claude-opus-5-5[1m]" reads as "opus-5-5[1m]".
export const modelLabel = (model: string): string => model.replace(/^claude-/, '').trim() || model

// Repeats a box-drawing run, never negative (a narrow band just loses the run).
export const rule = (char: string, count: number): string => char.repeat(Math.max(0, count))

// Spaces that fill a card row out to `inner` cells, given what it already holds.
export const fill = (used: number, inner: number): string => rule(' ', inner - used)

// Time since the turn began: "12s", "3m05s".
export const elapsed = (ms: number): string => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`
}

// A token count as the band shows it: "310", "62k", "1.2M".
export const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n < 1000 ? String(n) : `${Math.round(n / 1000)}k`

export type Sample = { at: number; percent: number }

// When a limit will fill at its recent pace, in ms from `now`, or null when it isn't
// climbing, there's under 10 minutes of history, or it resets first.
export const forecast = (samples: readonly Sample[], now: number, resetsIn?: number): number | null => {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last || last.at - first.at < 10 * 60_000 || last.percent <= first.percent) return null
  const perMs = (last.percent - first.percent) / (last.at - first.at)
  const eta = (100 - last.percent) / perMs - (now - last.at)
  if (eta <= 0) return 0
  return resetsIn !== undefined && eta >= resetsIn ? null : eta
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

// Where an even burn through the window would have the meter now, or null for a
// limit with no known window length or reset time.
export const expectedPercent = (kind: string, resetsIn?: number): number | null => {
  const window = WINDOW_MS[kind]
  if (window === undefined || resetsIn === undefined) return null
  return Math.max(0, Math.min(100, (1 - resetsIn / window) * 100))
}

export type Pace = 'over' | 'on' | 'under'

// Within 5 points of the even-burn line counts as on track.
export const paceOf = (percent: number, expected: number): Pace =>
  percent - expected > 5 ? 'over' : expected - percent > 5 ? 'under' : 'on'
