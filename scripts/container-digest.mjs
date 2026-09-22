import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function testedDigest(references, image) {
  const matching = [
    ...new Set(references.filter((ref) => ref.startsWith(`${image}@`))),
  ];
  if (matching.length !== 1)
    throw new Error("Expected one pushed digest for the tested image");
  const digest = matching[0].slice(image.length + 1);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Invalid pushed image digest");
  return digest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [metadata, image, output] = process.argv.slice(2);
  const digest = testedDigest(
    JSON.parse(readFileSync(metadata, "utf8")),
    image,
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${digest}\n`);
  console.log(`digest=${digest}`);
}
