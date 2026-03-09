# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript source. Key folders: `commands/` (slash commands), `components/` (buttons/selects), `contexts/` (message/user contexts), `modals/`, `handlers/`, `classes/`, `stores/`.
- Entry point: `src/index.ts` → compiled to `dist/index.js`.
- Configuration: copy `template.config.json` → `config.json` and adjust. Env vars: copy `template.env` → `.env`.
- Docs: `README.md`, `config.md`, `DB_SETUP.md`.

## Build, Test, and Development Commands
- `npm run deploy`: clean, install, compile with `tsc`, start `node .` (uses `dist/index.js`).
- `npm run update`: update deps, compile, start.
- `npm run generate-key`: compile then output an `ENCRYPTION_KEY` for `.env`.
- Direct compile: `npx tsc -p .` (outputs to `dist/`).
- Node requirement: Node >= 18. PostgreSQL optional (see `DB_SETUP.md`).

## Coding Style & Naming Conventions
- Language: TypeScript, strict mode enabled (see `tsconfig.json`). Code must compile with zero errors.
- Indentation: match existing file (tabs are common; 4‑space width). No trailing whitespace.
- Naming: classes `PascalCase`; functions/variables `camelCase`; command files in `src/commands/` use lowercase with underscores to reflect subcommands (e.g., `advanced_generate.ts`).
- Imports: use relative paths within `src/`; prefer explicit exports.

## Testing Guidelines
- No test framework is configured. Validate changes by compiling (`npx tsc -p .`) and running locally in a test Discord server.
- Sanity checks: command registration on startup, generation flow (`/generate`), DB features if `use_database` is true.
- If adding tests, mirror file structure under `tests/` and use your preferred TS test runner; keep them opt‑in.

## Commit & Pull Request Guidelines
- Commits: short, imperative summaries (e.g., "add clip skip support"). Group related changes.
- PRs: use `.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`. Include description, motivation, steps to test, and screenshots of bot output when UI/behavior changes.
- Requirements: update docs when config or commands change; ensure `npm run deploy` builds cleanly; link related issues.
- Always update relevant docs (`README.md`, `config.md`, `DB_SETUP.md`, `AGENTS.md`, and similar repo docs) when behavior, commands, configuration, setup, or operator-facing workflows change.

## Security & Configuration Tips
- Never commit secrets. Populate `.env` from `template.env` and keep it local.
- Generate and set `ENCRYPTION_KEY` if token encryption is enabled. Avoid rotating keys after deployment.
- Database is optional; set `use_database` accordingly in `config.json`.
- SQLite schema changes must include automatic backward-compatible migrations for existing installs; do not assume a fresh database.
