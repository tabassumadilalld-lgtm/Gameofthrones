# LOVELOCK

LOVELOCK is a social quiz app for creating and sharing personal challenges, collecting answers, and reviewing real responses. It uses React + Vite, TypeScript, Express, PostgreSQL/Drizzle, and Clerk authentication.

## Run locally in Replit

The project uses the existing workspace workflows:

- Web app: `pnpm --filter @workspace/lovelock run dev`
- API server: `pnpm --filter @workspace/api-server run dev`
- Typecheck: `pnpm run typecheck`
- Production frontend build: `pnpm --filter @workspace/lovelock run build`

The Replit environment provides `DATABASE_URL` and the Clerk development keys. Create or update the development schema with:

```sh
pnpm --filter @workspace/db run push
```

## Deploy to Vercel

The repository root is the Vercel project root. `vercel.json` builds the Vite app into `artifacts/lovelock/dist/public`; `api/[...route].ts` exposes the Express API as a Vercel serverless function, including the Clerk Frontend API proxy.

Configure these Vercel environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | A production PostgreSQL connection string reachable from Vercel |
| `CLERK_SECRET_KEY` | Clerk server key |
| `CLERK_PUBLISHABLE_KEY` | Clerk server-side publishable key |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk browser key, available at Vite build time |
| `VITE_CLERK_PROXY_URL` | Full production URL ending in `/api/__clerk` |

Use the production Clerk environment and a production database; development users and records are separate. Add the final Vercel domain to the Clerk app's allowed domains. Deploy once to obtain the Vercel URL, set `VITE_CLERK_PROXY_URL` to `https://<your-domain>/api/__clerk`, and redeploy so the browser build uses that proxy URL. Keep all secret values in Vercel's Environment Variables settings, not in source code.

Before using the app against a new production database, apply the schema from a trusted terminal where `DATABASE_URL` points to that production database:

```sh
pnpm --filter @workspace/db run push
```

The API expects the same database schema in each environment. The Vercel configuration is deployment-ready, but the app is not published until a Vercel project, production database, Clerk production keys, and domain are configured.

## Implemented core flows

- Clerk sign-in/sign-up and authenticated quiz ownership
- Persistent quiz creation, editing, publishing, unpublishing, and deletion
- Public and unlisted share links with cryptographically random identifiers
- Anonymous participant submissions, server-side scoring, and owner analytics/CSV export
- Public quiz discovery and the Girlfriend Challenge template
- Playful “No” option configuration in the quiz question model
- An expiring HTTP-only browser token enforces the no-retake setting without collecting a participant account; clearing browser cookies resets that limit

Quiz content currently uses text and question data. Image uploads, email changes, account deletion, abuse reports, and expanded template management are not included in this first build; display-name updates are available in account settings.
