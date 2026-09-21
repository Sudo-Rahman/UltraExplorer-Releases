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
		'cargo test --locked -p ultra-desktop',
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
	assert.match(
		contents,
		/ref:\s+\$\{\{\s*inputs\.source_tag\s*\}\}/
	);
	assert.match(contents, /fetch-depth:\s+0/);
	assert.match(contents, /git merge-base --is-ancestor HEAD origin\/main/);
	assert.match(contents, /source_sha=\$\(git rev-parse HEAD\)/);
	assert.match(contents, /VERSION="\$\{SOURCE_TAG#v\}"/);
	assert.match(contents, /ssh-key:\s+\$\{\{\s*secrets\.ULTRAEXPLORER_DEPLOY_KEY\s*\}\}/);
	assert.match(contents, /persist-credentials:\s+false/);
	assertActionsArePinned(contents);

	for (const runner of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
		assert.ok(contents.includes(runner), `missing release runner: ${runner}`);
	}
	assert.doesNotMatch(contents, /macos-15-intel|macos-x64/);

	assert.match(contents, /pnpm desktop:build --ci/);
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
	assert.match(contents, /pnpm desktop:build --ci/);
	assert.match(contents, /cargo test --locked -p ultra-desktop/);
	assert.match(contents, /needs\.resolve-source\.outputs\.matrix/);
	assert.doesNotMatch(contents, /actions\/upload-artifact/);
	assert.doesNotMatch(contents, /cache-to:\s*type=gha/);
});

test('Unix bundle collection excludes Debian internals from Linux snapshots and releases', async () => {
	for (const path of [SNAPSHOT_PATH, RELEASE_PATH]) {
		const contents = await workflow(path);

		assert.match(contents, /if \[\[ "\$RUNNER_OS" == "macOS" \]\]/);
		assert.match(contents, /-name '\*\.AppImage' -o\s+\\?\n?\s*-name '\*\.deb' -o/);
		assert.match(contents, /-name '\*\.dmg' -o\s+\\?\n?\s*-name '\*\.tar\.gz'/);
	}
});

test('snapshot and release workflows target macOS Apple Silicon only', async () => {
	for (const path of [SNAPSHOT_PATH, RELEASE_PATH]) {
		const contents = await workflow(path);

		assert.match(contents, /macos-latest/);
		assert.match(contents, /macos-arm64/);
		assert.doesNotMatch(contents, /macos-15-intel|macos-x64|--bundles app/);
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
