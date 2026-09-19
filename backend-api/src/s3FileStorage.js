import fs from "node:fs";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { normalizeStorageKey } from "./fileStorage.js";

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function requiredS3Value(name, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required when FILE_STORAGE=s3`);
  return normalized;
}

export function createS3FileStorage(options = {}) {
  const bucket = requiredS3Value("S3_BUCKET", options.bucket ?? process.env.S3_BUCKET);
  const region = String(options.region ?? process.env.S3_REGION ?? "auto").trim() || "auto";
  const endpoint = String(options.endpoint ?? process.env.S3_ENDPOINT ?? "").trim() || undefined;
  const accessKeyId = requiredS3Value("S3_ACCESS_KEY_ID", options.accessKeyId ?? process.env.S3_ACCESS_KEY_ID);
  const secretAccessKey = requiredS3Value("S3_SECRET_ACCESS_KEY", options.secretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY);
  const prefix = String(options.prefix ?? process.env.S3_PREFIX ?? "project-files")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const client = options.client ?? new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: options.forcePathStyle ?? envBoolean("S3_FORCE_PATH_STYLE", false),
    credentials: { accessKeyId, secretAccessKey },
  });
  const objectKey = (key) => [prefix, normalizeStorageKey(key)].filter(Boolean).join("/");

  return {
    kind: "s3",
    bucket,
    prefix,

    async putFile({ key, filePath, contentType, contentLength }) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey(key),
        Body: fs.createReadStream(filePath),
        ContentType: contentType,
        ContentLength: contentLength,
      }));
    },

    async getObject(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        if (!result.Body) return undefined;
        return { body: result.Body, contentLength: result.ContentLength };
      } catch (error) {
        if (isS3NotFound(error)) return undefined;
        throw error;
      }
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        return true;
      } catch (error) {
        if (isS3NotFound(error)) return false;
        throw error;
      }
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
      return true;
    },
  };
}

function isS3NotFound(error) {
  return error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
}
