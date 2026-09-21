import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collect,
  assetName,
  manifest,
  validateVersion,
  expectedPlatforms,
  verifyUploadedNames,
} from "../scripts/updater-manifest.mjs";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "ultra-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const version = "1.0.0";
  const entries = expectedPlatforms.map((platform) => {
    const suffix = platform.startsWith("darwin")
      ? ".app.tar.gz"
      : platform.startsWith("linux")
        ? ".AppImage"
        : ".exe";
    const filename = assetName(platform, version, suffix);
    writeFileSync(join(directory, filename), "test payload");
    writeFileSync(join(directory, `${filename}.sig`), "test-signature\n");
    return { platform, filename };
  });
  return { directory, version, entries };
}
test("complete matrix is deterministic and encodes asset names against public versioned releases", (t) => {
  const f = fixture(t);
  const result = manifest(f.entries, f.version, f.directory);
  assert.deepEqual(
    result,
    manifest([...f.entries].reverse(), f.version, f.directory),
  );
  assert.equal(Object.keys(result.platforms).length, 3);
  for (const entry of f.entries) {
    const p = result.platforms[entry.platform];
    assert.equal(p.signature, "test-signature");
    assert.equal(
      p.url,
      `https://github.com/Sudo-Rahman/UltraExplorer-Releases/releases/download/v1.0.0/${encodeURIComponent(entry.filename)}`,
    );
    assert.equal(new URL(p.url).hash, "");
  }
});
test("reject missing platform, duplicate platform, missing payload or signature, and empty signature", (t) => {
  const f = fixture(t);
  const run = (e) => manifest(e, f.version, f.directory);
  assert.throws(() => run(f.entries.slice(1)), /Incomplete/);
  assert.throws(() => run([...f.entries, f.entries[0]]), /duplicate platform/);
  const path = join(f.directory, f.entries[0].filename);
  writeFileSync(`${path}.sig`, " \n");
  assert.throws(() => run(f.entries), /Empty signature/);
  rmSync(`${path}.sig`);
  assert.throws(() => run(f.entries), /ENOENT/);
  rmSync(path);
  assert.throws(() => run(f.entries), /ENOENT/);
});
test("reject traversal, wrong version filename, duplicate filenames and unexpected platform", (t) => {
  const f = fixture(t);
  for (const filename of [
    "../bad.exe",
    "bad\\file.exe",
    "wrong.exe",
    `${f.entries[0].platform}-${f.version}-Ultra Explorer.app.tar.gz`,
    f.entries[1].filename,
  ])
    assert.throws(() =>
      manifest(
        [{ ...f.entries[0], filename }, ...f.entries.slice(1)],
        f.version,
        f.directory,
      ),
    );
  assert.throws(() =>
    manifest(
      [{ ...f.entries[0], platform: "darwin-x86_64" }, ...f.entries.slice(1)],
      f.version,
      f.directory,
    ),
  );
});
test("only stable semantic versions are accepted", () => {
  for (const version of [
    "1.0.0-beta.1",
    "0.1.1-updater.2",
    "01.0.0",
    "1.0",
    "v1.0.0",
    "1.0.0+build",
  ])
    assert.throws(() => validateVersion(version));
  assert.doesNotThrow(() => validateVersion("1.0.0"));
});
test("collector includes signature and rejects ambiguous updater payload", (t) => {
  const f = fixture(t);
  const output = join(f.directory, "output");
  // Collector normally sees only the bundle tree, not its output directory.
  const input = join(f.directory, "bundle");
  mkdirSync(join(input, "macos"), { recursive: true });
  mkdirSync(join(input, "dmg"));
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz"), "payload");
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz.sig"), "signature");
  writeFileSync(join(input, "dmg", "Ultra.dmg"), "installer");
  collect(input, output, "darwin-aarch64", f.version);
  const record = JSON.parse(readFileSync(join(output, "darwin-aarch64.json")));
  assert.equal(
    readFileSync(join(output, `${record.filename}.sig`), "utf8"),
    "signature",
  );
  writeFileSync(join(input, "macos", "Another.app.tar.gz"), "payload");
  assert.throws(
    () => collect(input, output, "darwin-aarch64", f.version),
    /exactly one/,
  );
});

test("collector ignores real Tauri staging symlinks and uploads only final platform files", (t) => {
  const f = fixture(t);
  for (const [platform, folder, name, staging] of [
    ["linux-x86_64", "appimage", "Ultra.AppImage", "Ultra.AppDir"],
    ["darwin-aarch64", "macos", "Ultra.app.tar.gz", "Ultra.app"],
    ["windows-x86_64", "nsis", "Ultra.exe", "staging"],
  ]) {
    const input = join(f.directory, platform);
    const output = join(f.directory, `${platform}-output`);
    const stage = join(input, folder, staging);
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "icon.png"), "icon");
    symlinkSync("icon.png", join(stage, ".DirIcon"));
    symlinkSync(
      "usr/share/applications/Ultra.desktop",
      join(stage, "Ultra.desktop"),
    );
    // An unrelated symlink directly in the output folder must also be ignored.
    symlinkSync("missing", join(input, folder, "unrelated-staging-link"));
    writeFileSync(join(stage, name), "not a final artifact");
    writeFileSync(join(input, folder, name), "final payload");
    writeFileSync(join(input, folder, `${name}.sig`), "signature");
    if (platform.startsWith("darwin")) {
      mkdirSync(join(input, "dmg"));
      writeFileSync(join(input, "dmg", "Ultra.dmg"), "installer");
    }
    collect(input, output, platform, f.version);
    const filename = assetName(platform, f.version, name);
    const expected = [filename, `${filename}.sig`, `${platform}.json`];
    if (platform.startsWith("darwin"))
      expected.push(assetName(platform, f.version, "Ultra.dmg"));
    assert.deepEqual(readdirSync(output).sort(), expected.sort());
    assert.equal(readFileSync(join(output, filename), "utf8"), "final payload");
  }
});

test("collector rejects selected artifact and signature symlinks, including dangling ones", (t) => {
  const f = fixture(t);
  for (const [platform, folder, name] of [
    ["linux-x86_64", "appimage", "Ultra.AppImage"],
    ["darwin-aarch64", "macos", "Ultra.app.tar.gz"],
    ["windows-x86_64", "nsis", "Ultra.exe"],
  ]) {
    for (const suffix of ["", ".sig"]) {
      for (const dangling of [false, true]) {
        const input = join(f.directory, `${platform}-${suffix}-${dangling}`);
        mkdirSync(join(input, folder), { recursive: true });
        writeFileSync(join(input, folder, name), "payload");
        writeFileSync(join(input, folder, `${name}.sig`), "signature");
        const selected = join(input, folder, `${name}${suffix}`);
        rmSync(selected);
        if (!dangling) writeFileSync(join(input, "target"), "external input");
        symlinkSync("../target", selected);
        assert.throws(
          () => collect(input, join(input, "output"), platform, f.version),
          /Symlink artifact/,
        );
      }
    }
  }
});

test("collector rejects a selected DMG symlink and manifest rejects symlinked signatures", (t) => {
  const f = fixture(t);
  const input = join(f.directory, "bundle");
  mkdirSync(join(input, "macos"), { recursive: true });
  mkdirSync(join(input, "dmg"));
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz"), "payload");
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz.sig"), "signature");
  symlinkSync("missing", join(input, "dmg", "Ultra.dmg"));
  assert.throws(
    () =>
      collect(input, join(f.directory, "output"), "darwin-aarch64", f.version),
    /Symlink artifact/,
  );
  const signature = join(f.directory, `${f.entries[0].filename}.sig`);
  rmSync(signature);
  symlinkSync(f.entries[0].filename, signature);
  assert.throws(
    () => manifest(f.entries, f.version, f.directory),
    /Symlink artifact/,
  );
});

test("collector normalizes upload names before constructing updater URLs", (t) => {
  const f = fixture(t);
  const input = join(f.directory, "bundle");
  const output = join(f.directory, "output");
  mkdirSync(join(input, "macos"), { recursive: true });
  mkdirSync(join(input, "dmg"));
  writeFileSync(join(input, "macos", "Ultra Explorer.app.tar.gz"), "payload");
  writeFileSync(
    join(input, "macos", "Ultra Explorer.app.tar.gz.sig"),
    "signature",
  );
  writeFileSync(join(input, "dmg", "Ultra Explorer.dmg"), "installer");
  collect(input, output, "darwin-aarch64", f.version);
  const record = JSON.parse(
    readFileSync(join(output, "darwin-aarch64.json"), "utf8"),
  );
  assert.equal(
    record.filename,
    `UltraExplorer_${f.version}_macOS_arm64.app.tar.gz`,
  );
  for (const name of readdirSync(output))
    assert.match(name, /^[A-Za-z0-9._-]+$/);
  for (const entry of f.entries.slice(1)) {
    for (const suffix of ["", ".sig"])
      writeFileSync(
        join(output, entry.filename + suffix),
        readFileSync(join(f.directory, entry.filename + suffix)),
      );
  }
  const result = manifest([record, ...f.entries.slice(1)], f.version, output);
  assert.equal(
    new URL(result.platforms["darwin-aarch64"].url).pathname.split("/").at(-1),
    record.filename,
  );
});

test("publication fails before a draft becomes visible if GitHub renamed or lost an asset", (t) => {
  const f = fixture(t);
  const names = readdirSync(f.directory);
  assert.doesNotThrow(() =>
    verifyUploadedNames(f.directory, {
      assets: names.map((name) => ({ name })),
    }),
  );
  assert.throws(
    () =>
      verifyUploadedNames(f.directory, {
        assets: names.map((name) => ({
          name: name.replace("UltraExplorer_", "UltraExplorer."),
        })),
      }),
    /name mismatch/,
  );
  assert.throws(
    () => verifyUploadedNames(f.directory, { assets: [] }),
    /name mismatch/,
  );
});

test("macOS collection requires exactly one installation DMG", (t) => {
  const f = fixture(t);
  const input = join(f.directory, "bundle");
  mkdirSync(join(input, "macos"), { recursive: true });
  mkdirSync(join(input, "dmg"));
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz"), "payload");
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz.sig"), "signature");
  const run = () =>
    collect(input, join(f.directory, "output"), "darwin-aarch64", f.version);
  assert.throws(run, /exactly one macOS DMG/);
  writeFileSync(join(input, "dmg", "First.dmg"), "installer");
  writeFileSync(join(input, "dmg", "Second.dmg"), "installer");
  assert.throws(run, /exactly one macOS DMG/);
});
