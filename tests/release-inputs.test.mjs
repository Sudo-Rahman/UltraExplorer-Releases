import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
