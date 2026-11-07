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

export type GitStatus = { branch: string; upstream: string | null; ahead: number; behind: number; changed: number }

// `git status --porcelain=v2 --branch` read as the branch, its upstream, how far
// ahead and behind it is, and how many paths are changed or untracked.
export const parseGitStatus = (out: string): GitStatus | null => {
  let oid = ''
  let head = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith('# branch.oid ')) oid = line.slice(13)
    else if (line.startsWith('# branch.head ')) head = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const ab = /\+(\d+) -(\d+)/.exec(line)
      if (ab) {
        ahead = Number(ab[1])
        behind = Number(ab[2])
      }
    } else if (!line.startsWith('#')) changed++
  }
  if (!head) return null
  const branch = head === '(detached)' ? `@${oid.slice(0, 7)}` : head
  return { branch, upstream, ahead, behind, changed }
}

// A remote URL as the card shows it: "owner/repo" on GitHub, "host/owner/repo" elsewhere.
export const remoteLabel = (url: string): string => {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+(?=\/))?[:/](.+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (!m || m[1]!.length === 1) return url // no host, or a Windows drive path
  return m[1] === 'github.com' ? m[2]! : `${m[1]}/${m[2]}`
}

// Time since the turn began: "12s", "3m05s".
export const elapsed = (ms: number): string => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`
}

// A token count as the band shows it: "62k", "1.2M".
export const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`

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

// Colors for the desktop's SVG drawings: they are drawn as images, so they can't
// follow the theme's keys. Mid tones that read on both a light and a dark theme.
export const HEX = {
  success: '#5fae63',
  warning: '#d9962b',
  error: '#e0584f',
  permission: '#9a8cf0',
  mark: '#9a9890',
  track: '#8a887f',
} as const

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// A rounded meter as an SVG document: filled to `percent`, with a tick at `mark`
// (where an even burn would be now) when there is one.
export const meterSvg = (percent: number, width: number, color: string, mark: number | null): string => {
  const done = Math.round((clamp(percent, 0, 100) / 100) * width)
  const fillRect = done > 0 ? `<rect x="0" y="3" width="${done}" height="6" rx="3" fill="${color}"/>` : ''
  const tick =
    mark === null
      ? ''
      : `<rect x="${clamp(Math.round((mark / 100) * width) - 1, 0, width - 2)}" y="0" width="2" height="12" rx="1" fill="${HEX.mark}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="12" viewBox="0 0 ${width} 12">` +
    `<rect x="0" y="3" width="${width}" height="6" rx="3" fill="${HEX.track}" fill-opacity="0.3"/>${fillRect}${tick}</svg>`
  )
}

// The last hour of readings as a sparkline SVG, or null with fewer than two.
export const sparkSvg = (samples: readonly Sample[], now: number, width: number, height: number, color: string): string | null => {
  if (samples.length < 2) return null
  const hour = 60 * 60_000
  const lo = Math.min(...samples.map(s => s.percent))
  const span = Math.max(1, Math.max(...samples.map(s => s.percent)) - lo)
  const points = samples
    .map(s => {
      const x = clamp(((s.at - (now - hour)) / hour) * width, 0, width)
      const y = height - 2 - ((s.percent - lo) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`
  )
}
