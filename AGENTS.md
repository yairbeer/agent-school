# AGENTS.md

## What This Is

AgentSchool mines a coding agent's conversation sessions for a project, lets you
preview them, uses an LLM to review each conversation and extract **structured
lessons learned**, and then proposes an improved `AGENTS.md`. It closes the loop:
raw agent transcripts → structured insights → better instructions next time.

- **Frontend:** Vite + React + TypeScript, Monaco diff editor.
- **Backend:** Express (TypeScript, ESM) run via `tsx`.
- **LLM:** LangChain.js, multi-provider (`server/llmFactory.ts`).
- **Tests:** Vitest. **Node:** v24 (ESM, `"type": "module"`).

## Build, Test, Run

Every change must keep these three green:

```bash
npm test          # vitest run — all tests must pass
npm run lint      # eslint — 0 errors (a few pre-existing warnings are OK)
npm run build     # vite build — must succeed
```

Dev server (Vite on :5173 proxies `/api` → backend on :3001):

```bash
npm run dev               # run-p dev:frontend + dev:backend (tsx watch)
```

With AWS Bedrock (the tested provider):

```bash
LLM_PROVIDER=bedrock REVIEW_MODEL=$ANTHROPIC_MODEL AGENTS_MODEL=$ANTHROPIC_MODEL \
  AGENTS_MAX_TOKENS=8192 npm run dev
```

Open **http://localhost:5173**. Use the **"Try the demo"** link to run with bundled
sessions (no real pi sessions required).

## LLM Configuration

- Config is read from `process.env`; `.env` is auto-loaded via `dotenv` (`import
  "dotenv/config"` is the first import in `server/index.ts`).
- **Precedence: exported shell vars > `.env` > built-in defaults.** dotenv does
  NOT override already-exported vars.
- Provider is set by `LLM_PROVIDER` or auto-detected from the model name
  (`detectProvider` in `server/llmFactory.ts`).
- Key vars: `LLM_PROVIDER`, `REVIEW_MODEL`, `AGENTS_MODEL`, `AGENTS_MAX_TOKENS`,
  `REVIEW_PROVIDER`, plus provider creds (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
  / `GOOGLE_API_KEY` / AWS chain). See `.env.example` (Bedrock is the default;
  OpenAI/Anthropic/Google are wired but **untested**).
- The backend prints its effective config on startup (`LLM: provider=… reviewModel=…`).
- LLM init is **lazy** so the server boots without credentials (session
  browsing/preview work offline).

## Architecture

```
server/                 Express API (ESM, tsx)
  index.ts              endpoints + startup; loads dotenv; builds ReviewEngine/AgentsGenerator
  sessionLoader.ts      discover/parse pi JSONL sessions; path <-> --path-- encoding;
                        __demo__ sentinel -> <repo>/demo; resolveProjectDir/resolveSessionsDirectory
  reviewEngine.ts       per-session LLM review (structured JSON/tool output); transcript builder
  aggregator.ts         combine reviews into AggregatedLessons
  agentsGenerator.ts    propose new AGENTS.md (plain markdown), read/save with backup
  llmFactory.ts         createLLM() for openai/anthropic/google/bedrock
shared/                 types.ts, api.ts (shared request/response + domain types)
src/                    React app
  api/client.ts         fetch wrappers; API_BASE = window.location.origin
  components/            Wizard + 4 steps + SessionList/TranscriptRenderer + EditStep (Monaco)
demo/                   bundled demo: sessions/*.jsonl + AGENTS.md (the __demo__ project)
```

### Wizard flow (4 steps)
`Pick → Preview → Review → Propose & Save` (`src/types/wizard.ts`, `Wizard.tsx`).
Sessions selected in Preview (`SessionList`, all selected by default) flow to
Review; reviews flow to the Propose & Save step (`EditStep`).

## Conventions

- **TypeScript strict; no `any` in committed code.** ESM imports use `.js`
  extensions for local files (e.g. `import { x } from "./foo.js"`).
- Prettier: 2 spaces, double quotes, semicolons, `printWidth` 100, `trailingComma: es5`.
- Tests are colocated (`*.test.ts(x)`) next to the code.
- Don't use personal/absolute paths (e.g. a real home dir) as examples in code,
  tests, or UI — use neutral placeholders like `/Users/alice/projects/webapp`.
- The UI never renders absolute `filePath`/`cwd` (avoids leaking the runner's paths).

## Domain Rules (important, learned the hard way)

- **Review output is structured JSON** (tool/schema, enforced + validated).
  **Propose output is plain markdown** — not structured. Don't "fix" the propose
  path by switching it to tool output.
- **Aggregation shows ALL findings from every session — no clustering/dedup.**
- **Truncate long transcript entries in the MIDDLE** (`truncateMiddle`,
  `MAX_ENTRY_CHARS`) so the model keeps both the command/context and the
  result/error.
- **`parseAgentsResponse` must use `matchAll`/non-stateful regex.** A regex
  literal recreated inside a `while` loop never advances `lastIndex` → infinite
  loop that hangs the request after the LLM responds. Don't reintroduce that.
- **Propose system prompt** integrates findings into the existing AGENTS.md
  structure (no trailing "Lessons"/"Do's and Don'ts" dump, no `[LESSON-N]`
  markers in the output). See `buildSystemPrompt` in `agentsGenerator.ts`.

## Frontend Gotchas

- **React 18 StrictMode double-invokes effects in dev.** Guard expensive,
  side-effectful mount effects (e.g. the propose call in `EditStep`) with a
  `startedRef` once-guard plus a `mountedRef` setState guard. Don't fire two LLM
  requests.
- **Monaco diffs: use `<DiffEditor>`, not `<Editor>`.** A plain `<Editor>`
  ignores `original`/`modified` and renders empty. Capture edits via the modified
  editor's change listener in `onMount`. The app uses a custom **Darcula** theme.
- The wizard is pinned to the viewport (`height: 100vh`, `overflow: hidden`) so
  the footer (Back/Next) stays visible; scroll regions live inside steps.
- `selectedSessions` comes from `SessionList`; it selects all by default and must
  call `onSelectChange` for both single and select-all toggles, or Review gets 0
  sessions.

## Demo Mode

- Project sentinel `__demo__` resolves to `<repo>/demo` (`resolveProjectDir`),
  with sessions in `demo/sessions/*.jsonl` and a sample `demo/AGENTS.md`.
- Demo content is fully synthetic/generic — keep it that way (no real names,
  hosts, keys, customer IDs, or personal paths).

## Git / Safety

- Don't commit secrets. `.env`, `.review-cache/`, `.pi/`, `dist/`, `node_modules/`,
  `PRD.md`, and AGENTS backups are gitignored.
- AGENTS.md saves are atomic and create a timestamped backup under
  `.agents_backups/` (gitignored).
