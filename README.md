# GD Arena
Evidence-based AI group-discussion coach (LLOYD Hackathon 2026, Problem Statement 2). Work in progress.

## What it does
_(fill in at submission)_ Voice-first GD with AI participants; every feedback point links to a quoted transcript moment.

## Status
| Area | State |
|---|---|
| Monorepo, contracts, DB schema, server and web shell | Done (Task 01-03 partial) |
| Session API, state machine, WebSocket, voice loop, analysis, report | Not started |

## Architecture and why
One Node server holds live session state in memory; Postgres stores permanent data; shared zod contracts in `packages/contracts` keep client and server in sync. See `docs/` and the PRD.

## What we added beyond the brief
_(fill in)_

## Environment Variables

Configure environment variables in `.env` (copy from `.env.example`). Secrets should never be committed to repository.

| Variable | Description | Required / Default |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API Key for LLM persona & report generation | Optional (heuristic fallback used if missing) |
| `GROQ_API_KEY` | Groq Llama API Key for secondary/fallback LLM | Optional |
| `PRIMARY_LLM` | Preferred primary LLM provider (`gemini` or `groq`) | Default: `gemini` |
| `PORT` | HTTP & WebSocket server port | Default: `8787` |
| `ALLOWED_ORIGIN` | Allowed CORS origin for web app | Default: `*` (or `http://localhost:3000`) |

## Run & Deploy

### Development
```bash
npm install
cp .env.example .env     # server keys; never commit .env
npm run dev:server       # Fastify REST & WS server (:8787)
npm run dev:web          # Vite web dev server (:3000)
npm test && npm run typecheck && npm run build
```

### Production Single-Service Deployment
In single-service production mode, Fastify builds and serves the web frontend (`apps/web/dist`) as static files with SPA fallback on the same port, sharing one origin for REST & WebSocket calls.

```bash
npm run start:prod       # Builds web app and starts production Fastify server on PORT (:8787)
```

Health check endpoint: `GET /health`

## Tools and AI used
Google Antigravity (AI-assisted coding), Gemini 2.5 Flash / Groq Llama 3.3.

## Who it is for
Students preparing for campus-placement group discussions.
