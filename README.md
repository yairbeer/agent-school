# AgentSchool

> Who says AI can't learn? Turn your coding-agent conversations into durable
> project guidance.

AgentSchool ingests a coding agent's conversation sessions for a
project, lets you preview them, uses an LLM to review each conversation and
extract **structured lessons learned**, and then proposes an improved
conventions file for the project.

It works with sessions from both **pi** (`~/.pi/agent/sessions`, `AGENTS.md`)
and **Claude Code** (`~/.claude/projects`, `CLAUDE.md`). You pick the agent in
the first step; the rest of the pipeline is agent-agnostic.

It closes the feedback loop: raw agent transcripts → structured insights →
better instructions for the next session.

> ⚠️ **Privacy note:** This tool sends your session transcripts to an LLM.
> Sessions may contain secrets (API keys, tokens, internal data). There is **no
> automatic redaction** — assume that **if a secret was sent to the LLM once, it
> will be sent again**. Review what your sessions contain before running, and
> prefer a local/offline model for sensitive projects.

## Demo

📺 **[Watch the demo video](https://youtu.be/lpgcrzhK8AQ)**

[![AgentSchool demo](https://img.youtube.com/vi/lpgcrzhK8AQ/maxresdefault.jpg)](https://youtu.be/lpgcrzhK8AQ)

## Features

- **📂 Session discovery** — finds sessions for a project directory from either
  pi (`~/.pi/agent/sessions/--<path>--/*.jsonl`) or Claude Code
  (`~/.claude/projects/<encoded-path>/*.jsonl`).
- **👀 Preview** — readable transcripts with collapsible thinking/tool blocks
  and automatic flagging of friction turns (tool errors, non-zero exits).
- **🔍 Structured LLM review** — per conversation, enforced via a tool/JSON
  schema, covering:
  - **(a)** what the **user had to fix**,
  - **(b)** where the **LLM took more than one try** and fixed itself,
  - **(c)** what was **learned** (for research tasks: the important steps and
    the requested output).
- **🧩 LLM aggregation** — clusters the per-session findings into **recurring
  issues** across sessions (frequency, severity, suggested rule), so repeated
  problems stand out before they're written into `AGENTS.md`.
- **📝 Conventions suggestion** — before/after side-by-side diff editor for the
  project's conventions file (`AGENTS.md` for pi, `CLAUDE.md` for Claude Code);
  the "after" pane is editable and saveable, and the old file is backed up
  automatically on save.

## Status

🚧 Early development. Try it instantly with the bundled demo (**“Try the
demo”** button), or point it at your own pi or Claude Code project directory.

## Quick start

```bash
# clone
git clone <repo-url>
cd ai_lessons

# install dependencies
npm install

# configure an LLM provider (see Configuration below)
# (optional if you only want to run the bundled demo, which is fully mocked)
cp .env.example .env   # then edit .env

# run the dev server (Vite + React on :5173, API on :3001)
npm run dev
```

Then open http://localhost:5173 and click **“Try the demo”** on the first
screen — no sessions of your own required, **and no LLM provider needed**.
The demo loads bundled example sessions and a sample `AGENTS.md`, and the
Review / Aggregate / Propose steps are served from bundled mock fixtures, so
you can walk the full Pick → Preview → Review → Aggregate → Propose flow end
to end completely offline.

**Stack:** TypeScript on Node.js · Vite + React front-end · Monaco diff editor ·
LangChain.js LLM client (multi-provider) · npm.

## Configuration

The tool talks to an LLM through [LangChain.js](https://js.langchain.com/) and
supports four providers. Set the relevant variables in `.env` (copy from
[`.env.example`](./.env.example)). Only one provider is needed; the provider is
auto-detected from the model name, or set `LLM_PROVIDER` explicitly.

> ⚠️ **Only AWS Bedrock has been tested.** The OpenAI / Anthropic / Google
> configs are wired up but **untested** — they should work via LangChain.js but
> may need tweaks.

| Provider | `LLM_PROVIDER` | Example `REVIEW_MODEL` | Credentials | Status |
|----------|----------------|------------------------|-------------|--------|
| AWS Bedrock | `bedrock` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | `AWS_REGION` + AWS credential chain | ✅ tested (default) |
| OpenAI | `openai` | `gpt-5.5` | `OPENAI_API_KEY` | ⚠️ untested |
| Anthropic | `anthropic` | `claude-sonnet-4-5-20250929` | `ANTHROPIC_API_KEY` | ⚠️ untested |
| Google Gemini | `google` | `gemini-3.1-pro` | `GOOGLE_API_KEY` | ⚠️ untested |

Key variables:

- `REVIEW_MODEL` — model used to review each session (and, by default, to
  propose the new conventions file).
- `AGENTS_MODEL` / `AGENTS_MAX_TOKENS` — optionally use a different/larger model
  and output budget just for the proposal step.
- `PORT` — backend port (default `3001`).

The backend prints its effective config on startup, e.g.
`LLM: provider=bedrock reviewModel=us.anthropic.claude-sonnet-4-5-20250929-v1:0 …`.

## How it works

Both supported agents store sessions as JSONL files, and AgentSchool parses
them, reconstructs the active conversation branch, and feeds it to an LLM that
returns structured findings.

- **pi** stores sessions as JSONL trees under
  `~/.pi/agent/sessions/--<path-with-slashes-as-dashes>--/`. See the
  [pi session format docs](https://github.com/earendil-works/pi-mono).
- **Claude Code** stores sessions under `~/.claude/projects/<encoded-path>/`.
  Its path encoding is lossy (every non-alphanumeric char becomes `-`), so the
  project directory (`cwd`) is read from inside the session file rather than
  decoded from the folder name.

The agent is chosen in the first wizard step, and the conventions file follows
the agent: `AGENTS.md` for pi, `CLAUDE.md` for Claude Code.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
and our [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE)
