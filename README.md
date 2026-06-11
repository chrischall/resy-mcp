# resy-mcp

[![CI](https://github.com/chrischall/resy-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/resy-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/resy-mcp)](https://www.npmjs.com/package/resy-mcp)
[![license](https://img.shields.io/npm/l/resy-mcp)](LICENSE)

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

## Acknowledgement of Terms

By using this MCP server, you acknowledge and agree to the following:

**1. This server accesses your own Resy account.** Auth happens via your own credentials (email/password) or your own signed-in browser session through the fetchproxy extension. It does not — and cannot — access anyone else's reservations.

**2. [Resy's Terms of Service](https://resy.com/terms) govern your use of this server**, just as they govern your direct use of resy.com. Resy's ToS prohibits the use of bots and automated booking, enforces rate limits, deploys CAPTCHA, and states that automated booking bots can result in account bans. Reservations are not transferable and may not be resold.

You are agreeing to those terms — read by the maintainer 2026-05-23 — every time you invoke a tool in this server.

**3. Personal, non-commercial use only.** This project is not affiliated with, endorsed by, sponsored by, or in partnership with Resy or American Express. It is a personal automation tool intended only to help one user manage one person's reservations from the command line. Specifically: **do not use it to mass-book**, snipe slot-tokens the moment they open, resell tables, or compete with Resy. The booking tools exist so you can book the table you would have booked anyway, faster.

**4. Stability is not guaranteed.** This server calls the same `api.resy.com` endpoints the Resy mobile app and web app call, with the same public web-app api_key. Resy may change endpoint shapes, rotate keys, or add new bot detection at any time. It may break.

**5. You accept full responsibility** for any consequences of using this server in connection with your Resy account — rate limiting, slot-lock rejections, account warnings, suspension, or bans. If Resy objects to your use, stop using this server.

This section is the maintainer's good-faith summary of the terms — it is not legal advice and does not modify or supersede Resy's actual ToS.

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
