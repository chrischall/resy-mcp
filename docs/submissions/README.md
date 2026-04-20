# Registry submissions — resy-mcp

Ready-to-paste copy for each registry that needs a manual browser-form submission. The automated pipelines (npm, GitHub Release, MCP Registry, ClawHub) are driven by `.github/workflows/release.yml` and fire on every `v*` tag.

## Coverage matrix

| Registry                          | Automated?                               | What runs / where to submit |
| --- | --- | --- |
| **npm**                           | ✅ `release.yml`                          | `npm publish --provenance` |
| **GitHub Releases**               | ✅ `release.yml`                          | `softprops/action-gh-release` — attaches `.skill` + `.mcpb` |
| **modelcontextprotocol/registry** | ✅ `release.yml` (OIDC)                   | `mcp-publisher publish` using `server.json` |
| **PulseMCP**                      | ✅ transitive (auto-ingests from MCP Registry weekly) | — |
| **ClawHub (OpenClaw)**            | ⚠ conditional — needs `CLAWHUB_TOKEN` secret | `clawhub skill publish . --version $VERSION` |
| **mcpservers.org**                | ❌ manual — copy below into [mcpservers.org/submit](https://mcpservers.org/submit) | |
| **Anthropic community plugins**   | ❌ manual — copy below into [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission) | |

## Secrets required

In the GitHub repo settings → Secrets and variables → Actions:

- `NPM_TOKEN` — already set for the `npm publish` step in `release.yml`
- `RELEASE_PAT` — GitHub Personal Access Token used by `tag-and-bump.yml` to push back to main
- `CLAWHUB_TOKEN` — optional. Get it via `npx clawhub login` locally, then copy from `~/Library/Application Support/clawhub/config.json` (macOS) or `$XDG_CONFIG_HOME/clawhub/config.json`. If unset, the ClawHub step no-ops.

## mcpservers.org

**Submission URL:** https://mcpservers.org/submit (free listing)

Fields:

- **Server Name:** `resy-mcp`
- **Short Description:** `Resy reservation management for Claude — search restaurants, book tables, manage reservations, favorites, and Priority Notify via natural language. Uses email + password auth against Resy's private web-app API.`
- **Link:** `https://github.com/chrischall/resy-mcp`
- **Category:** `Productivity` (closest fit — no "Food & Dining" option)
- **Contact Email:** `chris.c.hall@gmail.com`

Skip the $39 "Premium Submit" upgrade.

## Anthropic community plugins

**Submission URL:** https://clau.de/plugin-directory-submission

The form pulls metadata from the repo's `.claude-plugin/plugin.json`, which is already in place. You'll still need to fill in a few human-facing fields. Prepared copy:

- **Repo URL:** `https://github.com/chrischall/resy-mcp`
- **Plugin name:** `resy-mcp`
- **Short description:** `Resy reservation management for Claude — search, book, cancel, favorites, Priority Notify via natural language`
- **Category:** Productivity
- **Tags:** resy, reservations, restaurants, dining, booking, mcp

PRs opened directly against `anthropics/claude-plugins-community` are auto-closed — the form is the only path. Review + automated security scanning runs before your entry lands in the nightly-synced `marketplace.json`.

## PulseMCP

**Nothing to submit.** PulseMCP states:

> "We ingest entries from the Official MCP Registry daily and process them weekly."

Once the MCP Registry publish in `release.yml` succeeds, PulseMCP picks it up within a week. Email `hello@pulsemcp.com` if the listing hasn't appeared after that.

## modelcontextprotocol/registry

Automated via `release.yml`. Manual re-publish (if needed):

```bash
# Install once
brew install mcp-publisher   # or the curl-tar method for non-brew systems

# From repo root, with the current tag matching server.json.version:
mcp-publisher login github
mcp-publisher publish
```

## ClawHub (OpenClaw)

Automated via `release.yml` when `CLAWHUB_TOKEN` secret is present. Manual publish:

```bash
npx clawhub login                    # opens browser
npx clawhub skill publish . --version 0.1.0
```

Publishing here releases the `SKILL.md` under MIT-0 on ClawHub.
