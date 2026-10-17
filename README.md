# mod-monitor

A Claude Code mod that keeps an eye on your session: subscription limit meters, context use and cost in a card above the prompt, plus a **Monitor** pane with the current task, a short AI summary of each turn and a live log of every tool call.

## What it shows

### The card above the prompt

```
╭─ monitor ───────────────────────────────────────────────────────────── opus-5-5 ──╮
│ 5h ██████┃▌░░░  52% ● 2h13m │ 7d ███┃░░░░░░  28% ▼ 3d4h │ ctx ██░░ 31% │ $1.84 │   │
├────────────────────────────────────────────────────────────────────────────────────┤
│ ● Running: Run tests  1m05s                                                        │
╰────────────────────────────────────────────────────────────────────────────────────╯
```

- **Limit meters** for the 5-hour and 7-day windows (and a spend limit, if you have one), coloured green / amber / red at 70% and 90%, with a countdown to each reset.
- **Pace marker**: the `┃` tick on each meter is where an even burn through the window would put you right now. The glyph after the percent says whether you're ahead of it (`▲`), on track (`●`) or behind it (`▼`).
- **Context**: how full the context window is, as a percent and in tokens.
- **Cost**: the session's cost so far and, after five minutes, an hourly rate.
- **Session time**, and a **✓ / ✗ tally** of the tool calls in the current turn.
- **5h forecast**: when the 5-hour limit is climbing, roughly when it will be full at the current pace (only shown if that's before it resets).
- **Status line**: what Claude is doing right now while it works, and the AI summary of the last turn once it's done.
- The current **model** in the top edge.

The card adapts to the terminal width, dropping the less important stats first.

### The Monitor pane

- **TASK**: the last thing you asked.
- **SUMMARY**: a one- or two-sentence summary of what was just done, written by Haiku after each turn.
- **ACTIVITY**: every tool call in plain language ("Reading register.tsx", "Searching the web: …", "Using Gmail: search threads"), marked running, done or failed. Calls made by helper agents are indented with `↳`.

## Commands

| Command | What it does |
| --- | --- |
| `/monitor` | Opens the Monitor pane. |
| `/monitor off` | Turns the AI turn summary off. |
| `/monitor on` | Turns it back on. |

The pane opens on its own when a session starts.

## A note on the turn summary

After each turn, the mod sends a short request to **Haiku** containing your prompt (cut to 400 characters), the list of tool-call descriptions from the turn, and the start of Claude's reply (cut to 1,500 characters). It uses your normal Claude Code account, so it counts toward your usage like any other request, though it's small (at most 120 output tokens). Use `/monitor off` if you'd rather not have it. The prompt it sends is in [`hooks/lib.ts`](hooks/lib.ts).

Nothing else leaves your machine, and the mod doesn't write any files.

## Install globally

The mod is loaded from a folder on disk through the `CLAUDE_CODE_PLUGIN_DIRS` setting, so it's available in every project.

1. Clone the repo somewhere permanent. Your Claude config folder is a good place:

   **Windows (PowerShell)**

   ```powershell
   git clone https://github.com/Andrew-MM-Net/claude-code-mod-monitor.git "$HOME\.claude\mods\mod-monitor"
   ```

   **macOS / Linux**

   ```sh
   git clone https://github.com/Andrew-MM-Net/claude-code-mod-monitor.git ~/.claude/mods/mod-monitor
   ```

2. Open your user settings file, `~/.claude/settings.json` (on Windows, `C:\Users\<you>\.claude\settings.json`), and add the folder to `env`. Use the full path; on Windows, double the backslashes:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<you>\\.claude\\mods\\mod-monitor"
     }
   }
   ```

   On macOS / Linux:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/home/<you>/.claude/mods/mod-monitor"
     }
   }
   ```

   If you already have an `env` block, add the line to it rather than creating a second one. If `CLAUDE_CODE_PLUGIN_DIRS` already lists another mod, add this folder to the list.

3. Restart Claude Code. The card appears above the prompt and the Monitor pane opens.

### Updating

```sh
cd ~/.claude/mods/mod-monitor
git pull
```

Then restart Claude Code.

### Uninstalling

Remove the folder from `CLAUDE_CODE_PLUGIN_DIRS` in `settings.json`, restart Claude Code, and delete the folder.

## Development

```
hooks/hooks.json     lists the hook module to load
hooks/register.tsx   the hooks: the /monitor command, the card, the pane and the turn summary
hooks/lib.ts         pure helpers (meters, countdowns, tool-call descriptions, the summary prompt)
types/index.d.ts     the mod's state types
tests/pulse.test.ts  tests
```

From the repo folder:

```sh
claude plugin validate .
claude plugin test .
```

`.claude-plugin/types/` holds generated Claude Code type definitions for editor support. It's ignored by git.

The internal plugin name is `session-pulse` (in `.claude-plugin/plugin.json`, `types/index.d.ts`, `hooks/register.tsx` and the tests); it shows up everywhere else as "monitor".
