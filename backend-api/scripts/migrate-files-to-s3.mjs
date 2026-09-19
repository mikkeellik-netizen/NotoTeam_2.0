import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.resolve(__dirname, "../.env"));

const { projectFileStorageRoot } = await import("../src/fileStorage.js");
const { createS3FileStorage } = await import("../src/s3FileStorage.js");

const sourceRoot = projectFileStorageRoot();
const deleteLocal = process.argv.includes("--delete-local");
const overwrite = process.argv.includes("--overwrite");
const storage = createS3FileStorage();

if (!fs.existsSync(sourceRoot)) {
  console.log(`Local project files directory does not exist: ${sourceRoot}`);
  process.exit(0);
}

const files = await listFiles(sourceRoot);
let copied = 0;
let skipped = 0;
let deleted = 0;

console.log(`Migrating ${files.length} local file(s) to s3://${storage.bucket}/${storage.prefix}`);
for (const filePath of files) {
  const key = path.relative(sourceRoot, filePath).split(path.sep).join("/");
  const stat = await fs.promises.stat(filePath);
  const exists = await storage.exists(key);
  if (exists && !overwrite) {
    skipped += 1;
  } else {
    await storage.putFile({ key, filePath, contentLength: stat.size });
    if (!(await storage.exists(key))) throw new Error(`S3 verification failed for ${key}`);
    copied += 1;
  }

  if (deleteLocal && (exists || await storage.exists(key))) {
    await fs.promises.unlink(filePath);
    deleted += 1;
  }
  console.log(`${copied + skipped}/${files.length} ${exists && !overwrite ? "skipped" : "copied"}: ${key}`);
}

if (deleteLocal) await removeEmptyDirectories(sourceRoot);
console.log(`Done. Copied: ${copied}; skipped: ${skipped}; deleted locally: ${deleted}.`);

async function listFiles(root) {
  const result = [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(fullPath));
    else if (entry.isFile() && !entry.name.startsWith(".upload-")) result.push(fullPath);
  }
  return result;
}

async function removeEmptyDirectories(root) {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(root, entry.name);
    await removeEmptyDirectories(child);
    if ((await fs.promises.readdir(child)).length === 0) await fs.promises.rmdir(child);
  }
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}
