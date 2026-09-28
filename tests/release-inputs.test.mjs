import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
function request(t, values) {
  const directory = mkdtempSync(join(tmpdir(), "ultra-release-inputs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "output");
  const result = spawnSync(
    process.execPath,
    [new URL("../scripts/release-inputs.mjs", import.meta.url).pathname],
    {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, SOURCE_TAG: "", ...values, GITHUB_OUTPUT: output },
    },
  );
  return {
    status: result.status,
    values:
      result.status === 0
        ? Object.fromEntries(
            readFileSync(output, "utf8")
              .trim()
              .split("\n")
              .map((line) => {
                const i = line.indexOf("=");
                return [line.slice(0, i), line.slice(i + 1)];
              }),
          )
        : null,
  };
}
test("stable dispatch pins a tag and complete platform matrix", (t) => {
  const r = request(t, { SOURCE_TAG: "v1.0.0" });
  assert.equal(r.status, 0);
  assert.equal(r.values.ref, "v1.0.0");
  assert.equal(r.values.version, "1.0.0");
  assert.deepEqual(
    JSON.parse(r.values.matrix)
      .include.map((x) => x.platform)
      .sort(),
    ["darwin-aarch64", "linux-x86_64", "windows-x86_64"],
  );
});
test("missing tags, branch names, raw commits and prereleases fail closed", (t) => {
  for (const tag of [
    "",
    "main",
    "a".repeat(40),
    "1.0.0",
    "v1.0.0-beta.1",
    "v01.0.0",
    "v1.0.0\nextra",
  ]) {
    assert.notEqual(request(t, { SOURCE_TAG: tag }).status, 0);
  }
});
test("a release publishes the selected platforms in a stable order", (t) => {
  const r = request(t, { SOURCE_TAG: "v1.0.1", PLATFORMS: "windows, macos" });
  assert.equal(r.status, 0);
  assert.deepEqual(
    JSON.parse(r.values.matrix).include.map((x) => x.artifact),
    ["windows-x64", "macos-arm64"],
  );
  assert.equal(r.values.platforms, "windows-x86_64,darwin-aarch64");
});
test("unknown, duplicate or empty platform selections fail closed", (t) => {
  for (const PLATFORMS of ["ios", "macos,macos", ",", "macos,linux-appimage"]) {
    assert.notEqual(request(t, { SOURCE_TAG: "v1.0.1", PLATFORMS }).status, 0);
  }
});
test("a platform published by the previous release cannot be dropped", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ultra-previous-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const previous = join(directory, "latest.json");
  writeFileSync(
    previous,
    JSON.stringify({ version: "1.0.0", platforms: { "darwin-aarch64": {}, "windows-x86_64": {} } }),
  );
  const keep = request(t, { SOURCE_TAG: "v1.0.1", PLATFORMS: "macos,windows", PREVIOUS_MANIFEST: previous });
  assert.equal(keep.status, 0);
  const add = request(t, { SOURCE_TAG: "v1.0.1", PLATFORMS: "macos,windows,linux", PREVIOUS_MANIFEST: previous });
  assert.equal(add.status, 0);
  assert.notEqual(
    request(t, { SOURCE_TAG: "v1.0.1", PLATFORMS: "macos", PREVIOUS_MANIFEST: previous }).status,
    0,
  );
  const first = request(t, { SOURCE_TAG: "v1.0.1", PLATFORMS: "macos", PREVIOUS_MANIFEST: join(directory, "none.json") });
  assert.equal(first.status, 0);
});
