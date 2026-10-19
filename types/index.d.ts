export type Limit = { kind: string; percent: number; resetsAt?: string }
export type Meter = { limits: Limit[]; contextPercent?: number; contextTokens?: number; contextWindow?: number; costUsd?: number }
export type Activity = { id: string; at: number; text: string; state: 'running' | 'done' | 'error' }

declare module 'claude-code' {
  interface PluginState {
    'mod-monitor': {
      meter: Meter | null
      now: string | null
      feed: Activity[]
      goal: string | null
      summary: string | null
      isSummarizing: boolean
      isSummaryOn: boolean
      tick: number
    }
  }
}
