# Legacy integration reconciliation — 2026-11-21

## Exact source boundary

- Main: `67ed7458339e4db981ed016926affa465d995d2f`.
- Incoming #515: `8e07b78a90c751cc616c761a19580f86a0e44775` (`integration/campus-services-20261106`).
- Merge base: `36317460d47e1c977e2f78b6e0701e79b3f45077`.
- A normal merge produced 222 conflicting paths. This is a history reconciliation with selective ports of missing fixes; it must not replace current application files with November 7 versions.

## Source provenance

All 30 source PRs listed in #515 have subsequently been squash-merged into main. For every row below, `git merge-base --is-ancestor <original-head> <final-PR-head>` succeeds, and the listed squash commit is in the main history. Full SHAs are preserved in `2026-11-21-legacy-source-provenance.json`.

| Reviewed source | Original head in #515 | Final PR head | Main squash |
| --- | --- | --- | --- |
| [#439](https://github.com/Miiduoa/graduation/pull/439) | `3aba2776` | `cdae72c5` | `cdf5b67e` |
| [#470](https://github.com/Miiduoa/graduation/pull/470) | `0291b03a` | `a2d96540` | `58dc17cc` |
| [#473](https://github.com/Miiduoa/graduation/pull/473) | `4b4883c8` | `254013b2` | `04114be9` |
| [#501](https://github.com/Miiduoa/graduation/pull/501) | `b169cddb` | `243d6656` | `d24a7564` |
| [#502](https://github.com/Miiduoa/graduation/pull/502) | `ed2cf4ee` | `25837920` | `9e07c804` |
| [#503](https://github.com/Miiduoa/graduation/pull/503) | `3a02bc06` | `7add4572` | `945981ae` |
| [#504](https://github.com/Miiduoa/graduation/pull/504) | `8a3b9923` | `8a3b9923` | `cacea7e6` |
| [#505](https://github.com/Miiduoa/graduation/pull/505) | `cf019556` | `447b9dc1` | `0bbb08ef` |
| [#506](https://github.com/Miiduoa/graduation/pull/506) | `031fb85a` | `031fb85a` | `09d11b7b` |
| [#507](https://github.com/Miiduoa/graduation/pull/507) | `6f7ce0fb` | `6f7ce0fb` | `36317460` |
| [#508](https://github.com/Miiduoa/graduation/pull/508) | `74e6ee91` | `891c1c04` | `7a8bd819` |
| [#509](https://github.com/Miiduoa/graduation/pull/509) | `3e28f642` | `7553d2dc` | `a14c5c9a` |
| [#510](https://github.com/Miiduoa/graduation/pull/510) | `45fabce9` | `cc72529f` | `162d3aa6` |
| [#511](https://github.com/Miiduoa/graduation/pull/511) | `051b2650` | `518b807d` | `9dca1ee7` |
| [#512](https://github.com/Miiduoa/graduation/pull/512) | `ff6509b0` | `7b4e80af` | `33e65c2b` |
| [#513](https://github.com/Miiduoa/graduation/pull/513) | `7d26311a` | `8cae6b25` | `4357441c` |
| [#514](https://github.com/Miiduoa/graduation/pull/514) | `bc1513a7` | `bc1513a7` | `6fd652c7` |
| [#516](https://github.com/Miiduoa/graduation/pull/516) | `ceeba265` | `3db45e1a` | `d1555303` |
| [#517](https://github.com/Miiduoa/graduation/pull/517) | `9e9f97d7` | `a9506822` | `3ba18e76` |
| [#518](https://github.com/Miiduoa/graduation/pull/518) | `ef891a65` | `40d7f85e` | `ff8a5b9c` |
| [#519](https://github.com/Miiduoa/graduation/pull/519) | `331423a7` | `05c5ae3f` | `9b3a5408` |
| [#520](https://github.com/Miiduoa/graduation/pull/520) | `52fd7864` | `0658f74d` | `8053eb98` |
| [#521](https://github.com/Miiduoa/graduation/pull/521) | `1284c5c1` | `1284c5c1` | `d2ede211` |
| [#523](https://github.com/Miiduoa/graduation/pull/523) | `24b85d71` | `69a43d79` | `067436cd` |
| [#524](https://github.com/Miiduoa/graduation/pull/524) | `d4d368d7` | `689f4eeb` | `18af527f` |
| [#525](https://github.com/Miiduoa/graduation/pull/525) | `f457ab9c` | `30f7a407` | `d5619fb8` |
| [#526](https://github.com/Miiduoa/graduation/pull/526) | `9349defd` | `cf222487` | `71616d03` |
| [#527](https://github.com/Miiduoa/graduation/pull/527) | `d3ac07c9` | `9de1a84a` | `040957b6` |
| [#528](https://github.com/Miiduoa/graduation/pull/528) | `5b48d6e9` | `d7983468` | `8c5d8f47` |
| [#531](https://github.com/Miiduoa/graduation/pull/531) | `db160e8f` | `9a156c99` | `19782c90` |

The additional #491 and #495 histories also have successor squash commits in main. The old #492 candidate `7334d318` and the accepted #498 successor share identical blobs in 76 of its 87 changed paths. The 11 remaining paths contain newer notification ownership/recheck handling, quiz access, more accurate receipt wording, and filtering incomplete announcement rows. Those successor changes stay intact.

Four older Firestore/Storage experimental commits (`351438a1`, `c820b747`, `605b1ed6`, `d2e5c24c`) were already marked superseded in #515. Main retains all four unavailable account states plus canonical-profile checks. The old membership-only Storage fallback is not restored.

## Integration-only fixes

The original branch also contains changes made specifically while integrating its source PRs. These were checked separately from the already-merged feature work.

| Original commit | Resolution in this merge |
| --- | --- |
| `8e07b78a` | Port owner-scoped mobile order access and its regression cases; maintain token expiry and canonical profile checks. |
| `e5c8ea79` | Port structured academic-year/semester selection, retaining literal separators in semester names. |
| `452702ec` | Port academic account rejection for deleted, disabled, suspended and inactive accounts, including pre-cache-transaction tests. |
| `49fe4724` | Port the same four-state rejection to student-card issuance, redemption and saved-receipt reuse; retain newer campus/profile checks. |
| `c2ccfc22` | Port one-time LMS cache parsing/time capture while preserving main's session-version and allowed-course filters. |
| `7ca507cb` | Port the immediate-retry regression. It reproduced a remaining race in main: a passive error effect rejected a newly started recovery. Remove that stale cleanup while keeping main's exactly-once settlement and scope-change rejection. |
| `b15bcc98`, `59a9bf7a` | Port HTML parser-based visible course text, entity decoding and inline/line-break preservation, with malformed/hidden-source regression cases. |
| `fb07188a`, `981fbca3` | Port offline attendance rejection expectations and maintain zero-write assertions; the renamed platform fixture is already present. |
| `2510f81a` | Port awaited native credit-planner render/rerender. |
| `323d7bf6` | Always retain Chrome diagnostics on failed credit-adoption acceptance. |
| `5d1017c7` | Pin credit-adoption runner to Ubuntu 24.04. |
| `2e1e55f6` | Port the Jest 29 `--testPathPattern` correction; keep main's newer bounded smaller-font download. |
| `82e647a6` | Derive the admin merchant locator from the fixture; preserve the current workspace flow. |
| `4c7d574d` | Superseded: main now explicitly rejects an existing-course instructor mismatch at preflight and preserves user edits; do not restore the older separate-teacher-identity expectation. |
| `b1deb6fa` | Already present exactly in the current gap-session fixture. |
| `92ec1b7d` | Superseded: main uses the currently unsupported `tku` school fixture. |
| `6653a0eb`, `ca8cd5f9` | Superseded by current admin authorization assertions, five-entry navigation and footer disclosure checks. |
| `85cdf6a2` | Keep main's newer immutable legacy migration fixture and separate school-scoped collection checks. |

The merge preserves the entire incoming commit graph. Current Node/Next/lockfile, Firestore and Storage policy implementations, current navigation and later source-PR fixes remain from main. The added account/order rules tests exercise existing owner isolation and do not relax database authorization.

## Local validation

- Node 22.23.5; shared runtime generated from this worktree.
- Web: academic authorization, LMS cache/transactions and student-card unit suites pass; account recovery regression initially failed on main and passes after the race repair.
- Mobile: credit draft protection, personal timetable, owner orders and offline dialog — 4 suites, 70 tests passed.
- Functions: PU scraper transport/HTML recognition — 38 tests passed.
- Python/JavaScript syntax and `git diff --check` passed.
- Local dependencies are reused from the available installation; the final combined PR must install and verify its exact frozen lockfile in CI. Emulator-specific student-card and owner-order cases are included but require the final isolated Firestore run; local unit tests are not a substitute for it.

This file records merge reasoning and local verification. It does not represent the required `nuni-merge-gate` App approval or deployment evidence.
