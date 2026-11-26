# Repository Guidelines

## Project Structure

A private team wiki on Cloudflare Workers. See `README.md` for features and design.

- `worker/`: Hono API. `routes/` holds endpoints; `session.ts` enforces authentication and roles; `crypto.ts` handles password hashing and tokens; `cleanup.ts` is the daily cron that purges expired rows.
- `src/`: React UI. `pages/` holds screens; `api.ts` is the fetch client; `markdown.ts` renders sanitized Markdown.
- `shared/`: code used by both the API and the UI (wiki link parsing, account constants).
- `migrations/`: D1 schema as numbered SQL files. Never edit an applied migration; add a new one.
- `test/`: API tests that run inside the Workers runtime. UI logic tests live in `src/__tests__/`.
- `scripts/`: D1/R2 backup and restore (`docs/operations.md`).
- `docs/superpowers/specs/`: design specs, referenced from code and migrations. Plans (`docs/superpowers/plans/`), session notes, local security reports, and screenshots under `docs/` are git-ignored and stay local. `wiki-mock/` is an old static mock; it is git-ignored and not part of the app.

## Build, Test, and Development

Requires Node.js 22+. Run `npm install`, copy `.dev.vars.example` to `.dev.vars`, then `npm run db:migrate:local` and `npm run dev`. Run `npm run check` (lint, typecheck, tests, build) before committing; CI runs the same command on pushes to `main` and on pull requests. A push to `main` that passes is deployed to production automatically (migrations first), so treat a merge to `main` as a release. After changing bindings in `wrangler.jsonc`, run `npm run cf-typegen`.

## Style and Naming

Follow the conventions of the files and tools introduced to the project. Biome formats and lints TypeScript and JSON (2 spaces, double quotes, 160 columns; see `biome.json`): `npm run lint` checks, `npm run format` fixes. CSS is not formatted; keep its one-rule-per-line layout.

## Testing

`npm test` runs `test/**/*.test.ts` with `@cloudflare/vitest-plugin` (D1 and R2 are reset and migrated before every test) and `src/**/*.test.ts` and `shared/**/*.test.ts` with jsdom. Run one file with `npx vitest run test/articles.test.ts`. Cover authorization (unauthenticated, member, admin) for every new endpoint.

## Commits and Pull Requests

Use Conventional Commits: `type(scope): description`, such as `fix(security): rate limit password checks`. Keep each commit focused. Put changes that may be destructive (schema migrations, deletions, permission or authentication changes) in a pull request instead of pushing to `main`. Pull requests should explain the purpose and changes, describe how they were checked, and link relevant issues. Include screenshots when a change affects a visible interface.

## Local and Production Data

Work against local resources only. Use `--local` for every D1 and R2 command, and never run anything that reaches production unless the user asks for it in the current task: `npm run db:migrate:remote`, `npm run backup:remote`, `npm run restore:r2 -- <dir> --remote`, `wrangler d1 execute --remote`, `wrangler r2 object put` without `--local`, or `wrangler deploy`. Production migrations are applied by CI when `main` is pushed, so there is no reason to migrate production by hand during development.

The local D1 and R2 under `.wrangler/` hold dummy data (article titles start with `[ダミー]`). Never copy local data into production. `backups/` holds real production data, including password hashes; do not read, share, or restore it, and do not pull production data into the local database without asking.

## Configuration and Secrets

Document required configuration and provide example values where useful. Keep credentials and other secrets out of version control. `SETUP_TOKEN` is the only secret; set it with `wrangler secret put` and delete it after creating the first administrator. Never commit `.dev.vars` or `backups/`.