import { appendFileSync } from "node:fs";
import { validateVersion } from "./updater-manifest.mjs";
const tag = process.env.SOURCE_TAG;
const version = tag?.replace(/^v/, "");
validateVersion(version ?? "");
if (tag !== `v${version}`) throw new Error("A source tag vX.Y.Z is required");
const matrix = [
  {
    runner: "ubuntu-latest",
    artifact: "linux-x64",
    platform: "linux-x86_64",
    distribution: "linux-appimage",
  },
  {
    runner: "windows-latest",
    artifact: "windows-x64",
    platform: "windows-x86_64",
    distribution: "windows-direct",
  },
  {
    runner: "macos-latest",
    artifact: "macos-arm64",
    platform: "darwin-aarch64",
    distribution: "macos-direct",
  },
];
for (const [key, value] of Object.entries({
  version,
  tag,
  ref: tag,
  matrix: JSON.stringify({ include: matrix }),
})) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
