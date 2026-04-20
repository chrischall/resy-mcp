# CLAUDE.md — resy-mcp

Guidance for Claude working in this repo.

## Commands

- `npm test` — vitest, mocked fetch, no network.
- `npm run build` — tsc + esbuild bundle to `dist/bundle.js`.
- `npm run smoke` — live probe of `/2/user`, `/3/user/reservations`, `/3/user/favorites`, `/3/notify` using `.env`.
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

## Verified endpoints (via live smoke 2026-04-20)

| Tool | Path | Notes |
| --- | --- | --- |
| `resy_get_profile` / `resy_list_payment_methods` | `GET /2/user` | ✅ |
| `resy_list_reservations` | `GET /3/user/reservations` | ✅ — response contains `{reservations, venues, metadata}`. Resy ignores the `scope` query param (all scopes return the same list); the tool still accepts `scope` for forward-compat but it's a no-op today. |
| `resy_list_favorites` | `GET /3/user/favorites` | ✅ — returns `{results: {venues: [{venue: {...}}]}}`; tool flattens to a venue list. |
| `resy_list_notify` | `GET /3/notify` | ✅ — NOT `/3/user/notify` (that returns HTML). Returns `{notify: [{specs: {...}}]}`; tool surfaces `specs` fields. |

## Still unverified

Write endpoints for favorites and priority-notify have not been exercised live (exercising them would mutate the account):

- `resy_add_favorite` — `POST /3/user/favorites` (body: `venue_id`)
- `resy_remove_favorite` — `DELETE /3/user/favorites/{venue_id}`
- `resy_add_notify` — `POST /3/notify` (body: `venue_id`, `day`, `party_size`, `time_preferred_start=HH:MM:SS`, `time_preferred_end=HH:MM:SS`)
- `resy_remove_notify` — `DELETE /3/notify/{notify_id}`

If any 4xx/5xx on first use, inspect the response and adjust the path/body shape. The corresponding tests lock in the shape we *expect*; update the test and the source together.
