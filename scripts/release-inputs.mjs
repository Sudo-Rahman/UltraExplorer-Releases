import { appendFileSync } from 'node:fs';
import { validateVersion } from './updater-manifest.mjs';
const { CHANNEL: channel, SOURCE_SHA: sha, SOURCE_TAG: tag, TEST_VERSION: testVersion } = process.env;
const version = channel === 'stable' ? tag?.replace(/^v/, '') : testVersion;
validateVersion(version ?? '', channel);
if (channel === 'stable' && (tag !== `v${version}` || sha || testVersion)) throw new Error('Stable requires only a source_tag');
if (channel === 'updater-test' && (!/^[0-9a-f]{40}$/.test(sha ?? '') || tag)) throw new Error('Test requires exact source_sha and no source_tag');
const matrix = channel === 'stable' ? [
  {runner:'ubuntu-latest',artifact:'linux-x64',platform:'linux-x86_64',distribution:'linux-appimage'},
  {runner:'windows-latest',artifact:'windows-x64',platform:'windows-x86_64',distribution:'windows-direct'},
  {runner:'macos-latest',artifact:'macos-arm64',platform:'darwin-aarch64',distribution:'macos-direct'},
] : [{runner:'macos-latest',artifact:'macos-arm64',platform:'darwin-aarch64',distribution:'macos-direct'}];
for (const [key,value] of Object.entries({ version, tag:`v${version}`, ref:channel === 'stable' ? tag : sha, matrix:JSON.stringify({include:matrix}) })) appendFileSync(process.env.GITHUB_OUTPUT,`${key}=${value}\n`);
