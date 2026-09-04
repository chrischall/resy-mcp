# Changelog

## [0.13.0](https://github.com/chrischall/resy-mcp/compare/v0.12.0...v0.13.0) (2026-09-04)


### Features

* **tools:** compact by default — strip media URLs, and minify every response ([#181](https://github.com/chrischall/resy-mcp/issues/181)) ([6127bd1](https://github.com/chrischall/resy-mcp/commit/6127bd1f888ec2e74566a7ca876e0efda666c58d))


### Bug Fixes

* **deps:** pick up @chrischall/mcp-utils 0.23.2 ([#184](https://github.com/chrischall/resy-mcp/issues/184)) ([bb5a37f](https://github.com/chrischall/resy-mcp/commit/bb5a37f89138f3744ab100aa130fb3b97802fb9b))

## [0.12.0](https://github.com/chrischall/resy-mcp/compare/v0.11.0...v0.12.0) (2026-09-02)


### Features

* **fetchproxy:** route the refresh fallback through the page's MAIN world ([#175](https://github.com/chrischall/resy-mcp/issues/175)) ([26baab1](https://github.com/chrischall/resy-mcp/commit/26baab14243c167e6aeadc53f3a3029f3ff09b1c))
* **fetchproxy:** widen the capture window and derive the bridge deadline ([#178](https://github.com/chrischall/resy-mcp/issues/178)) ([8fb9188](https://github.com/chrischall/resy-mcp/commit/8fb918885f6c3bce94e52624464776030d41dff7))


### Bug Fixes

* **fetchproxy:** import Capability from a declared dependency, and test the floor ([#180](https://github.com/chrischall/resy-mcp/issues/180)) ([3f1fbc7](https://github.com/chrischall/resy-mcp/commit/3f1fbc72597db254572064433f28127883670a71))

## [0.11.0](https://github.com/chrischall/resy-mcp/compare/v0.10.0...v0.11.0) (2026-09-02)


### Features

* **fetchproxy:** read the auth token off the page's own traffic ([#173](https://github.com/chrischall/resy-mcp/issues/173)) ([28b30d5](https://github.com/chrischall/resy-mcp/commit/28b30d57a18fd6fc01a2fb9d3525ba3755c28afe))


### Bug Fixes

* **deps:** take the capabilities fix from @chrischall/mcp-utils 0.19.4 ([#174](https://github.com/chrischall/resy-mcp/issues/174)) ([0deca28](https://github.com/chrischall/resy-mcp/commit/0deca285220ec77ab72f4d3cf05508478c5b648f))
* **fetchproxy:** relay the token bootstrap through the resy.com tab ([#171](https://github.com/chrischall/resy-mcp/issues/171)) ([5a18673](https://github.com/chrischall/resy-mcp/commit/5a18673329e22afb9cd7d31a40f5ac2ba8f1baac))

## [0.10.0](https://github.com/chrischall/resy-mcp/compare/v0.9.1...v0.10.0) (2026-09-02)


### Features

* **fetchproxy:** read the bridge port from RESY_WS_PORT ([#164](https://github.com/chrischall/resy-mcp/issues/164)) ([43353f4](https://github.com/chrischall/resy-mcp/commit/43353f49436683893a0dde5a3d865e602c180f2b))


### Documentation

* **server.json:** list RESY_WS_PORT with the other environment variables ([#168](https://github.com/chrischall/resy-mcp/issues/168)) ([031661b](https://github.com/chrischall/resy-mcp/commit/031661b06734e3d877d2e1bb24530eb2a0e5617d))

## [0.9.1](https://github.com/chrischall/resy-mcp/compare/v0.9.0...v0.9.1) (2026-09-02)


### Bug Fixes

* **venues:** parse Resy's space-separated slot timestamps ([#160](https://github.com/chrischall/resy-mcp/issues/160)) ([0398290](https://github.com/chrischall/resy-mcp/commit/0398290d6b13e12e4b3d054e9446a8ec2557f9ec))

## [0.9.0](https://github.com/chrischall/resy-mcp/compare/v0.8.0...v0.9.0) (2026-08-30)


### Features

* add resy_healthcheck ([#149](https://github.com/chrischall/resy-mcp/issues/149)) ([34d1a65](https://github.com/chrischall/resy-mcp/commit/34d1a6504f135ba0921c1d14870f5324b80fb269))

## [0.8.0](https://github.com/chrischall/resy-mcp/compare/v0.7.0...v0.8.0) (2026-08-29)


### Features

* **deps:** take @fetchproxy/server 2.2.0 so the concentrator can bind its sandbox address ([#146](https://github.com/chrischall/resy-mcp/issues/146)) ([0ed3b42](https://github.com/chrischall/resy-mcp/commit/0ed3b42a7d87b0cfbf73ee486cd758a653ebde70))

## [0.7.0](https://github.com/chrischall/resy-mcp/compare/v0.6.3...v0.7.0) (2026-08-28)


### Features

* cache the minted auth token so a restart skips re-minting ([#135](https://github.com/chrischall/resy-mcp/issues/135)) ([b73c21b](https://github.com/chrischall/resy-mcp/commit/b73c21bdb991445a621fa111c680cda8724624f7))
* **release:** publish resy-fpx alongside resy ([#134](https://github.com/chrischall/resy-mcp/issues/134)) ([2ad5b3c](https://github.com/chrischall/resy-mcp/commit/2ad5b3c6e8d4e34e3ae3e9b502189a89926dd5cb))


### Bug Fixes

* drop the bare resy.com apex from mint.yaml egress, tidy .mcpbignore ([#130](https://github.com/chrischall/resy-mcp/issues/130)) ([5b7cc26](https://github.com/chrischall/resy-mcp/commit/5b7cc2609383237c247452bb4369a866d21e9d2c))


### Documentation

* list the cache env vars in server.json and .env.example ([#143](https://github.com/chrischall/resy-mcp/issues/143)) ([78b40da](https://github.com/chrischall/resy-mcp/commit/78b40da34c0c3172452312afe3c79d143f2a11cf))
* **readme:** npm test now typechecks before running vitest ([#142](https://github.com/chrischall/resy-mcp/issues/142)) ([9613f63](https://github.com/chrischall/resy-mcp/commit/9613f636cd7ca092f9094f65e96d14c5c7703fd8))
* record the token cache in CLAUDE.md ([#140](https://github.com/chrischall/resy-mcp/issues/140)) ([849d1cd](https://github.com/chrischall/resy-mcp/commit/849d1cdda44aa6a2f37d1ffa6bccfd06a02ca541))
* say which description the registry's 100-char cap applies to ([#145](https://github.com/chrischall/resy-mcp/issues/145)) ([b5de1d7](https://github.com/chrischall/resy-mcp/commit/b5de1d75566e9c6451a84467914c36cabffd3c7c))

## [0.6.3](https://github.com/chrischall/resy-mcp/compare/v0.6.2...v0.6.3) (2026-08-06)


### Bug Fixes

* **deps:** move to @fetchproxy/server 2.0.0 for the v3 handshake ([#118](https://github.com/chrischall/resy-mcp/issues/118)) ([125f6b5](https://github.com/chrischall/resy-mcp/commit/125f6b5db4c856c09fa299e6c0af79e55f7e9454))

## [0.6.2](https://github.com/chrischall/resy-mcp/compare/v0.6.1...v0.6.2) (2026-07-30)


### Bug Fixes

* **deps:** bump @fetchproxy/* to 1.7.0 and @chrischall/mcp-utils to 0.14.0 ([#110](https://github.com/chrischall/resy-mcp/issues/110)) ([ff3369c](https://github.com/chrischall/resy-mcp/commit/ff3369c909681b6c7998f20af58f8cae3d7ecb9f))

## [0.6.1](https://github.com/chrischall/resy-mcp/compare/v0.6.0...v0.6.1) (2026-07-19)


### Bug Fixes

* **release:** pin skill-path so the publish job can resolve SKILL.md ([#97](https://github.com/chrischall/resy-mcp/issues/97)) ([47befa5](https://github.com/chrischall/resy-mcp/commit/47befa56843408fca764998e974858bcc26fe9b1))


### Documentation

* replace duplicated fleet policy with a pointer ([#99](https://github.com/chrischall/resy-mcp/issues/99)) ([829a9ea](https://github.com/chrischall/resy-mcp/commit/829a9ea984673718b5d54306ee21242d13eecb30))

## [0.6.0](https://github.com/chrischall/resy-mcp/compare/v0.5.4...v0.6.0) (2026-07-13)


### Features

* **skill:** add resy fpx access skill ([#92](https://github.com/chrischall/resy-mcp/issues/92)) ([1b33a71](https://github.com/chrischall/resy-mcp/commit/1b33a718842a3b92093cc027ed846c31ae4ae616))


### Bug Fixes

* **skill:** url-encode book_token/resy_token in resy-api.md curl examples ([#96](https://github.com/chrischall/resy-mcp/issues/96)) ([40cb410](https://github.com/chrischall/resy-mcp/commit/40cb410d89ab687e0ac207e81013807c56f7ed5a))


### Refactor

* **skill:** move root SKILL.md into skills/, point plugin.json at ./skills/ ([#95](https://github.com/chrischall/resy-mcp/issues/95)) ([ab4ed84](https://github.com/chrischall/resy-mcp/commit/ab4ed840b4c4001526543c3455654c9dda3a9bc4))

## [0.5.4](https://github.com/chrischall/resy-mcp/compare/v0.5.3...v0.5.4) (2026-07-07)


### Bug Fixes

* bump @chrischall/mcp-utils to ^0.10.5 ([#81](https://github.com/chrischall/resy-mcp/issues/81)) ([60e0831](https://github.com/chrischall/resy-mcp/commit/60e0831a1c28fb4739371674d3366f92d07f510d))
* bump @chrischall/mcp-utils to 0.12.0 ([#88](https://github.com/chrischall/resy-mcp/issues/88)) ([89eab7a](https://github.com/chrischall/resy-mcp/commit/89eab7a3d98eccc0cdecbaa600a4a990b2e7c19f))
* confirm-gate resy_book/resy_cancel and stop silent wrong-time booking ([#85](https://github.com/chrischall/resy-mcp/issues/85)) ([0cc2ccd](https://github.com/chrischall/resy-mcp/commit/0cc2ccddb800e0e7e2475c18690810bb349a844b))

## [0.5.3](https://github.com/chrischall/resy-mcp/compare/v0.5.2...v0.5.3) (2026-07-05)


### Bug Fixes

* **deps:** bump esbuild to 0.28.1 (2 Dependabot alerts) ([#73](https://github.com/chrischall/resy-mcp/issues/73)) ([079e8b9](https://github.com/chrischall/resy-mcp/commit/079e8b957038d575d3dfefc34cdaaae6220ceeb8))


### Documentation

* audit CLAUDE.md and add auto-review follow-up convention ([#72](https://github.com/chrischall/resy-mcp/issues/72)) ([cb63fdc](https://github.com/chrischall/resy-mcp/commit/cb63fdc3244e197a7791a8ba528d7ffccea369d3))
* require Conventional Commit PR titles for release-please ([#68](https://github.com/chrischall/resy-mcp/issues/68)) ([2b328ce](https://github.com/chrischall/resy-mcp/commit/2b328cecb3b5bcfaa82b61733b715cc1926abd9e))

## [0.5.2](https://github.com/chrischall/resy-mcp/compare/v0.5.1...v0.5.2) (2026-06-13)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally (upstream curtaincall[#86](https://github.com/chrischall/resy-mcp/issues/86) review) ([#64](https://github.com/chrischall/resy-mcp/issues/64)) ([55fae16](https://github.com/chrischall/resy-mcp/commit/55fae16c29feaff6d9b11e2df4830e22241733a0))


### Documentation

* add MIT LICENSE file and README badges ([#62](https://github.com/chrischall/resy-mcp/issues/62)) ([f0de864](https://github.com/chrischall/resy-mcp/commit/f0de8642e297f21d101273b4f0462932493802a7))
* correct Versioning section to describe release-please ([#60](https://github.com/chrischall/resy-mcp/issues/60)) ([c4b2c87](https://github.com/chrischall/resy-mcp/commit/c4b2c87ad04873727f2aae7a3f3511ffde59f363))

## [0.5.1](https://github.com/chrischall/resy-mcp/compare/v0.5.0...v0.5.1) (2026-06-04)


### Bug Fixes

* adopt @fetchproxy/server 0.13.0 (bridge host failover + re-pairing) ([#52](https://github.com/chrischall/resy-mcp/issues/52)) ([d285b39](https://github.com/chrischall/resy-mcp/commit/d285b397dc8bf785aed0ba4a4936165f76495048))
* adopt @fetchproxy/server 1.0.0 + @chrischall/mcp-utils 0.5.0 ([#54](https://github.com/chrischall/resy-mcp/issues/54)) ([4987de7](https://github.com/chrischall/resy-mcp/commit/4987de7b3b8c575a4b2eb803d5b60a7dd24c7973))

## [0.5.0](https://github.com/chrischall/resy-mcp/compare/v0.4.0...v0.5.0) (2026-05-29)


### Features

* adopt @fetchproxy/server 0.11.0 ([#44](https://github.com/chrischall/resy-mcp/issues/44)) ([b89a0b0](https://github.com/chrischall/resy-mcp/commit/b89a0b0613e3a5efe3b8bfafd61af3ff7502f204))


### Bug Fixes

* **ci:** arm auto-merge from verdict comment when structured_output is empty ([#43](https://github.com/chrischall/resy-mcp/issues/43)) ([a30fddb](https://github.com/chrischall/resy-mcp/commit/a30fddba48950d305b1c8afe63c04e2cad73d6bd))
* **ci:** treat instant-merge race as success in auto-merge arm ([#41](https://github.com/chrischall/resy-mcp/issues/41)) ([50e1b3a](https://github.com/chrischall/resy-mcp/commit/50e1b3ae8fbaa8655bba0ecb3f5bdb27ca3c3f3a))

## [0.4.0](https://github.com/chrischall/resy-mcp/compare/v0.3.0...v0.4.0) (2026-05-28)


### Features

* **auth-fetchproxy:** bump @fetchproxy/server to 0.9.x + opt into keepAliveIntervalMs (closes [#37](https://github.com/chrischall/resy-mcp/issues/37)) ([#38](https://github.com/chrischall/resy-mcp/issues/38)) ([bc1d83f](https://github.com/chrischall/resy-mcp/commit/bc1d83f61933c2387401f21851c924d1d06cf56e))

## [0.3.0](https://github.com/chrischall/resy-mcp/compare/v0.2.4...v0.3.0) (2026-05-27)


### Features

* **auth-fetchproxy:** adopt @fetchproxy/server 0.8.0 ([#35](https://github.com/chrischall/resy-mcp/issues/35)) ([1149c8d](https://github.com/chrischall/resy-mcp/commit/1149c8d76a453f045d881312bdc8ea4a0b70d48f))

## [0.2.4](https://github.com/chrischall/resy-mcp/compare/v0.2.3...v0.2.4) (2026-05-26)


### Bug Fixes

* **ci:** substitute repo name in publish workflow ([#32](https://github.com/chrischall/resy-mcp/issues/32)) ([b1e416c](https://github.com/chrischall/resy-mcp/commit/b1e416c05d59f632090bbf8c22cbcbfbc0e589e9))

## [0.2.3](https://github.com/chrischall/resy-mcp/compare/v0.2.2...v0.2.3) (2026-05-26)


### Documentation

* **claude:** warn against early PRs and call out first-party dep bumps ([#30](https://github.com/chrischall/resy-mcp/issues/30)) ([aee0bb4](https://github.com/chrischall/resy-mcp/commit/aee0bb470220c745eea79b6304d35517512afe48))

## [0.2.2](https://github.com/chrischall/resy-mcp/compare/v0.2.1...v0.2.2) (2026-05-25)


### Bug Fixes

* **ci:** prevent labeled event from cancelling auto-review ([#27](https://github.com/chrischall/resy-mcp/issues/27)) ([8fda9fd](https://github.com/chrischall/resy-mcp/commit/8fda9fdebabc310ece8d8f869edb1375c0b2c51c))

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
