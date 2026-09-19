import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalFileStorage } from "../src/fileStorage.js";
import { createS3FileStorage } from "../src/s3FileStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testRoot = path.resolve(__dirname, "../.tmp-file-storage-test");
await fs.promises.rm(testRoot, { recursive: true, force: true });

try {
  const local = createLocalFileStorage({ rootDir: path.join(testRoot, "objects") });
  const source = path.join(testRoot, "upload.tmp");
  await fs.promises.mkdir(testRoot, { recursive: true });
  await fs.promises.writeFile(source, "file-storage-test");
  await local.putFile({ key: "project-a/file.txt", filePath: source });
  assert.equal(await local.exists("project-a/file.txt"), true);
  assert.equal(fs.existsSync(source), false);
  const stored = await local.getObject("project-a/file.txt");
  assert.equal(stored.contentLength, 17);
  let content = "";
  for await (const chunk of stored.body) content += chunk;
  assert.equal(content, "file-storage-test");
  assert.throws(() => local.pathForKey("../outside.txt"), /Invalid file storage key/);
  assert.equal(await local.deleteObject("project-a/file.txt"), true);
  assert.equal(await local.exists("project-a/file.txt"), false);

  const calls = [];
  const fakeClient = {
    async send(command) {
      calls.push(command);
      if (command.constructor.name === "GetObjectCommand") {
        return { Body: fs.createReadStream(path.join(testRoot, "s3-source.txt")), ContentLength: 2 };
      }
      return {};
    },
  };
  await fs.promises.writeFile(path.join(testRoot, "s3-source.txt"), "s3");
  const s3 = createS3FileStorage({
    bucket: "private-bucket",
    region: "test",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    prefix: "files",
    client: fakeClient,
  });
  await s3.putFile({
    key: "project-b/file.pdf",
    filePath: path.join(testRoot, "s3-source.txt"),
    contentType: "application/pdf",
    contentLength: 2,
  });
  const result = await s3.getObject("project-b/file.pdf");
  result.body.destroy();
  await s3.exists("project-b/file.pdf");
  await s3.deleteObject("project-b/file.pdf");
  assert.deepEqual(calls.map((call) => call.constructor.name), [
    "PutObjectCommand",
    "GetObjectCommand",
    "HeadObjectCommand",
    "DeleteObjectCommand",
  ]);
  assert.ok(calls.every((call) => call.input.Bucket === "private-bucket"));
  assert.ok(calls.every((call) => call.input.Key === "files/project-b/file.pdf"));

  console.log("File storage adapters: OK");
} finally {
  await fs.promises.rm(testRoot, { recursive: true, force: true });
}
