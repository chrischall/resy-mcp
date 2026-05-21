# resy-mcp

Resy reservation management as an MCP server for Claude — search restaurants, book tables, manage reservations, favorites, and Priority Notify via natural language.

> ⚠️ Resy does not publish an official API. This server uses the same private endpoints the Resy web app calls, with the public web-app `api_key` and one of three user-level auth paths (token override, email + password, or a fetchproxy browser bridge). Use at your own discretion.

## Tools

| Tool | Purpose |
| --- | --- |
| `resy_get_profile` | Current user profile (name, email, booking count) |
| `resy_search_venues` | Search venues with availability for a date + party size |
| `resy_find_slots` | List bookable slots at a venue |
| `resy_get_venue` | Full venue details |
| `resy_book` | Book a reservation (composite: find → details → book) |
| `resy_list_reservations` | Upcoming / past reservations |
| `resy_cancel` | Cancel by `resy_token` |
| `resy_list_favorites` | Favorited venues |
| `resy_add_favorite` / `resy_remove_favorite` | Manage favorites |
| `resy_list_notify` | Priority Notify subscriptions |
| `resy_add_notify` / `resy_remove_notify` | Manage Priority Notify |

## Install

```bash
npm install
npm run build
```

## Configure

Pick one of three auth paths. The client tries them in this priority order:

1. **`RESY_AUTH_TOKEN`** — pre-obtained `x-resy-auth-token`. Overrides everything; useful for CI or power users who already have a token.
2. **`RESY_EMAIL` + `RESY_PASSWORD`** — the classic flow. POSTs `/3/auth/password` and caches the returned token.
3. **fetchproxy fallback** — when no env vars are set, the server uses the [fetchproxy](https://github.com/chrischall/fetchproxy) browser bridge to call `/3/auth/refresh` through your signed-in resy.com tab. Install the fetchproxy extension once (Chrome Web Store or Safari `.dmg`), sign into resy.com, and that's it — no credentials in env.

Copy `.env.example` to `.env` and fill in whichever path you want:

```
# Path 2: password login (classic)
RESY_EMAIL=you@example.com
RESY_PASSWORD=changeme

# Path 1: direct token (overrides everything)
RESY_AUTH_TOKEN=...

# Opt-out of the fetchproxy fallback (forces 1 or 2)
RESY_DISABLE_FETCHPROXY=1
```

For MCPB / Claude Desktop install, the packaged manifest prompts for all three optional inputs — leave them blank to route through the fetchproxy extension instead.

## Run (local stdio)

```bash
node dist/bundle.js
```

## Test

```bash
npm test             # unit tests (mocked fetch)
npm run smoke        # live endpoint probe — requires real .env
```

## Notes

- The `RESY_API_KEY` used by the client is the public key baked into resy.com's JS bundle. If Resy rotates it, set `RESY_API_KEY` in your environment to override.
- Favorites and Priority Notify endpoint paths are reverse-engineered; if live endpoints differ, run `npm run smoke` and adjust.

---

This project was developed and is maintained by AI (Claude Opus 4.7).
