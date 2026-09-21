# Publishing Ultra Explorer

Actions run in this public repository, checking out private source through the
read-only `ULTRAEXPLORER_DEPLOY_KEY`. Only installable binaries, updater payloads,
signatures, checksums and manifests are published. No source archives, private
source caches or repository tokens are uploaded or embedded in the application.
All external actions remain pinned to their existing full commit SHAs.

## Stable releases

The source workspace's `Cargo.toml` is the application version authority. Tauri
inherits that version, and the desktop and server expose it to the shared UI.
The source `pnpm version:sync` command synchronizes JavaScript package metadata;
`pnpm version:check` rejects drift or a Tauri version override.

After merging source into private `main`, create and push its matching `vX.Y.Z`
tag. Dispatch the release workflow from this repository's `main`:

```bash
gh workflow run release.yml --repo Sudo-Rahman/UltraExplorer-Releases \
  --ref main -f source_tag=v1.0.0
```

The workflow rejects prereleases, a tag outside private main, a version that differs
from Cargo, and existing public releases. It resolves the tag once to an immutable
source SHA used by all quality checks and builds. Every run includes the full
frontend/PWA/E2E/Rust quality gate, macOS ARM64, Windows x64, Linux x64 AppImage,
and Docker for amd64/arm64. Store, Flatpak and Snap packaging are separate; no
DEB/RPM bundles are produced. There are no test-channel or platform-skip inputs.

Installers and updater payloads have deterministic ASCII names:

- `UltraExplorer_1.0.0_macOS_arm64.dmg` for installation;
- `UltraExplorer_1.0.0_macOS_arm64.app.tar.gz` and `.sig` for macOS updates;
- `UltraExplorer_1.0.0_Windows_x64.exe` and `.sig` for Windows;
- `UltraExplorer_1.0.0_Linux_x64.AppImage` and `.sig` for Linux.

The collector requires one signed updater payload per platform. Manifest assembly
requires all three platforms and generates `latest.json` with versioned URLs and
signature contents. Checksums and provenance accompany the assets. All files are
uploaded to a draft and their GitHub names verified before publication as latest
stable. Failure leaves the draft unpublished; inspect it before deleting/retrying.
Versioned assets are never silently overwritten. Docker publishes version and
`latest` tags separately; GitHub release publication depends on successful Docker
publication but is not atomic with the container registry.

The stable feed is
`https://github.com/Sudo-Rahman/UltraExplorer-Releases/releases/latest/download/latest.json`.
Experimental binaries using the retired acceptance feed need one installation of
a stable installer to join this feed. A successful build is not proof of an
installed upgrade: verify persistence, shutdown, replacement, relaunch and displayed
version on target systems.

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
and signatures, filenames/URL encoding, deterministic output, strict stable
versions, collectors and workflow profile/publication contracts. These tests do not
cryptographically verify signatures or exercise hosted Actions/signing credentials.

Upload filenames are normalized to ASCII letters, digits, dots, underscores, and
hyphens before the manifest is generated. GitHub can rewrite spaces in asset names;
URL encoding alone does not preserve those names. After draft upload, the workflow
compares all local asset names with GitHub's actual asset list before publication.
