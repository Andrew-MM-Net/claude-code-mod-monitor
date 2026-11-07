export type Limit = { kind: string; percent: number; resetsAt?: string }
export type Meter = { limits: Limit[]; contextPercent?: number; contextTokens?: number; contextWindow?: number; costUsd?: number }
export type Activity = { id: string; at: number; text: string; state: 'running' | 'done' | 'error' }
export type GitInfo = {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  changed: number
  remote: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mod-monitor': {
      meter: Meter | null
      now: string | null
      feed: Activity[]
      steps: number
      goal: string | null
      summary: string | null
      isSummarizing: boolean
      isSummaryOn: boolean
      tick: number
      git: GitInfo | null
    }
  }
}
