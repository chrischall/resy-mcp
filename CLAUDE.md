# CLAUDE.md — resy-mcp

Guidance for Claude working in this repo.

## Commands

- `npm test` — vitest, mocked fetch, no network.
- `npm run build` — tsc + esbuild bundle to `dist/bundle.js`.
- `npm run smoke` — live probe of `/2/user`, `/3/user/reservations`, `/3/user/favorites`, `/3/user/notify` using `.env`.
- `npx tsc --noEmit` — typecheck only.

## Layout

- `src/client.ts` — `ResyClient`: lazy login, token caching, 401/419 re-login+retry, 429 backoff+retry, auth-like 500 handling.
- `src/tools/*.ts` — one file per concern (user / venues / reservations / favorites / notify). Each exports a `registerXxxTools(server, client)` function.
- `src/index.ts` — MCP bootstrap; wires tool registrations over stdio.
- `tests/` — 1:1 mirror of `src/`, plus `tests/helpers.ts` for in-memory MCP test harness.

## Conventions

- All tools are `resy_*`-prefixed.
- Tool return shape: `{ content: [{ type: 'text', text: JSON.stringify(..., null, 2) }] }`.
- Readonly tools set `annotations: { readOnlyHint: true }`.
- Prefer `URLSearchParams` for form-encoded bodies; the client detects `body instanceof URLSearchParams` and sets `Content-Type: application/x-www-form-urlencoded`.
- Write a failing test before implementation. Keep tests in `tests/tools/<name>.test.ts` and mock `ResyClient.request`.

## Known unknowns

Paths for `favorites` and `notify` are provisional. `resy_list_reservations` accepts a `scope` query param that has not been verified against live Resy. See `scripts/smoke.ts` and the "open questions" block in `docs/superpowers/specs/2026-04-19-resy-mcp-design.md`.
