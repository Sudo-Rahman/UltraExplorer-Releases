import {
  readdirSync,
  readFileSync,
  statSync,
  lstatSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export const expectedPlatforms = [
  "darwin-aarch64",
  "linux-x86_64",
  "windows-x86_64",
];
const platformNames = {
  "darwin-aarch64": "macOS_arm64",
  "linux-x86_64": "Linux_x64",
  "windows-x86_64": "Windows_x64",
};
const extensions = {
  "darwin-aarch64": ".app.tar.gz",
  "linux-x86_64": ".AppImage",
  "windows-x86_64": ".exe",
};
const artifactDirectories = {
  "darwin-aarch64": "macos",
  "linux-x86_64": "appimage",
  "windows-x86_64": "nsis",
};
export function assetName(platform, version, path) {
  // Use a stable ASCII name: GitHub rewrites spaces in uploaded asset names.
  const suffix = [
    ".app.tar.gz.sig",
    ".AppImage.sig",
    ".exe.sig",
    ".app.tar.gz",
    ".AppImage",
    ".exe",
    ".dmg",
  ].find((suffix) => path.endsWith(suffix));
  if (!platformNames[platform] || !suffix)
    throw new Error("Unsupported asset type");
  return `UltraExplorer_${version}_${platformNames[platform]}${suffix}`;
}
function requireRegularFile(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Symlink artifact rejected");
  if (!stat.isFile()) throw new Error("Expected regular artifact file");
  return stat;
}
function requireDirectory(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("Expected non-symlink artifact directory");
}
// Tauri's staging trees contain legitimate symlinks. Only inspect final files
// directly inside each platform's output directory, never .app or AppDir trees.
function finalArtifacts(directory, extension) {
  requireDirectory(directory);
  return readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      requireRegularFile(path);
      return path;
    });
}
export function walk(directory) {
  requireDirectory(directory);
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      if (e.isSymbolicLink()) throw new Error("Symlink artifact rejected");
      return e.isDirectory()
        ? walk(join(directory, e.name))
        : [join(directory, e.name)];
    });
}
export function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("A stable version X.Y.Z is required");
}
export function collect(directory, destination, platform, version) {
  validateVersion(version);
  if (!expectedPlatforms.includes(platform))
    throw new Error("Unexpected platform");
  requireDirectory(directory);
  const updater = finalArtifacts(
    join(directory, artifactDirectories[platform]),
    extensions[platform],
  );
  if (updater.length !== 1)
    throw new Error("Expected exactly one updater artifact");
  requireRegularFile(`${updater[0]}.sig`);
  const signature = readFileSync(`${updater[0]}.sig`, "utf8").trim();
  if (!signature) throw new Error("Empty signature");
  const installers = platform.startsWith("darwin")
    ? finalArtifacts(join(directory, "dmg"), ".dmg")
    : [];
  if (platform.startsWith("darwin") && installers.length !== 1)
    throw new Error("Expected exactly one macOS DMG installer");
  const installables = [updater[0], ...installers];
  mkdirSync(destination, { recursive: true });
  const filename = assetName(platform, version, updater[0]);
  const names = new Set();
  for (const file of [...installables, `${updater[0]}.sig`]) {
    if (!requireRegularFile(file).size) throw new Error("Empty artifact");
    const name = assetName(platform, version, file);
    if (names.has(name)) throw new Error("Duplicate normalized asset filename");
    names.add(name);
    copyFileSync(file, join(destination, name));
  }
  writeFileSync(
    join(destination, `${platform}.json`),
    JSON.stringify({ platform, filename }),
  );
}
export function manifest(entries, version, directory) {
  validateVersion(version);
  const platforms = {};
  const filenames = new Set();
  for (const { platform, filename } of [...entries].sort((a, b) =>
    a.platform.localeCompare(b.platform),
  )) {
    if (!expectedPlatforms.includes(platform) || platforms[platform])
      throw new Error("Unexpected or duplicate platform");
    if (
      typeof filename !== "string" ||
      basename(filename) !== filename ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) ||
      filename !== assetName(platform, version, extensions[platform]) ||
      filenames.has(filename)
    )
      throw new Error("Invalid or duplicate filename");
    filenames.add(filename);
    if (!requireRegularFile(join(directory, filename)).size)
      throw new Error("Missing or empty artifact");
    requireRegularFile(join(directory, `${filename}.sig`));
    const signature = readFileSync(
      join(directory, `${filename}.sig`),
      "utf8",
    ).trim();
    if (!signature) throw new Error("Empty signature");
    platforms[platform] = {
      signature,
      url: `https://github.com/Sudo-Rahman/UltraExplorer-Releases/releases/download/v${version}/${encodeURIComponent(filename)}`,
    };
  }
  if (Object.keys(platforms).length !== expectedPlatforms.length)
    throw new Error("Incomplete platform matrix");
  return { version, platforms };
}

export function verifyUploadedNames(directory, release) {
  const actual = new Set(release.assets.map((asset) => asset.name));
  const expected = readdirSync(directory).sort();
  for (const name of expected) {
    requireRegularFile(join(directory, name));
    if (!actual.has(name))
      throw new Error(`GitHub asset name mismatch: ${name}`);
  }
  if (actual.size !== expected.length)
    throw new Error("Unexpected uploaded assets");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === "collect") collect(...args);
  else if (operation === "assemble") {
    const [input, output, version] = args;
    mkdirSync(output, { recursive: true });
    const entries = [];
    for (const file of walk(input)) {
      requireRegularFile(file);
      if (file.endsWith(".json"))
        entries.push(JSON.parse(readFileSync(file, "utf8")));
      else {
        const destination = join(output, basename(file));
        try {
          statSync(destination);
          throw new Error("Duplicate artifact filename");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        copyFileSync(file, destination);
      }
    }
    writeFileSync(
      join(output, "latest.json"),
      `${JSON.stringify(manifest(entries, version, output), null, 2)}\n`,
    );
  } else if (operation === "verify") {
    const [directory, metadata] = args;
    verifyUploadedNames(directory, JSON.parse(readFileSync(metadata, "utf8")));
  } else throw new Error("Expected collect, assemble or verify");
}
