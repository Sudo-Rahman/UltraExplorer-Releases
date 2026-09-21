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
  manifest,
  validateVersion,
  expectedPlatforms,
} from "../scripts/updater-manifest.mjs";
function fixture(t, channel = "stable") {
  const directory = mkdtempSync(join(tmpdir(), "ultra-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const version = channel === "stable" ? "0.1.1" : "0.1.1-updater.2";
  const entries = expectedPlatforms[channel].map((platform) => {
    const suffix = platform.startsWith("darwin")
      ? ".app.tar.gz"
      : platform.startsWith("linux")
        ? ".AppImage"
        : ".exe";
    const filename = `${platform}-${version}-Ultra Explorer #1${suffix}`;
    writeFileSync(join(directory, filename), "test payload");
    writeFileSync(join(directory, `${filename}.sig`), "test-signature\n");
    return { platform, filename };
  });
  return { directory, version, entries };
}
test("complete matrix is deterministic and encodes asset names against public versioned releases", (t) => {
  const f = fixture(t);
  const result = manifest(f.entries, f.version, "stable", f.directory);
  assert.deepEqual(
    result,
    manifest([...f.entries].reverse(), f.version, "stable", f.directory),
  );
  assert.equal(Object.keys(result.platforms).length, 3);
  for (const entry of f.entries) {
    const p = result.platforms[entry.platform];
    assert.equal(p.signature, "test-signature");
    assert.equal(
      p.url,
      `https://github.com/Sudo-Rahman/UltraExplorer-Releases/releases/download/v0.1.1/${encodeURIComponent(entry.filename)}`,
    );
    assert.equal(new URL(p.url).hash, "");
  }
});
test("reject missing platform, duplicate platform, missing payload or signature, and empty signature", (t) => {
  const f = fixture(t);
  const run = (e) => manifest(e, f.version, "stable", f.directory);
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
    f.entries[1].filename,
  ])
    assert.throws(() =>
      manifest(
        [{ ...f.entries[0], filename }, ...f.entries.slice(1)],
        f.version,
        "stable",
        f.directory,
      ),
    );
  assert.throws(() =>
    manifest(
      [{ ...f.entries[0], platform: "darwin-x86_64" }, ...f.entries.slice(1)],
      f.version,
      "stable",
      f.directory,
    ),
  );
});
test("test channel accepts only macOS prerelease and stable rejects prereleases", (t) => {
  const f = fixture(t, "updater-test");
  assert.equal(
    Object.keys(
      manifest(f.entries, f.version, "updater-test", f.directory).platforms,
    ).length,
    1,
  );
  assert.throws(() => validateVersion(f.version, "stable"));
  assert.throws(() => validateVersion("0.1.1", "updater-test"));
});
test("collector includes signature and rejects ambiguous updater payload", (t) => {
  const f = fixture(t, "updater-test");
  const output = join(f.directory, "output");
  // Collector normally sees only the bundle tree, not its output directory.
  const input = join(f.directory, "bundle");
  mkdirSync(join(input, "macos"), { recursive: true });
  mkdirSync(join(input, "dmg"));
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz"), "payload");
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz.sig"), "signature");
  writeFileSync(join(input, "dmg", "Ultra.dmg"), "installer");
  collect(input, output, "darwin-aarch64", f.version, "updater-test");
  const record = JSON.parse(readFileSync(join(output, "darwin-aarch64.json")));
  assert.equal(
    readFileSync(join(output, `${record.filename}.sig`), "utf8"),
    "signature",
  );
  writeFileSync(join(input, "macos", "Another.app.tar.gz"), "payload");
  assert.throws(
    () => collect(input, output, "darwin-aarch64", f.version, "updater-test"),
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
    collect(input, output, platform, f.version, "stable");
    const prefix = `${platform}-${f.version}-`;
    const expected = [
      `${prefix}${name}`,
      `${prefix}${name}.sig`,
      `${platform}.json`,
    ];
    if (platform.startsWith("darwin")) expected.push(`${prefix}Ultra.dmg`);
    assert.deepEqual(readdirSync(output).sort(), expected.sort());
    assert.equal(
      readFileSync(join(output, `${prefix}${name}`), "utf8"),
      "final payload",
    );
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
          () =>
            collect(
              input,
              join(input, "output"),
              platform,
              f.version,
              "stable",
            ),
          /Symlink artifact/,
        );
      }
    }
  }
});

test("collector rejects a selected DMG symlink and manifest rejects symlinked signatures", (t) => {
  const f = fixture(t, "updater-test");
  const input = join(f.directory, "bundle");
  mkdirSync(join(input, "macos"), { recursive: true });
  mkdirSync(join(input, "dmg"));
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz"), "payload");
  writeFileSync(join(input, "macos", "Ultra.app.tar.gz.sig"), "signature");
  symlinkSync("missing", join(input, "dmg", "Ultra.dmg"));
  assert.throws(
    () =>
      collect(
        input,
        join(f.directory, "output"),
        "darwin-aarch64",
        f.version,
        "updater-test",
      ),
    /Symlink artifact/,
  );
  const signature = join(f.directory, `${f.entries[0].filename}.sig`);
  rmSync(signature);
  symlinkSync(f.entries[0].filename, signature);
  assert.throws(
    () => manifest(f.entries, f.version, "updater-test", f.directory),
    /Symlink artifact/,
  );
});
