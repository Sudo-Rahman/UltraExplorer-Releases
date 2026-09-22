import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  archiveKey,
  packDirectory,
  unpackDirectory,
} from "../scripts/encrypted-archive.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ultra-cache-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "private source");
  await mkdir(join(source, "deps"), { recursive: true });
  await mkdir(join(source, "incremental"));
  await mkdir(join(source, "bundle"));
  await writeFile(
    join(source, "deps", "private.o"),
    "private source material\n",
  );
  await writeFile(join(source, "incremental", "temporary"), "discard");
  await writeFile(join(source, "bundle", "installer"), "discard");
  return {
    root,
    source,
    archive: join(root, "cache.enc"),
    key: randomBytes(32),
  };
}

test("round-trips compiled files without publishing plaintext or redundant build trees", async (t) => {
  const f = await fixture(t);
  await packDirectory(f.source, f.archive, "windows/target", f.key, [
    "./incremental",
    "./bundle",
  ]);
  assert.equal(
    (await readFile(f.archive)).includes(
      Buffer.from("private source material"),
    ),
    false,
  );
  const restored = join(f.root, "restored");
  await unpackDirectory(f.archive, restored, "windows/target", f.key);
  assert.equal(
    await readFile(join(restored, "deps/private.o"), "utf8"),
    "private source material\n",
  );
  await assert.rejects(stat(join(restored, "incremental")), { code: "ENOENT" });
  await assert.rejects(stat(join(restored, "bundle")), { code: "ENOENT" });
});

test("rejects wrong keys, swapped cache families and tampering before extraction", async (t) => {
  const f = await fixture(t);
  await packDirectory(f.source, f.archive, "linux/target", f.key);
  const destination = join(f.root, "must not exist");
  await assert.rejects(
    unpackDirectory(f.archive, destination, "linux/target", randomBytes(32)),
  );
  await assert.rejects(
    unpackDirectory(f.archive, destination, "macos/target", f.key),
  );
  const bytes = await readFile(f.archive);
  bytes[25] ^= 1;
  await writeFile(f.archive, bytes);
  await assert.rejects(
    unpackDirectory(f.archive, destination, "linux/target", f.key),
  );
  await assert.rejects(stat(destination), { code: "ENOENT" });
});

test("rejects truncated archives and missing or malformed key configuration", async (t) => {
  const f = await fixture(t);
  await writeFile(f.archive, "short");
  await assert.rejects(
    unpackDirectory(f.archive, join(f.root, "out"), "target", f.key),
    /Invalid encrypted archive/,
  );
  for (const key of ["", "abc", randomBytes(16).toString("base64")])
    assert.throws(() => archiveKey(key));
  assert.equal(archiveKey(f.key.toString("base64")).length, 32);
});
