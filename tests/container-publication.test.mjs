import assert from "node:assert/strict";
import { test } from "node:test";
import { testedDigest } from "../scripts/container-digest.mjs";
import { validateIndex } from "../scripts/publish-container.mjs";

const image = "ghcr.io/sudo-rahman/ultra-explorer";
const digests = {
  amd64: `sha256:${"a".repeat(64)}`,
  arm64: `sha256:${"b".repeat(64)}`,
};
const index = () => ({
  manifests: Object.entries(digests).map(([architecture, digest]) => ({
    digest,
    platform: { os: "linux", architecture },
  })),
});

test("publication selects only the pushed digest of the tested repository", () => {
  assert.equal(
    testedDigest(
      [`other/image@${digests.arm64}`, `${image}@${digests.amd64}`],
      image,
    ),
    digests.amd64,
  );
  assert.throws(() => testedDigest([], image));
  assert.throws(() => testedDigest([`${image}@bad`], image));
  assert.throws(() =>
    testedDigest(
      Object.values(digests).map((digest) => `${image}@${digest}`),
      image,
    ),
  );
});

test("index publication requires both exact tested native platforms", () => {
  assert.doesNotThrow(() => validateIndex(index(), digests));
  const missing = index();
  missing.manifests.pop();
  assert.throws(() => validateIndex(missing, digests));
  const wrong = index();
  wrong.manifests[1].digest = digests.amd64;
  assert.throws(() => validateIndex(wrong, digests));
  const duplicate = index();
  duplicate.manifests[1].platform.architecture = "amd64";
  assert.throws(() => validateIndex(duplicate, digests));
  const platform = index();
  platform.manifests[1].platform.os = "windows";
  assert.throws(() => validateIndex(platform, digests));
});
