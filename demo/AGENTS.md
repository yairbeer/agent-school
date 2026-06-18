# AGENTS.md

Guidance for agents working in this demo project (a small TypeScript web app).

## What This Is

A minimal Express + TypeScript service with a React front-end. This file is a
sample "current" AGENTS.md used by the AgentSchool demo — run the
wizard against the bundled demo sessions to see how findings get merged in.

## Build & Test

```bash
npm install
npm test       # vitest
npm run build
```

## Conventions

- TypeScript strict mode; no `any` in committed code.
- Keep API handlers in `src/` and colocate `*.test.ts` next to the code.

## API

- `GET /api/users` returns the list of users.
