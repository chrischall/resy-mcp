# Changelog

## [0.2.1](https://github.com/chrischall/resy-mcp/compare/v0.2.0...v0.2.1) (2026-05-24)


### Documentation

* add Acknowledgement of Terms section to README ([#22](https://github.com/chrischall/resy-mcp/issues/22)) ([33bab4e](https://github.com/chrischall/resy-mcp/commit/33bab4e3160646c3c4cbd9208fdad7ecfcef8f72))
* canonical auto-merge guidance ([#25](https://github.com/chrischall/resy-mcp/issues/25)) ([a044408](https://github.com/chrischall/resy-mcp/commit/a04440811968f97ae64352374068a675d99bb93a))

## [0.2.0](https://github.com/chrischall/resy-mcp/compare/v0.1.6...v0.2.0) (2026-05-23)


### Features

* **auth:** add @fetchproxy/server fallback as third auth path ([fca6b3f](https://github.com/chrischall/resy-mcp/commit/fca6b3f1b37aa52647c04be14efcc8c50fa96933))
* **book:** validate desired_time format at schema layer ([6492af4](https://github.com/chrischall/resy-mcp/commit/6492af451b3171d2cd0645c9f52cf855b919aa5d))
* **client:** 401/419 re-login and retry ([a358a8b](https://github.com/chrischall/resy-mcp/commit/a358a8b4feb4b3cf0f8630dbe8bc519aed0f6c99))
* **client:** 429 backoff and retry ([f924c7b](https://github.com/chrischall/resy-mcp/commit/f924c7b3737118e67e5ac2352e03c2309527bcd6))
* **client:** auth-like 500 treated as auth failure ([5309e5c](https://github.com/chrischall/resy-mcp/commit/5309e5c8b3027b92b4a8ef64d38838007b0d0505))
* **client:** login and authenticated request ([812830f](https://github.com/chrischall/resy-mcp/commit/812830fd8b04ecd546b8f27567dd432632563eea))
* **deploy:** registry listings for MCP Registry, Claude plugins, ClawHub, PulseMCP, mcpservers.org ([4a82862](https://github.com/chrischall/resy-mcp/commit/4a82862329cda56220cb4ade5fa319e5f3e9d2e1))
* MCP server bootstrap wiring all tool registrations ([b3ae71c](https://github.com/chrischall/resy-mcp/commit/b3ae71c13a515fae28181c2b74ea832c34650696))
* MCPB manifest with user_config credentials ([cdbfe07](https://github.com/chrischall/resy-mcp/commit/cdbfe07abdc2bac57c8a061f5c14135e842b80a0))
* **tools:** composite resy_book (find→details→user→book) ([da35345](https://github.com/chrischall/resy-mcp/commit/da35345959442b46a2e1c39bb79dde04a05db0dd))
* **tools:** favorites list/add/remove ([9ff34ae](https://github.com/chrischall/resy-mcp/commit/9ff34ae6a8e991de6afe867004ec1b5e57a2c3fc))
* **tools:** list reservations and cancel ([1cf7c41](https://github.com/chrischall/resy-mcp/commit/1cf7c4178c387a215fc449d2ec8a25fd42d7c270))
* **tools:** priority notify list/add/remove ([86ee0ba](https://github.com/chrischall/resy-mcp/commit/86ee0bae3bded2f2ae972b4a7e10c19afbcba46a))
* **tools:** resy_get_profile ([9e57f05](https://github.com/chrischall/resy-mcp/commit/9e57f05791bf54e98fcf44756a6f4b7edca3d20a))
* **tools:** resy_list_payment_methods (surfaces IDs for resy_book) ([0b0cd9c](https://github.com/chrischall/resy-mcp/commit/0b0cd9cf7938d5539eb657465c5e64ba13965a04))
* **tools:** venue search, find-slots, get-venue ([17bedfb](https://github.com/chrischall/resy-mcp/commit/17bedfb63ac2946052e738b4faacf14c8545df47))


### Bug Fixes

* **bundle:** add createRequire shim so ws works in ESM bundle ([34cedd3](https://github.com/chrischall/resy-mcp/commit/34cedd3a820962f8532bd9241a8e452bd5027303))
* **bundle:** add createRequire shim so ws works in ESM bundle ([1f2da83](https://github.com/chrischall/resy-mcp/commit/1f2da83f38b00cf7059df1d16a46d0c1a1b8cf95))
* **client:** narrow 500-auth regex to avoid false-positive re-logins ([133ac61](https://github.com/chrischall/resy-mcp/commit/133ac61a85c5a9afa48a9b5b4908b1c3727f5136))
* **client:** silence dotenv v17 stdout banner (breaks JSON-RPC over stdio) ([d179478](https://github.com/chrischall/resy-mcp/commit/d179478b5894710741f490722dbc67ee9fc2616a))
* **deploy:** shorten server.json description to ≤100 chars for MCP Registry ([1bca82e](https://github.com/chrischall/resy-mcp/commit/1bca82e9976b001f32f2f85a82e667a8f685e730))
* **env:** also reject literal "undefined"/"null" in readVar ([c3de5f6](https://github.com/chrischall/resy-mcp/commit/c3de5f63aafdfb9cfa7a591d46f82ed7e123840a))
* **env:** treat blank/whitespace/placeholder env vars as unset ([29526fe](https://github.com/chrischall/resy-mcp/commit/29526fe7993bb976518b1838328c7a9e69844ef9))
* **mcpb:** add .mcpbignore to trim bundle (47 MB → 207 KB) ([77358a1](https://github.com/chrischall/resy-mcp/commit/77358a137f77f928fe2f5c731776c17cd32894f1))
* post-review polish ([dbc38ad](https://github.com/chrischall/resy-mcp/commit/dbc38ad2753e38bbd67a9a2997e0d5f4acddd2f6))
* **tools:** verified endpoints from live smoke ([09a7c95](https://github.com/chrischall/resy-mcp/commit/09a7c95a40519fc1cd457536b1d69a830de98192))
* **tools:** verified write endpoints via live round-trip ([0bb8476](https://github.com/chrischall/resy-mcp/commit/0bb847686ae7e90be50337d22fbcab816617d646))
* **venues:** derive city slug from locality+region (or location.url_slug) ([6264091](https://github.com/chrischall/resy-mcp/commit/6264091c360df8fc979551eb4dc641fb6f76ff8f))


### Refactor

* dedup and reservation improvements ([1f9f741](https://github.com/chrischall/resy-mcp/commit/1f9f741f7adb673789a9fb465cc5d3381cc4c38a))


### Documentation

* **claude-md:** call out 100-char limit on server.json description ([74a9145](https://github.com/chrischall/resy-mcp/commit/74a9145838480ca4915dd175ff04b3894528363f))
* **claude-md:** call out 100-char limit on server.json description ([99a19f6](https://github.com/chrischall/resy-mcp/commit/99a19f663c648dac65353012de2a77aba9588ee5))
* ensure CLAUDE.md is current and complete ([e09c276](https://github.com/chrischall/resy-mcp/commit/e09c276ed5fdcd03818dd593152472267c99f834))
* ensure CLAUDE.md is current and complete ([3ad525a](https://github.com/chrischall/resy-mcp/commit/3ad525a7c19f5db99f5203201ac65ea6c7082ee6))
* README and CLAUDE.md ([11d8db7](https://github.com/chrischall/resy-mcp/commit/11d8db7723ee5591a6b9f237f055661e0d4c3d67))
