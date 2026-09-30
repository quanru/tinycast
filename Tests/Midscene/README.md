# Tinycast native E2E

This package uses the native `@midscene/test` YAML runner and `@midscene/computer` desktop agent. User operations are `aiAct` and visible outcomes are `aiAssert`; custom `app.open` only prepares and tears down the test world.

The design borrows per-case isolation, trusted model execution, shard artifacts and native report
handling from [Rome #466](https://github.com/rome-os/rome/pull/466) and
[its follow-up #551](https://github.com/rome-os/rome/pull/551). Tinycast has a native floating
palette, so its application journeys use the computer agent rather than a browser context.

The first cases cover arithmetic, offline unit conversion, and searching/opening a synthetic native application named E2E Lantern. They do not use an installed application, real clipboard history, external websites, or the user's Tinycast data.

Each case copies the Debug application into its own temporary directory, assigns a unique `com.tinycast.app.midscene.*` bundle identifier, and prepares a private defaults domain, Application Support directory, cache and launcher search scope. Its onboarding marker and feature defaults are fixture setup. The Debug-only launch seam requires both that bundle prefix and `TINYCAST_E2E_VISIBLE=1`; it opens the real palette and disables background network fetches and global hotkey registration. Release behavior is unchanged. Teardown terminates only the launched Tinycast PID and fixture applications matching both the exact case bundle and bundle URL.

## Checks without a model

```sh
cd Tests/Midscene
npm ci --registry=https://registry.npmjs.org
npm run check
```

This checks TypeScript, collects the YAML with the real Midscene runner, validates the case manifest and registered AI nodes, and runs native report publication tests. It never opens an application or requires model credentials. Existing Swift business harnesses remain separate.

## Visual execution

Use a dedicated macOS 26 desktop with Accessibility, Screen Recording and System Events automation available. Do not run on a shared personal desktop: the computer agent operates the global display, keyboard and mouse even though application data is private. No model tests run automatically on PRs.

Build the Debug scheme and provide `TINYCAST_APP_PATH` pointing to `Tinycast Dev.app`. Populate the four `MIDSCENE_MODEL_*` keys shown in `.env.example` through your CI secret store or process environment. The runner does not source configuration files; credentials are never passed to Tinycast or its fixture application. Opt in with `MIDSCENE_DESKTOP_ENABLED=1` and run `npm test`. `MIDSCENE_SHARD=calculator` or `launcher` selects one shard. Midscene itself owns lifecycle, timeout, progress and case status.

The GitHub workflow first verifies the `macos-26-intel` desktop, runs model-free validation for PRs, and only grants model secrets to the visual step on the default branch, an explicitly trusted owner-configured ref, or a manual dispatch of one of those refs. Set repository variable `MIDSCENE_DESKTOP_ENABLED=true` to opt in. For initial branch validation, set `MIDSCENE_TRUSTED_REF` to its complete ref, such as `refs/heads/test/midscene-e2e`, then clear it after validation. Optional `MIDSCENE_PAGES_URL` ending in `/midscene` publishes precise case report and screenshot URLs in the Summary table; leave it unset to use downloadable artifacts. If a Pages site already exists, configure `MIDSCENE_PAGES_PRESERVE_REF` to its static source branch so CI preserves those files and adds reports under `/midscene`.

## Reports

`midscene_run/framework/` contains the native Midscene Test report; every started AI case also exports its native SDK HTML with inline screenshots, final PNG, and runtime metadata recording its isolated PID and bundle. Artifacts are retained on failure for 14 days. A new run removes stale local output before execution. Report merging uses Midscene's native HTML merger; if it fails, the available original reports are preserved and linked, and CI remains failed. Combined publication does not hide missing or failed cases.

Each visual shard and the combined report job use the Rome Summary layout: attention and passed counts, recorded model names, native report and artifact links, followed by failed, missing and not-run cases. Passed cases appear in a collapsed appendix. Tables show shard, case, a 160px screenshot, status/reason and duration. Case names and screenshots link to the recorded step in the native Test report when available; standalone HTML exports remain the fallback.

All three AI journeys passed on GitHub-hosted `macos-26-intel` in
[run 36682718562](https://github.com/quanru/tinycast/actions/runs/36682718562).
Screenshots show the expression result `60`, conversion result `25.4 cm`, and the opened
E2E Lantern window; runtime metadata confirms separate process and bundle identities.
That run also exposed report-copy ambiguity and timing races in two existing Swift harnesses;
the harnesses now wait for explicit completion and port release, and the merger selects only
canonical exports. Model success is initial integration evidence.

The Intel application is cross-built once on an Apple Silicon runner and shared as a zipped
build artifact; each Intel visual shard still runs on a fresh VM. Swift harnesses run on
Apple Silicon. The merger uses the canonical inline HTML exports and excludes automatic SDK
`report/` copies and framework internals. Without result metadata, available exports remain
linked and mergeable while the case remains missing.

Pages preserves the configured baseline site and publishes the current run. Earlier hosted report
URLs expire when the next site replaces them; downloadable artifacts retain the evidence for 14 days.
