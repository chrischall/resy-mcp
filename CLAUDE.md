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

All 13 tools (14 inc. `resy_list_payment_methods`) exercised against live Resy. Write endpoints round-tripped idempotently.

| Tool | Method + path | Notes |
| --- | --- | --- |
| `resy_get_profile` / `resy_list_payment_methods` | `GET /2/user` | ✅ |
| `resy_list_reservations` | `GET /3/user/reservations` | ✅ — `{reservations, venues, metadata}`. Resy currently ignores the `scope` query param (all scopes return the same list); kept for forward-compat. |
| `resy_list_favorites` | `GET /3/user/favorites` | ✅ — `{results: {venues: [{venue: {...}}]}}`; flattened. |
| `resy_add_favorite` | `POST /3/user/favorites` | ✅ — body `venue_id=X&favorite=1`. |
| `resy_remove_favorite` | `POST /3/user/favorites` | ✅ — body `venue_id=X&favorite=0` (NOT a DELETE — Resy uses the toggle flag). |
| `resy_list_notify` | `GET /3/notify` | ✅ — NOT `/3/user/notify` (that returns HTML). Returns `{notify: [{specs: {...}}]}`. |
| `resy_add_notify` | `POST /2/notify` | ✅ — NOT `/3/notify`. Body uses `num_seats` (NOT `party_size`), plus `venue_id`, `day`, `time_preferred_start=HH:MM:SS`, `time_preferred_end=HH:MM:SS`, `service_type_id=2`. Resy rejects dates outside its notify booking window (~30 days). |
| `resy_remove_notify` | `DELETE /2/notify?...` | ✅ — requires the FULL spec as query params (`notify_request_id`, `venue_id`, `day`, `num_seats`, `service_type_id`), NOT just the id. The tool looks up the spec from `resy_list_notify` internally so callers just pass `notify_id`. |

### Resy API quirks discovered

- `/3/notify` is list-only; POST returns 502. Add goes to `/2/notify`.
- `party_size` (used by `/3` reservation endpoints) becomes `num_seats` on `/2/notify`.
- Favorites has no DELETE; the same POST endpoint toggles via a `favorite=1|0` flag.
- Delete-notify query requires every field that identifies the spec; the `notify_request_id` alone is not enough.
- Times on the wire are `HH:MM:SS`; the list response also uses `HH:MM:SS`. Tools normalize to `HH:MM` at the MCP boundary.
