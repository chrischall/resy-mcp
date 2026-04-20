# resy-mcp

Resy reservation management as an MCP server for Claude — search restaurants, book tables, manage reservations, favorites, and Priority Notify via natural language.

> ⚠️ Resy does not publish an official API. This server uses the same private endpoints the Resy web app calls, with the public web-app `api_key` and user-level auth via email + password. Use at your own discretion.

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

Copy `.env.example` to `.env` and fill in:

```
RESY_EMAIL=you@example.com
RESY_PASSWORD=changeme
```

For MCPB / Claude Desktop install, the packaged manifest prompts for `Resy Email` and `Resy Password` at configure time.

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
