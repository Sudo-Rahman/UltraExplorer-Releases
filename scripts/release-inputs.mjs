import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { expectedPlatforms, validateVersion } from "./updater-manifest.mjs";
const tag = process.env.SOURCE_TAG;
const version = tag?.replace(/^v/, "");
validateVersion(version ?? "");
if (tag !== `v${version}`) throw new Error("A source tag vX.Y.Z is required");
// Every supported desktop platform. A release publishes the selected ones.
const supported = {
  linux: {
    runner: "ubuntu-latest",
    artifact: "linux-x64",
    platform: "linux-x86_64",
    distribution: "linux-appimage",
  },
  windows: {
    runner: "windows-latest",
    artifact: "windows-x64",
    platform: "windows-x86_64",
    distribution: "windows-direct",
  },
  macos: {
    runner: "macos-latest",
    artifact: "macos-arm64",
    platform: "darwin-aarch64",
    distribution: "macos-direct",
  },
};
const requested = (process.env.PLATFORMS || Object.keys(supported).join(","))
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
if (
  requested.length === 0 ||
  new Set(requested).size !== requested.length ||
  requested.some((name) => !Object.hasOwn(supported, name))
)
  throw new Error(
    `Platforms must be a comma-separated list of ${Object.keys(supported).join(", ")}`,
  );
const matrix = Object.entries(supported)
  .filter(([name]) => requested.includes(name))
  .map(([, entry]) => entry);
const platforms = matrix.map((entry) => entry.platform);
if (platforms.some((platform) => !expectedPlatforms.includes(platform)))
  throw new Error("Unsupported updater platform");
// Installed applications read the latest manifest: a platform published before must stay in
// every later release, or its users would lose updates. A platform whose payload is no longer an
// asset of the previous release already cannot update, so it does not bind the next one.
const previous = process.env.PREVIOUS_MANIFEST;
if (previous && existsSync(previous)) {
  const assetsFile = process.env.PREVIOUS_ASSETS;
  const assets = assetsFile && existsSync(assetsFile)
    ? new Set(JSON.parse(readFileSync(assetsFile, "utf8")).assets.map((asset) => asset.name))
    : null;
  const published = Object.entries(JSON.parse(readFileSync(previous, "utf8")).platforms ?? {})
    .filter(([, entry]) => !assets || assets.has(decodeURIComponent(String(entry.url ?? "").split("/").pop())))
    .map(([platform]) => platform);
  const dropped = published.filter((platform) => !platforms.includes(platform));
  if (dropped.length)
    throw new Error(`The previous release published ${dropped.join(", ")}; keep it selected`);
}
for (const [key, value] of Object.entries({
  version,
  tag,
  ref: tag,
  matrix: JSON.stringify({ include: matrix }),
  platforms: platforms.join(","),
})) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
