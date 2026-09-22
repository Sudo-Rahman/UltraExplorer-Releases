import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateIndex(index, digests) {
  if (
    index.manifests?.length !== 2 ||
    new Set(Object.values(digests)).size !== 2
  )
    throw new Error("Expected a complete two-architecture image");
  const seen = new Set();
  for (const manifest of index.manifests) {
    const arch = manifest.platform?.architecture;
    if (
      manifest.platform?.os !== "linux" ||
      !Object.hasOwn(digests, arch) ||
      seen.has(arch) ||
      manifest.digest !== digests[arch]
    )
      throw new Error("Image index does not match the tested native digests");
    seen.add(arch);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [directory, image, version] = process.argv.slice(2);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Invalid stable image version");
  if (readdirSync(directory).sort().join(",") !== "amd64.txt,arm64.txt")
    throw new Error("Missing or unexpected image digest artifact");
  const digests = Object.fromEntries(
    ["amd64", "arm64"].map((arch) => {
      const digest = readFileSync(
        join(directory, `${arch}.txt`),
        "utf8",
      ).trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(digest))
        throw new Error("Invalid native image digest");
      return [arch, digest];
    }),
  );
  const references = Object.values(digests).map(
    (digest) => `${image}@${digest}`,
  );
  const docker = (args) =>
    execFileSync("docker", ["buildx", "imagetools", ...args], {
      encoding: "utf8",
    });
  validateIndex(
    JSON.parse(docker(["create", "--dry-run", ...references])),
    digests,
  );
  docker([
    "create",
    "--tag",
    `${image}:${version}`,
    "--tag",
    `${image}:latest`,
    ...references,
  ]);
  validateIndex(
    JSON.parse(docker(["inspect", "--raw", `${image}:${version}`])),
    digests,
  );
  const digest = docker([
    "inspect",
    "--format",
    "{{.Manifest.Digest}}",
    `${image}:${version}`,
  ]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Invalid published index digest");
  appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
}
