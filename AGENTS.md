# Repository Guidelines

## Project Structure

A private team wiki on Cloudflare Workers. See `README.md` for features and design.

- `worker/`: Hono API. `routes/` holds endpoints; `session.ts` enforces authentication and roles; `crypto.ts` handles password hashing and tokens.
- `src/`: React UI. `pages/` holds screens; `api.ts` is the fetch client; `markdown.ts` renders sanitized Markdown.
- `migrations/`: D1 schema as numbered SQL files. Never edit an applied migration; add a new one.
- `test/`: API tests that run inside the Workers runtime.
- `scripts/`: D1/R2 backup and restore (`docs/operations.md`).
- `docs/superpowers/`: spec and plan. `wiki-mock/` is an old static mock; it is git-ignored and not part of the app.

## Build, Test, and Development

Requires Node.js 22+. Run `npm install`, copy `.dev.vars.example` to `.dev.vars`, then `npm run db:migrate:local` and `npm run dev`. Run `npm run check` (typecheck, tests, build) before committing. After changing bindings in `wrangler.jsonc`, run `npm run cf-typegen`.

## Style and Naming

Follow the conventions of the files and tools introduced to the project. Use descriptive file and directory names, consistent indentation, and a formatter or linter appropriate to the language. Document any required formatting command alongside the development commands.

## Testing

`npm test` runs `test/**/*.test.ts` with `@cloudflare/vitest-plugin`; D1 and R2 are reset and migrated before every test. Run one file with `npx vitest run test/articles.test.ts`. Cover authorization (unauthenticated, member, admin) for every new endpoint.

## Commits and Pull Requests

Write concise, imperative commit subjects that describe the change, such as `Add initial wiki structure`. Keep each commit focused. Pull requests should explain the purpose and changes, describe how they were checked, and link relevant issues. Include screenshots when a change affects a visible interface.

## Configuration and Secrets

Document required configuration and provide example values where useful. Keep credentials and other secrets out of version control. `SETUP_TOKEN` is the only secret; set it with `wrangler secret put` and delete it after creating the first administrator. Never commit `.dev.vars` or `backups/`.