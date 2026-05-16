# resy-mcp

MCP server for Resy. Wraps Resy's private web-app API (email/password auth + the public `api_key` baked into resy.com's JS) and exposes 14 `resy_*` tools over stdio: search venues, find slots, book/cancel reservations, manage favorites, and Priority Notify subscriptions.

> Resy has no official public API. This server calls the same endpoints the resy.com web app calls. Use at your own discretion.

## Commands

```bash
npm run build          # tsc → dist/ + esbuild bundle → dist/bundle.js
npm test               # vitest, mocked fetch, no network
npm run test:watch     # watch mode
npm run test:coverage  # v8 coverage (text + html, no thresholds)
npm run smoke          # live read-only probe of /2/user, /3/user/reservations,
                       #   /3/user/favorites, /3/notify — needs real .env
npx tsc --noEmit       # typecheck only
```

Run locally (requires built bundle and a populated `.env`):

```bash
node dist/bundle.js
```

## Tool naming

All tools are prefixed `resy_` (14 total). The manifest's `tools[]` array in `manifest.json` is the canonical list.

## Architecture

```
src/
  index.ts              # MCP bootstrap — instantiates ResyClient, registers all
                        #   tool groups, connects stdio transport
  client.ts             # ResyClient: lazy login, token caching, 401/419/
                        #   auth-500 → re-login+retry, 429 backoff+retry,
                        #   URLSearchParams vs JSON body detection
  mcp.ts                # textResult() helper — wraps any JSON value as the
                        #   single-text-block CallToolResult every tool returns
  tools/
    user.ts             # resy_get_profile, resy_list_payment_methods
    venues.ts           # resy_search_venues, resy_find_slots, resy_get_venue
                        #   + shared findSlotsAtVenue() helper used by resy_book
    reservations.ts     # resy_list_reservations, resy_cancel, resy_book
                        #   (composite: find → details → book)
    notify.ts           # resy_list_notify, resy_add_notify, resy_remove_notify
    favorites.ts        # resy_list_favorites, resy_add_favorite, resy_remove_favorite

tests/                  # 1:1 mirror of src/, plus tests/helpers.ts in-memory
                        #   MCP test harness. All tests mock ResyClient.request.
scripts/smoke.ts        # live probe runner (read-only)
```

Each `tools/*.ts` file exports a `registerXxxTools(server, client)` function; `src/index.ts` invokes all of them.

## Environment

```
RESY_EMAIL=<addr>      # Required. Resy account email.
RESY_PASSWORD=<pass>   # Required. Resy account password.
RESY_API_KEY=<key>     # Optional. Defaults to the public web-app key baked into
                       #   resy.com's JS. Only override if Resy rotates it.
```

`src/client.ts` loads `.env` from `dirname(import.meta.url)/../.env` (i.e. the repo root next to `dist/`) via `dotenv` with `quiet: true`. Blank values, `undefined`, `null`, and unsubstituted `${FOO}` placeholders are treated as unset. The MCPB manifest / `.mcp.json` pass credentials through `env` instead.

## Testing

Tests live in `tests/` and mirror `src/` 1:1. Run with `npm test`. `tests/helpers.ts` provides an in-memory MCP harness for invoking registered tools without spawning a transport. `vitest.config.ts` enables v8 coverage (text + html) but does **not** enforce thresholds.

Write a failing test before implementation. Keep tool tests in `tests/tools/<name>.test.ts` and mock `ResyClient.request`.

## Conventions

- All tools are `resy_*`-prefixed.
- Tool return shape: `textResult(data)` from `src/mcp.ts` → `{ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }`. Don't hand-roll the wrapper.
- Read-only tools set `annotations: { readOnlyHint: true }`.
- Form-encoded bodies use `URLSearchParams`; `ResyClient.request` detects the instance and sets `Content-Type: application/x-www-form-urlencoded` automatically. Otherwise it JSON-encodes.
- Times are normalized to `HH:MM` at the MCP boundary even though Resy uses `HH:MM:SS` on the wire.

## Resy API quirks (from live smoke)

- `/3/notify` is **list-only**; POST returns 502. Add goes to `/2/notify`.
- `/3/user/notify` returns HTML, not JSON — use `/3/notify`.
- On `/2/notify`, the field is `num_seats`, **not** `party_size` (which `/3` reservation endpoints use).
- Favorites has no DELETE — `POST /3/user/favorites` toggles via `favorite=1|0`.
- `DELETE /2/notify` needs the **full** spec as query params (`notify_request_id`, `venue_id`, `day`, `num_seats`, `service_type_id`), not just the id. `resy_remove_notify` looks the spec up internally so callers only pass `notify_id`.
- Resy's `scope` query param on `/3/user/reservations` is currently a no-op — all scopes return the same list. `resy_list_reservations` filters by `today` client-side.
- Slot times come back without a timezone offset (restaurant-local); `extractHHMM` parses the string directly to avoid TZ-shifting via `new Date()`.
- `resy_book` flow: `findSlotsAtVenue` → `GET /3/details?config_id=...` for the `book_token` → `POST /3/book` with `struct_payment_method`. Default payment method is resolved from `/2/user` if `payment_method_id` is omitted.

## Plugin / Marketplace

```
.claude-plugin/
  plugin.json       # Claude Code plugin manifest (points at ./.mcp.json + SKILL.md)
  marketplace.json  # Marketplace catalog entry
.mcp.json           # MCP client config for plugin installs (uses ${CLAUDE_PLUGIN_ROOT})
manifest.json       # MCPB / Claude Desktop user-config + tool catalog
server.json         # modelcontextprotocol/registry entry (OIDC publish)
SKILL.md            # Claude Code skill — teaches Claude when/how to use the tools
docs/submissions/   # Manual-submission copy for mcpservers.org + clau.de
```

## Registry surface

Each `v*` tag push fans out via `.github/workflows/release.yml` to: npm (with provenance), GitHub Releases (`.skill` + `.mcpb` artifacts), `modelcontextprotocol/registry` (OIDC), and ClawHub (only if `CLAWHUB_TOKEN` is set). PulseMCP auto-ingests from the MCP Registry weekly. Two registries need a one-time manual browser submission: `mcpservers.org/submit` and `clau.de/plugin-directory-submission` — see `docs/submissions/README.md`.

## Versioning

Version appears in SEVEN places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → `npm install --package-lock-only` after changing package.json (or `npm version` does it automatically)
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`
5. `server.json` → `"version"` and `packages[].version` (two entries)
6. `.claude-plugin/plugin.json` → `"version"`
7. `.claude-plugin/marketplace.json` → `metadata.version` and `plugins[].version`

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Versioning is handled by the **Tag & Bump** GitHub Action (`.github/workflows/tag-and-bump.yml`).

### Release workflow

Main is always one version ahead of the latest tag. To release, run the **Tag & Bump** workflow which:

1. Runs CI (build + test) via `ci.yml`
2. Tags the current commit with the current `package.json` version
3. Bumps patch via `npm version patch --no-git-tag-version` + an inline node script that walks every JSON version field, plus a `sed` on `src/index.ts`
4. Rebuilds, commits, and pushes main + the new tag
5. The tag push triggers `release.yml` (npm publish + GitHub Release + MCP Registry + ClawHub)

<!-- pr-workflow:v1 -->
## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review *and* skip auto-generated release notes — GitHub's `generate_release_notes` (configured in `.github/release.yml`) only picks up merged PRs. Push directly to `main` only when the user explicitly asks for it (e.g. emergency hotfix).

For every PR, apply exactly one label so it lands in the right release-notes section:

| Label                | Section in release notes |
|----------------------|--------------------------|
| `enhancement`        | Features                 |
| `bug`                | Bug Fixes                |
| `security`           | Security                 |
| `refactor`           | Refactor                 |
| `documentation`      | Documentation            |
| `test`               | Tests                    |
| `dependencies`       | Dependencies             |
| `ci` / `github_actions` | CI & Build            |
| *(none / unmatched)* | Other Changes            |
| `ignore-for-release` | Hidden from notes        |

The **PR title** becomes the bullet — write it like a user-facing changelog entry (`resy_book: prefer exact-time slot match`), not internal shorthand (`booking tweaks`). Conventional-commit prefixes (`feat:`, `fix:`, `chore:`) are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.

## Gotchas

- **ESM + NodeNext**: imports must use `.js` extensions even for `.ts` source files (e.g. `import { ResyClient } from './client.js'`).
- **Bundle vs tsc output**: `dist/bundle.js` is the entry point everywhere (bin, manifest, .mcp.json). It is produced by `npm run bundle` (esbuild) — `tsc` alone is not enough. `npm run build` does both.
- **stdio transport**: the server logs warnings/banners to **stderr** only — stdout is reserved for JSON-RPC. `dotenv` is loaded with `quiet: true` so it doesn't print to stdout either.
- **Auth retry is narrow**: only `401`, `419`, or a `500` matching `\b(unauthorized|auth[_\s-]?token|authentication)\b` triggers re-login. A `500` mentioning `book_token expired` is a different failure and is *not* retried.
- **429 retry**: single 2-second backoff, then surface the error.
- **`resy_cancel` response is undocumented**: the tool returns `{ cancelled, raw }`. `cancelled` defaults to true on HTTP-OK absent explicit failure signals (`ok: false`, status matching `fail|error|denied`, or an `error*` field). Callers should inspect `raw` if they need certainty.
- **Slot tokens expire fast** — `resy_find_slots` returns `config_token`s that must be exchanged for a `book_token` (via `GET /3/details`) and then booked promptly. `resy_book` does the whole chain in one call.
- **Notify date window** ≈ 30 days. Resy rejects dates outside this window with an API error.
- **No write tests against live API.** `npm run smoke` is read-only by design. Verify write paths (`resy_book`, `resy_cancel`, favorites toggles, notify add/remove) only via mocked unit tests unless you're knowingly mutating real account state.
