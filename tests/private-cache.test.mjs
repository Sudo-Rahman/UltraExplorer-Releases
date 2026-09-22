import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("CI cache lifecycle restores Cargo and pnpm while excluding only redundant target outputs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ultra-cache-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const cargo = join(root, "cargo");
  const output = join(root, "outputs");
  const files = [
    [
      join(workspace, "source/target/debug/deps/library.rlib"),
      "compiled private code",
    ],
    [join(workspace, "source/target/debug/bundle/old-installer"), "redundant"],
    [
      join(cargo, "registry/src/dependency/bundle/required.rs"),
      "required dependency source",
    ],
    [join(workspace, ".pnpm-store/package"), "dependency package"],
  ];
  for (const [path, value] of files) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value);
  }
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: workspace,
    CARGO_HOME: cargo,
    RUNNER_TEMP: join(root, "tmp"),
    GITHUB_OUTPUT: output,
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_JOB: "desktop",
    CACHE_GROUP: "desktop",
    CACHE_KIND: "native",
    CACHE_DEPENDENCY: "lockfile",
    PRIVATE_BUILD_CACHE_KEY: randomBytes(32).toString("base64"),
  };
  const run = (operation) =>
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("../scripts/private-cache.mjs", import.meta.url)),
        operation,
      ],
      { env, encoding: "utf8" },
    );
  run("init");
  assert.match(
    readFileSync(output, "utf8"),
    /prefix=v1-desktop-Linux-X64-rust190-/,
  );
  run("save");
  for (const [path] of files) rmSync(path);
  run("restore");
  assert.equal(readFileSync(files[0][0], "utf8"), files[0][1]);
  assert.throws(() => readFileSync(files[1][0]), { code: "ENOENT" });
  assert.equal(readFileSync(files[2][0], "utf8"), files[2][1]);
  assert.equal(readFileSync(files[3][0], "utf8"), files[3][1]);
});
