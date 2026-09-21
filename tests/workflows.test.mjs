import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CI_PATH = new URL('../.github/workflows/ci.yml', import.meta.url);
const RELEASE_PATH = new URL('../.github/workflows/release.yml', import.meta.url);
const SNAPSHOT_PATH = new URL('../.github/workflows/snapshot.yml', import.meta.url);
const README_PATH = new URL('../README.md', import.meta.url);

async function workflow(path) {
	return readFile(path, 'utf8');
}

function assertNoPublicCodeTrigger(contents) {
	assert.doesNotMatch(contents, /^\s{2}(?:push|pull_request|pull_request_target|schedule):/m);
}

function assertActionsArePinned(contents) {
	for (const [, action, revision] of contents.matchAll(/^\s*- uses:\s+([^\s@]+)@([^\s#]+)/gm)) {
		if (action.startsWith('./')) continue;
		assert.match(revision, /^[0-9a-f]{40}$/, `${action} must be pinned to a full commit SHA`);
	}
}

function assertPrivateCheckoutIsHardened(contents) {
	assert.match(contents, /repository:\s+Sudo-Rahman\/UltraExplorer/);
	assert.match(contents, /ref:\s+\$\{\{\s*inputs\.source_sha\s*\}\}/);
	assert.match(contents, /ssh-key:\s+\$\{\{\s*secrets\.ULTRAEXPLORER_DEPLOY_KEY\s*\}\}/);
	assert.match(contents, /persist-credentials:\s+false/);
	assert.match(contents, /path:\s+source/);
	assert.match(contents, /\^\[0-9a-f\]\{40\}\$/);
}

test('CI only runs trusted manual or reusable invocations', async () => {
	const contents = await workflow(CI_PATH);

	assert.match(contents, /^\s{2}workflow_dispatch:/m);
	assert.match(contents, /^\s{2}workflow_call:/m);
	assertNoPublicCodeTrigger(contents);
	assertPrivateCheckoutIsHardened(contents);
	assertActionsArePinned(contents);
});

test('CI mirrors the private repository quality gates without source-bearing caches', async () => {
	const contents = await workflow(CI_PATH);

	for (const expected of [
		'pnpm check:branding',
		'pnpm i18n:check',
		'pnpm --filter @ultra/ui lint',
		'pnpm --filter @ultra/ui check',
		'pnpm test',
		'node --test apps/ui/scripts/pwa-production.test.mjs',
		'pnpm --filter @ultra/ui test:e2e',
		'cargo fmt --all --check',
		'cargo clippy --locked --workspace --all-targets --all-features -- -D warnings',
		'cargo test --locked --workspace',
		'cargo test --locked -p ultra-desktop --all-features',
		'bash ./scripts/docker-smoke.sh ultra-explorer:ci'
	]) {
		assert.ok(contents.includes(expected), `missing quality gate: ${expected}`);
	}

	assert.doesNotMatch(contents, /path:\s*\|[\s\S]{0,300}^\s*target\s*$/m);
	assert.doesNotMatch(contents, /cache-to:\s*type=gha/);
	assert.doesNotMatch(contents, /actions\/upload-artifact/);
});

test('a manually selected private main tag runs the complete release CI', async () => {
	const contents = await workflow(RELEASE_PATH);

	assert.match(contents, /^\s{2}workflow_dispatch:/m);
	assertNoPublicCodeTrigger(contents);
	assert.match(contents, /source_tag:\n\s+description:/);
	assert.match(contents, /uses:\s+\.\/.github\/workflows\/ci\.yml/);
	assert.match(contents, /needs:\s+validate-release/);
	assert.match(
		contents,
		/source_sha:\s+\$\{\{\s*needs\.validate-release\.outputs\.source_sha\s*\}\}/
	);
	assert.match(contents, /ref:\s+\$\{\{\s*steps\.request\.outputs\.ref\s*\}\}/);
	assert.match(contents, /fetch-depth:\s+0/);
	assert.match(contents, /git merge-base --is-ancestor HEAD origin\/main/);
	assert.match(contents, /source_sha=\$\(git rev-parse HEAD\)/);
	assert.match(contents, /node release-tools\/scripts\/release-inputs\.mjs/);
	assert.match(contents, /ssh-key:\s+\$\{\{\s*secrets\.ULTRAEXPLORER_DEPLOY_KEY\s*\}\}/);
	assert.match(contents, /persist-credentials:\s+false/);
	assertActionsArePinned(contents);

	for (const runner of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
		assert.ok(
			(await workflow(new URL('../scripts/release-inputs.mjs', import.meta.url))).includes(runner),
			`missing release runner: ${runner}`
		);
	}
	assert.doesNotMatch(contents, /macos-15-intel|macos-x64/);

	assert.match(contents, /pnpm desktop:build/);
	assert.match(
		contents,
		/build-docker:[\s\S]*?needs:\s+\[quality, validate-release, build-desktop\]/
	);
	assert.match(contents, /gh release create/);
	assert.match(contents, /ghcr\.io\/sudo-rahman\/ultra-explorer/);
	assert.match(contents, /platforms:\s+linux\/amd64,linux\/arm64/);
	assert.match(contents, /packages:\s+write/);
	assert.match(contents, /attestations:\s+write/);
	assert.match(contents, /id-token:\s+write/);
	assert.doesNotMatch(contents, /cache-to:\s*type=gha/);
});

test('README uses the transparent website logo asset', async () => {
	const contents = await workflow(README_PATH);

	assert.match(contents, /assets\/ultra-explorer\.webp/);
	assert.doesNotMatch(contents, /assets\/ultra-explorer\.png/);
});

test('snapshot builds upload installers directly to the private builds repository', async () => {
	const contents = await workflow(SNAPSHOT_PATH);

	assert.match(contents, /^\s{2}workflow_dispatch:/m);
	assertNoPublicCodeTrigger(contents);
	assertPrivateCheckoutIsHardened(contents.replaceAll('inputs.source_ref', 'inputs.source_sha'));
	assertActionsArePinned(contents);
	assert.match(contents, /Sudo-Rahman\/UltraExplorer-Builds/);
	assert.match(contents, /secrets\.PRIVATE_BUILDS_TOKEN/);
	assert.match(contents, /gh release create[\s\S]*--draft/);
	assert.match(contents, /gh release upload/);
	assert.match(contents, /pnpm desktop:build/);
	assert.match(contents, /cargo test --locked -p ultra-desktop/);
	assert.match(contents, /needs\.resolve-source\.outputs\.matrix/);
	assert.doesNotMatch(contents, /actions\/upload-artifact/);
	assert.doesNotMatch(contents, /cache-to:\s*type=gha/);
});

test('release and snapshot use explicit distribution profiles and signature collection', async () => {
	const release = await workflow(RELEASE_PATH);
	const snapshot = await workflow(SNAPSHOT_PATH);
	const inputs = await workflow(new URL('../scripts/release-inputs.mjs', import.meta.url));
	assert.match(inputs, /distribution:\s*[\'"]linux-appimage[\'"]/);
	assert.match(inputs, /distribution:\s*[\'"]windows-direct[\'"]/);
	assert.match(inputs, /distribution:\s*[\'"]macos-direct[\'"]/);
	assert.match(release, /updater-manifest.mjs collect/);
	assert.match(release, /updater-manifest.mjs assemble/);
	assert.match(snapshot, /--distribution linux-appimage/);
	assert.match(snapshot, /-name '\*\.sig'/);
	assert.doesNotMatch(release + snapshot, /--bundles (?:deb|rpm)/);
});

test('public releases require main, Cargo version parity and the full quality matrix', async () => {
	const release = await workflow(RELEASE_PATH);
	const ci = await workflow(CI_PATH);
	assert.doesNotMatch(
		release + ci,
		/updater-test|test_version|inputs.channel|desktop_platform|skip_docker/
	);
	assert.ok(release.includes('test "$GITHUB_REF" = refs/heads/main'));
	assert.match(release, /Require the private tag to belong to main/);
	assert.match(release, /node scripts\/application-version.mjs "\$VERSION"/);
	assert.match(release, /--draft=false --latest/);
	assert.ok(
		release.indexOf('updater-manifest.mjs assemble') < release.indexOf('gh release create')
	);
	assert.ok(
		release.indexOf('gh release upload "$TAG"') < release.indexOf('gh release edit "$TAG"')
	);
	assert.ok(
		release.indexOf('updater-manifest.mjs verify') < release.indexOf('gh release edit "$TAG"')
	);
	assert.match(ci, /os: \[ubuntu-latest, macos-latest, windows-latest\]/);
	assert.match(ci, /ULTRA_DISTRIBUTION: development/);
});

test('snapshot and release workflows target macOS Apple Silicon only', async () => {
	for (const path of [SNAPSHOT_PATH, RELEASE_PATH]) {
		const contents = await workflow(path);

		const matrix =
			contents + (await workflow(new URL('../scripts/release-inputs.mjs', import.meta.url)));
		assert.match(matrix, /macos-latest/);
		assert.match(matrix, /macos-arm64/);
		assert.doesNotMatch(contents, /macos-15-intel|macos-x64|--bundles app(?:\s|$)/m);
	}
});

test('snapshot cleanup tolerates a draft release without a materialized Git tag', async () => {
	const contents = await workflow(SNAPSHOT_PATH);

	assert.doesNotMatch(contents, /--cleanup-tag/);
	assert.match(contents, /gh release delete[\s\S]*--yes/);
	assert.match(contents, /git\/refs\/tags\/\$\{SNAPSHOT_TAG\}[\s\S]*\|\| true/);
});

test('macOS snapshot and release builds sign, notarize app and DMG, verify, and clean up', async () => {
	for (const path of [SNAPSHOT_PATH, RELEASE_PATH]) {
		const contents = await workflow(path);

		for (const secret of [
			'APPLE_CERTIFICATE',
			'APPLE_CERTIFICATE_PASSWORD',
			'APPLE_API_PRIVATE_KEY',
			'APPLE_API_KEY',
			'APPLE_API_ISSUER',
			'APPLE_SIGNING_IDENTITY'
		]) {
			assert.ok(contents.includes(`secrets.${secret}`), `missing Apple secret: ${secret}`);
		}

		assert.match(contents, /if:\s+runner\.os == 'macOS'/);
		assert.match(contents, /openssl rand -hex 32/);
		assert.match(contents, /security import[\s\S]*-T \/usr\/bin\/codesign/);
		assert.match(contents, /echo "APPLE_API_KEY_PATH=\$API_KEY_PATH"/);
		assert.match(contents, /\}\s*>> "\$GITHUB_ENV"/);
		assert.match(contents, /codesign --verify --deep --strict/);
		assert.match(contents, /xcrun notarytool submit "\$DMG_PATH"/);
		assert.match(contents, /xcrun stapler staple "\$DMG_PATH"/);
		assert.match(contents, /xcrun stapler validate/);
		assert.match(contents, /spctl -a -vv --type exec/);
		assert.match(contents, /security delete-keychain/);
	}
});

test('selected desktop CI executes optional updater verification tests without enabling development updates', async () => {
	const contents = await workflow(CI_PATH);
	const desktop = contents.slice(
		contents.indexOf('  desktop-platforms:'),
		contents.indexOf('  docker:')
	);
	assert.match(desktop, /cargo test --locked -p ultra-desktop --all-features/);
	assert.match(contents, /ULTRA_DISTRIBUTION: development/);
});

test('macOS artifact builds reject non-ARM64 runners before signing and packaging', async () => {
	for (const path of [RELEASE_PATH, SNAPSHOT_PATH]) {
		const contents = await workflow(path);
		const guard = contents.indexOf('- name: Require native Apple Silicon for macOS artifacts');
		assert.ok(guard >= 0);
		assert.ok(guard < contents.indexOf('- name: Prepare Apple signing and notarization'));
		const step = contents.slice(guard, contents.indexOf('      - name:', guard + 1));
		assert.match(step, /if: runner\.os == 'macOS'/);
		assert.ok(step.includes('if [[ "$(uname -m)" != "arm64" ]]; then'));
		assert.match(step, /exit 1/);
	}
});

test('desktop compilation exercises the direct updater configuration outside test builds', async () => {
	const contents = await workflow(CI_PATH);
	const step = contents.slice(
		contents.indexOf('      - name: Build the complete Tauri application'),
		contents.indexOf('  docker:')
	);
	assert.match(step, /ULTRA_DISTRIBUTION:/);
	for (const distribution of ['macos-direct', 'windows-direct', 'linux-appimage'])
		assert.ok(step.includes(distribution));
	assert.match(step, /pnpm desktop:build --no-bundle --ci/);
});
