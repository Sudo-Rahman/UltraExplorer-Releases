import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  archiveKey,
  packDirectory,
  unpackDirectory,
} from "./encrypted-archive.mjs";

const [operation] = process.argv.slice(2);
const group = process.env.CACHE_GROUP;
if (!group || !/^[a-zA-Z0-9_-]+$/.test(group))
  throw new Error("Invalid cache group");
const kind = process.env.CACHE_KIND;
if (!["native", "frontend", "docker"].includes(kind))
  throw new Error("Invalid cache kind");
const workspace = process.env.GITHUB_WORKSPACE;
const directory = join(process.env.RUNNER_TEMP, "ultra-encrypted-cache", group);
const key = archiveKey();
const keyId = createHash("sha256").update(key).digest("hex").slice(0, 12);
const scope = `v1-${group}-${process.env.RUNNER_OS}-${process.env.RUNNER_ARCH}-rust190-${keyId}`;
const paths =
  kind === "docker"
    ? { buildkit: join(workspace, "buildkit-cache") }
    : {
        pnpm: join(workspace, ".pnpm-store"),
        ...(kind === "native"
          ? {
              registry: join(
                process.env.CARGO_HOME || join(homedir(), ".cargo"),
                "registry",
              ),
              target: join(workspace, "source", "target"),
            }
          : {}),
      };

if (operation === "init") {
  await mkdir(directory, { recursive: true });
  const dependency = process.env.CACHE_DEPENDENCY || "dependencies";
  if (!/^[a-zA-Z0-9_-]+$/.test(dependency))
    throw new Error("Invalid dependency cache key");
  const unique = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${process.env.GITHUB_JOB}`;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `directory=${directory}\nkey=${scope}-${dependency}-${unique}\nprefix=${scope}-${dependency}-\nfallback=${scope}-\n`,
  );
} else if (operation === "restore") {
  for (const [name, path] of Object.entries(paths)) {
    const archive = join(directory, `${name}.enc`);
    try {
      await stat(archive);
      await unpackDirectory(archive, path, `${scope}/${name}`, key);
      console.log(`Restored encrypted ${group}/${name} cache`);
    } catch (error) {
      if (error.code !== "ENOENT")
        console.log(
          `Cache ${group}/${name} could not be restored; building without it`,
        );
    }
  }
} else if (operation === "save") {
  await mkdir(directory, { recursive: true });
  for (const file of await readdir(directory))
    await rm(join(directory, file), { recursive: true, force: true });
  let saved = 0;
  for (const [name, path] of Object.entries(paths)) {
    try {
      await stat(path);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await packDirectory(
      path,
      join(directory, `${name}.enc`),
      `${scope}/${name}`,
      key,
      name === "target"
        ? [
            "./debug/incremental",
            "./release/incremental",
            "./debug/bundle",
            "./release/bundle",
          ]
        : [],
    );
    saved++;
    console.log(`Saved encrypted ${group}/${name} cache`);
  }
  await appendFile(process.env.GITHUB_OUTPUT, `available=${saved > 0}\n`);
} else throw new Error("Expected init, restore or save");
