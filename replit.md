# LOVELOCK

LOVELOCK lets people create social quizzes, share unique links, and review participants' answers.

## Run & Operate

- `pnpm --filter @workspace/lovelock run dev` — run the web app
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, Clerk keys. See `README.md` for Vercel deployment.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind
- Authentication: Clerk

## Where things live

- `artifacts/lovelock/` — Vite frontend and Vercel build target
- `artifacts/api-server/src/routes/quizzes.ts` — quiz CRUD, participant endpoints, analytics, templates, and CSV export
- `lib/db/src/schema/index.ts` — quiz and attempt persistence
- `lib/api-spec/openapi.yaml` — API source of truth; regenerate clients after changes
- `vercel.json` and `api/[...route].ts` — Vercel static frontend and serverless Express API

## Architecture decisions

- Vercel uses the repo root; Vite emits static files and the Express API is exposed by a catch-all serverless function.
- Clerk owns identity; quiz rows use the Clerk user ID for server-side ownership checks.
- Public quiz responses omit correctness and scoring metadata; scoring only runs after a participant submits.
- Production Vercel needs its own reachable PostgreSQL URL and Clerk production environment values.

## Product

- Public landing, quiz editor, dashboard, discovery, template library, participant quiz flow, owner analytics, and response CSV export.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run API codegen after every OpenAPI edit, then `pnpm run typecheck:libs` before package typechecks.
- Vercel needs `VITE_CLERK_PROXY_URL` set to the final production domain's `/api/__clerk` endpoint at build time.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
