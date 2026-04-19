# Resy MCP — Design

## Purpose

Expose Resy reservation management (search, book, list, cancel, favorites, priority notify) as an MCP server for Claude, matching the conventions of the user's existing MCPs (`splitwise-mcp`, `ofw-mcp`).

## Non-goals

- Building a web UI, HTTP/SSE transport, or hosted deployment. Stdio only.
- Venue messaging (restaurant chat) — fuzzy endpoint spec, deferred.
- Cities/geo lookup endpoint — lat/lng is sufficient.
- An "official" API key flow. Resy does not offer one; the public web-app key is used.

## Architecture

```
resy-mcp/
├── src/
│   ├── index.ts            # MCP server bootstrap, tool registration
│   ├── client.ts           # ResyClient: auth + request + retry
│   └── tools/
│       ├── user.ts
│       ├── venues.ts
│       ├── reservations.ts
│       ├── favorites.ts
│       └── notify.ts
├── tests/
│   ├── client.test.ts
│   └── tools/
│       ├── user.test.ts
│       ├── venues.test.ts
│       ├── reservations.test.ts
│       ├── favorites.test.ts
│       └── notify.test.ts
├── scripts/
│   └── smoke.ts            # gitignored run against real Resy
├── .env.example
├── .gitignore
├── CLAUDE.md
├── README.md
├── manifest.json           # MCPB manifest
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

- **Language / runtime:** TypeScript, ESM, Node ≥ 18.
- **Build:** `tsc` typecheck + `esbuild` bundle to `dist/bundle.js` (single file, `external:dotenv`).
- **Transport:** `StdioServerTransport` only.
- **Dependencies:** `@modelcontextprotocol/sdk`, `dotenv`, `zod`.
- **Dev dependencies:** `typescript`, `esbuild`, `vitest`, `@vitest/coverage-v8`, `@types/node`.
- **Tool naming:** `resy_*` prefix. Readonly annotations on GET-ish tools.

## Auth flow

### Credentials capture

`manifest.json` exposes:

```json
"user_config": {
  "resy_email": {
    "type": "string", "title": "Resy Email",
    "description": "Your Resy account email", "required": true
  },
  "resy_password": {
    "type": "string", "title": "Resy Password",
    "description": "Your Resy account password",
    "required": true, "sensitive": true
  }
}
```

Env propagated via `mcp_config.env`:
```
RESY_EMAIL=${user_config.resy_email}
RESY_PASSWORD=${user_config.resy_password}
```

### Constants

- `RESY_API_BASE = "https://api.resy.com"`
- `RESY_API_KEY = process.env.RESY_API_KEY ?? "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"` — the public web-app key, override permitted via env if Resy rotates it.

### Headers on every request

```
Authorization: ResyAPI api_key="..."
x-resy-auth-token: <user auth token>
x-resy-universal-auth: <same>
Origin: https://resy.com
Referer: https://resy.com/
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Content-Type: application/json  (set only on bodied non-form requests)
```

### Login

- `POST /3/auth/password` with `Content-Type: application/x-www-form-urlencoded`, body `email=<...>&password=<...>`.
- Response contains `token` (or `id.token`) — store as `authToken` in client.
- No expiry returned; treat token as valid until a 401/419 occurs.

### Retry / refresh

- On `401` or `419`: clear cached token, re-login once, retry original request. If still failing, throw `"Resy session rejected — verify RESY_EMAIL / RESY_PASSWORD"`.
- On `429`: sleep 2000 ms, retry once. If still failing, throw `"Rate limited by Resy API"`.
- On `500` with body matching `/unauthorized|auth|token/i`: treat as auth failure (Resy sometimes returns 500 on bad tokens).
- Other non-2xx: throw `"Resy API error: {status} {statusText} for {method} {path}"`.

## Tool specifications

All tools return `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`.

### User

**`resy_get_profile`** — readonly
- Inputs: none.
- Calls: `GET /2/user`.
- Returns: `{ first_name, last_name, email, phone, num_bookings, member_since, is_resy_select, profile_image_url }`. Payment method IDs are stripped.

### Venues

**`resy_search_venues`** — readonly
- Inputs: `query?: string`, `lat?: number` (default `40.7128`), `lng?: number` (default `-73.9876`), `date: string` (YYYY-MM-DD), `party_size: number`, `limit?: number` (default `20`), `radius_meters?: number` (default `16100`).
- Calls: `POST /3/venuesearch/search` with `struct_data=<url-encoded JSON>`, form-encoded.
- Struct payload shape: `{ availability: true, page: 1, per_page, slot_filter: { day, party_size }, types: ["venue"], order_by: "availability", geo: { latitude, longitude, radius }, query }`.
- Returns: array of `{ venue_id, name, location, cuisine, price_range, rating, url_slug, url, slots: [...] }`.

**`resy_find_slots`** — readonly
- Inputs: `venue_id: number`, `date: string`, `party_size: number`, `lat?: number`, `lng?: number`.
- Calls: `GET /4/find?lat=&long=&day=&party_size=&venue_id=`.
- Returns: array of `{ config_token, date, time (HH:MM), party_size, type }` — sorted by time ascending.

**`resy_get_venue`** — readonly
- Inputs: `venue_id: number`.
- Calls: `GET /3/venue?id={venue_id}`.
- Returns: formatted venue object (same shape as search result entry, plus fuller details when present).

### Reservations

**`resy_book`** — composite, not readonly
- Inputs: `venue_id: number`, `date: string`, `party_size: number`, `desired_time?: string` (HH:MM), `lat?: number`, `lng?: number`, `payment_method_id?: number`.
- Flow:
  1. Call `resy_find_slots` internally for a fresh `config_token`.
  2. Pick the slot matching `desired_time` exactly; fall back to the closest time by minute-delta; fall back to the first slot if `desired_time` is absent.
  3. `GET /3/details?config_id=<token>&day=<date>&party_size=<n>` → extract `book_token.value`.
  4. If `payment_method_id` not provided: `GET /2/user`, pick `payment_methods` entry with `is_default` (fallback: first entry). If none → throw `"No payment method on file. Add one at resy.com/account before booking."`.
  5. `POST /3/book` with `Content-Type: application/x-www-form-urlencoded`, body `book_token=<...>&struct_payment_method=<{"id":N}>&source_id=resy.com-venue-details`.
- Returns: `{ resy_token, reservation_id, venue_name, venue_url, date, time, party_size, type }`.

**`resy_list_reservations`** — readonly
- Inputs: `scope?: "upcoming" | "past" | "all"` (default `"upcoming"`).
- Calls: `GET /3/user/reservations` (query param if the endpoint supports scoping; otherwise filter client-side by date).
- Returns: array of `{ resy_token, reservation_id, venue_name, date, time, party_size, type, status }`.

**`resy_cancel`** — not readonly
- Inputs: `resy_token: string`.
- Calls: `POST /3/cancel` with form-encoded `resy_token=<...>`.
- Returns: `{ cancelled: boolean, refund?: ..., raw: <server response subset> }`.

### Favorites

> Endpoint paths below are reverse-engineered guesses. During implementation, verify against live Resy; adjust paths without broadening scope.

**`resy_list_favorites`** — readonly
- Calls: `GET /3/user/favorites` (candidate).
- Returns: array of venue summaries.

**`resy_add_favorite`** — not readonly
- Inputs: `venue_id: number`.
- Calls: `POST /3/user/favorites` with `venue_id=<...>` form-encoded.
- Returns: `{ favorited: true, venue_id }`.

**`resy_remove_favorite`** — not readonly
- Inputs: `venue_id: number`.
- Calls: `DELETE /3/user/favorites/{venue_id}`.
- Returns: `{ removed: true, venue_id }`.

### Priority Notify

> Same caveat as favorites — endpoint paths pending live verification.

**`resy_list_notify`** — readonly
- Calls: `GET /3/user/notify` (candidate).
- Returns: array of `{ notify_id, venue_id, venue_name, date, party_size, time_filter? }`.

**`resy_add_notify`** — not readonly
- Inputs: `venue_id: number`, `date: string`, `party_size: number`, `time_filter?: string` (e.g., `"19:00-21:00"`).
- Calls: `POST /3/notify` form-encoded.
- Returns: `{ notify_id, venue_id, date, party_size, time_filter? }`.

**`resy_remove_notify`** — not readonly
- Inputs: `notify_id: number`.
- Calls: `DELETE /3/notify/{notify_id}`.
- Returns: `{ removed: true, notify_id }`.

## Data flow

```
Claude
  │  tool call (resy_*)
  ▼
registerXTools (src/tools/*.ts)
  │  validate input via zod
  ▼
ResyClient.request(method, path, body)
  │  ensureAuthenticated() — login if no token
  │  fetch with auth + spoof headers
  │  on 401/419 → login + retry
  │  on 429 → sleep 2s + retry
  ▼
Resy API (api.resy.com)
```

`resy_book` is the only tool that issues multiple requests per invocation. All others are one-to-one.

## Error handling summary

| Condition | Behaviour |
| --- | --- |
| Missing `RESY_EMAIL`/`RESY_PASSWORD` | Throw on first request with clear message naming the missing var. |
| `POST /3/auth/password` fails | Throw `"Resy login failed: {status} {statusText}"`. |
| 401 / 419 on API call | Clear token, re-login once, retry; on second failure throw session-rejected message. |
| 429 | Sleep 2000 ms, retry once; on second failure throw rate-limit message. |
| No payment method (book) | Throw `"No payment method on file. Add one at resy.com/account before booking."`. |
| No slots available (book) | Throw `"No available slots for venue/date/party size."`. |
| Other non-2xx | Throw `"Resy API error: {status} {statusText} for {method} {path}"`. |

## Testing

- **TDD discipline:** write failing test → implement → green. `vitest` with `vi.fn()`-mocked `fetch`.
- **Client tests (`tests/client.test.ts`):** login flow; happy-path request; 401 triggers re-login + retry; 429 triggers sleep + retry; 500 with auth-like body treated as auth failure; non-2xx throws.
- **Tool tests:** for each tool file, unit-test happy path + input validation error + at least one API-error mapping. Mock `ResyClient.request` rather than `fetch` where the shape is simpler.
- **Smoke script (`scripts/smoke.ts`, gitignored output):** runs each tool against live Resy with `.env` creds; prints pass/fail per tool. Manual, not part of CI. Used once before release to confirm favorites/notify endpoint paths.
- **Coverage target:** ≥ 80 % lines on `client.ts` and each `tools/*.ts`.

## Build & packaging

- `npm run build` → `tsc --noEmit` (typecheck) then `esbuild src/index.ts --bundle --platform=node --format=esm --external:dotenv --outfile=dist/bundle.js`.
- `manifest.json` points `entry_point` and `command` at `dist/bundle.js`.
- `package.json` `bin.resy-mcp = "dist/bundle.js"`.
- `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `.env`, `*.mcpb`.
- `.env.example` lists `RESY_EMAIL`, `RESY_PASSWORD`, optional `RESY_API_KEY`.
- `README.md`: install, credentials, local dev, build; match tone of `splitwise-mcp/README.md`.
- `CLAUDE.md`: terse notes on how Claude should treat this repo (build cmd, test cmd, where to add tools).

## Open questions deferred to implementation

- **Favorites endpoint path** — confirm `GET/POST/DELETE /3/user/favorites` vs alternates via smoke script.
- **Priority Notify endpoint path** — confirm `/3/notify` vs `/3/user/notify` vs other.
- **List-reservations scoping** — confirm whether the API accepts a scope query param or whether we must filter client-side.
- **Login response shape** — confirm exact field name for the token (`token` vs `id.token` vs nested).

Each will be resolved inline during implementation; falsified assumptions adjust path/shape only, not scope.
