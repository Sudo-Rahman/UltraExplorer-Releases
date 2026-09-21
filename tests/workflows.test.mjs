import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CI_PATH = new URL('../.github/workflows/ci.yml', import.meta.url);
const RELEASE_PATH = new URL('../.github/workflows/release.yml', import.meta.url);

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

test('release validates a private source SHA before publishing native bundles and GHCR', async () => {
	const contents = await workflow(RELEASE_PATH);

	assert.match(contents, /^\s{2}workflow_dispatch:/m);
	assertNoPublicCodeTrigger(contents);
	assert.match(contents, /uses:\s+\.\/.github\/workflows\/ci\.yml/);
	assert.match(contents, /source_sha:\s+\$\{\{\s*inputs\.source_sha\s*\}\}/);
	assertPrivateCheckoutIsHardened(contents);
	assertActionsArePinned(contents);

	for (const runner of ['ubuntu-latest', 'windows-latest', 'macos-latest', 'macos-15-intel']) {
		assert.ok(contents.includes(runner), `missing release runner: ${runner}`);
	}

	assert.match(contents, /pnpm desktop:build --ci/);
	assert.match(contents, /gh release create/);
	assert.match(contents, /ghcr\.io\/sudo-rahman\/ultra-explorer/);
	assert.match(contents, /platforms:\s+linux\/amd64,linux\/arm64/);
	assert.match(contents, /packages:\s+write/);
	assert.match(contents, /attestations:\s+write/);
	assert.match(contents, /id-token:\s+write/);
	assert.doesNotMatch(contents, /cache-to:\s*type=gha/);
});
