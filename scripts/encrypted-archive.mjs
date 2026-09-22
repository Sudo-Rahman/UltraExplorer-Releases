import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pathToFileURL } from "node:url";

const magic = Buffer.from("ULTRAC01");
const headerSize = magic.length + 12;

export function archiveKey(value = process.env.PRIVATE_BUILD_CACHE_KEY) {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value.trim()))
    throw new Error(
      "PRIVATE_BUILD_CACHE_KEY must be a base64-encoded 32-byte key",
    );
  return Buffer.from(value.trim(), "base64");
}

function tar(args) {
  // Use Windows' native tar rather than a Git/MSYS executable with different path rules.
  const executable =
    process.platform === "win32"
      ? join(process.env.SystemRoot, "System32", "tar.exe")
      : "tar";
  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = "";
  child.stderr.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-4000);
  });
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Archive command failed (${code}): ${diagnostic}`)),
    );
  });
  // A stream error and process exit can arrive in either order.
  finished.catch(() => {});
  return { child, finished };
}

export async function packDirectory(
  directory,
  output,
  context,
  key = archiveKey(),
  excludes = [],
) {
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.partial`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const destination = createWriteStream(temporary, { mode: 0o600 });
  destination.write(Buffer.concat([magic, iv]));
  const { child, finished } = tar([
    "-cf",
    "-",
    ...excludes.map((path) => `--exclude=${path}`),
    "-C",
    directory,
    ".",
  ]);
  try {
    await Promise.all([
      pipeline(child.stdout, createGzip({ level: 1 }), cipher, destination),
      finished,
    ]);
    await appendFile(temporary, cipher.getAuthTag());
    await rename(temporary, output);
  } catch (error) {
    child.kill();
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function unpackDirectory(
  input,
  directory,
  context,
  key = archiveKey(),
) {
  const size = (await stat(input)).size;
  if (size <= headerSize + 16) throw new Error("Invalid encrypted archive");
  const file = await open(input, "r");
  const header = Buffer.alloc(headerSize);
  const tag = Buffer.alloc(16);
  try {
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, magic.length).equals(magic))
    throw new Error("Unknown archive format");
  const scratch = await mkdtemp(join(tmpdir(), "ultra-decrypt-"));
  const compressed = join(scratch, "archive.tar.gz");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(magic.length),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    // Authenticate the entire archive before allowing tar to extract any bytes.
    await pipeline(
      createReadStream(input, { start: headerSize, end: size - 17 }),
      decipher,
      createWriteStream(compressed, { mode: 0o600 }),
    );
    await mkdir(directory, { recursive: true });
    const { child, finished } = tar(["-xzf", compressed, "-C", directory]);
    child.stdout.resume();
    await finished;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [operation, input, output, context] = process.argv.slice(2);
  if (!input || !output || !context)
    throw new Error("Expected pack/unpack input output context");
  if (operation === "pack") await packDirectory(input, output, context);
  else if (operation === "unpack")
    await unpackDirectory(input, output, context);
  else throw new Error("Expected pack or unpack");
}
