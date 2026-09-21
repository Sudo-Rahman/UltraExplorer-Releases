# Publishing Ultra Explorer

Actions run in this public repository, checking out private source through the
read-only `ULTRAEXPLORER_DEPLOY_KEY`. Only installable binaries, updater payloads,
signatures, checksums and manifests are published. No source archives, private
source caches or repository tokens are uploaded or embedded in the application.
All external actions remain pinned to their existing full commit SHAs.

## Stable

The existing `release.yml` accepts `channel=stable` (default) and `source_tag=vX.Y.Z`.
The tag must belong to private `main`; package.json, workspace Cargo version and
Tauri config must match it. Run the full quality gate, three desktop builds
(macOS ARM64, Windows x64, Linux x64 AppImage), and Docker publication. No DEB/RPM.

The updater collector requires a signed `.app.tar.gz`, `.exe` (NSIS), or `.AppImage`
for the corresponding platform. Each signature is collected, including `.sig`
files which an installer-only glob would miss. A deterministic manifest requires
all three platforms. The workflow uploads all release assets to a draft, then
publishes it as latest stable. Failure leaves the draft unpublished; inspect it
before deleting/retrying. Versioned releases are never silently overwritten.

```bash
gh workflow run release.yml --repo Sudo-Rahman/UltraExplorer-Releases \
  --ref codex/distribution-updater -f channel=stable -f source_tag=v0.1.1
```

The stable app feed is
`https://github.com/Sudo-Rahman/UltraExplorer-Releases/releases/latest/download/latest.json`.

## Isolated macOS updater test

Push the coordinated source and public tooling commits to their dedicated branches
first. Neither main branch needs to change. `release.yml` already exists on the
public default branch, so dispatch the updated definition using `--ref`:

```bash
gh workflow run release.yml --repo Sudo-Rahman/UltraExplorer-Releases \
  --ref codex/distribution-updater -f channel=updater-test \
  -f source_sha=FULL_40_CHARACTER_SOURCE_SHA -f test_version=0.1.1-updater.1
```

Install the resulting public prerelease DMG on an Apple Silicon Mac. Dispatch
again with `test_version=0.1.1-updater.2`, then exercise the application's update
check/download/install/relaunch path from version 1. The exact SHA may be on a
feature branch and is not required to belong to main. The launcher overrides the
Tauri package version for this build, without editing canonical source files.

Test CI still runs frontend, PWA, browser E2E, workspace Rust lint/tests and macOS
desktop tests with `cargo test --locked -p ultra-desktop --all-features`. The CI
compile distribution stays `development`, so updater registration remains disabled
while `application_update_tests` exercise the real plugin verifier with synthetic
signatures, loopback responses and a mock runtime. Default workspace tests skip
these optional-feature tests; Clippy only compiles them. Docker checks and publication are skipped, as are Windows/Linux
desktop builds. Versioned assets live on `v0.1.1-updater.N` public prereleases.
The app embeds the isolated public feed
`https://github.com/Sudo-Rahman/UltraExplorer-Releases/releases/download/updater-test/latest.json`.
Only after versioned assets are public does that prerelease feed advance. All test
releases use `--prerelease --latest=false`, and test publication is serialized.
A failure replacing the feed can temporarily remove the test manifest; rerun the
feed upload after diagnosis. It cannot change the stable feed.

The stable route rejects prerelease versions or incomplete platform matrices.
The test route rejects non-test versions and non-macOS manifest entries. A passing
workflow is not proof of an installed upgrade: manually verify persistence,
shutdown, relaunch and displayed application version on the target Mac.

## Credentials and protections

Configure the existing `release` environment approval rules as appropriate.
Required secrets: `ULTRAEXPLORER_DEPLOY_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, and the
existing Apple signing/notarization secrets (`APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`,
`APPLE_API_ISSUER`, `APPLE_API_PRIVATE_KEY`). Set
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only for an encrypted updater key. The public
verification key is compiled in private source; never publish the signing key.
Updater signing does not replace Apple signing or Windows Authenticode.

GitHub's job-scoped token supplies contents write for release publication and
packages write for stable Docker publication. No token is needed by installed apps.
The existing `snapshot.yml` keeps its private draft route and platform selection;
it now selects explicit direct profiles and collects updater signatures. Its
private-draft authorization remains `PRIVATE_BUILDS_TOKEN`.

## Local validation

```bash
node --test tests/*.test.mjs
actionlint .github/workflows/*.yml
```

Tests cover complete/missing/duplicate platform manifests, absent or empty payloads
and signatures, filenames/URL encoding, deterministic output, strict channel
versions, collectors and workflow profile/isolation contracts. These tests do not
cryptographically verify signatures or exercise hosted Actions/signing credentials.

Upload filenames are normalized to ASCII letters, digits, dots, underscores, and
hyphens before the manifest is generated. GitHub can rewrite spaces in asset names;
URL encoding alone does not preserve those names. After draft upload, the workflow
compares all local asset names with GitHub's actual asset list before publication.
