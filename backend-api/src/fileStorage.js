import fs from "node:fs";
import path from "node:path";
import { resolveAppDataDir } from "./dataRepository.js";

const STORAGE_ROOT_NAME = "project-files";

export function normalizeStorageKey(value) {
  const key = String(value ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = key.split("/");
  if (!key || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid file storage key");
  }
  return segments.join("/");
}

function localPathForKey(rootDir, key) {
  const normalizedKey = normalizeStorageKey(key);
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, ...normalizedKey.split("/"));
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("File storage path escapes its root");
  }
  return resolvedPath;
}

export function projectFileStorageRoot() {
  return path.join(resolveAppDataDir(), STORAGE_ROOT_NAME);
}

export function createLocalFileStorage(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? projectFileStorageRoot());
  return {
    kind: "local",
    rootDir,

    pathForKey(key) {
      return localPathForKey(rootDir, key);
    },

    async putFile({ key, filePath }) {
      const destination = localPathForKey(rootDir, key);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      try {
        await fs.promises.rename(filePath, destination);
      } catch (error) {
        if (error?.code !== "EXDEV") throw error;
        await fs.promises.copyFile(filePath, destination, fs.constants.COPYFILE_EXCL);
        await fs.promises.unlink(filePath);
      }
    },

    async getObject(key) {
      const filePath = localPathForKey(rootDir, key);
      try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) return undefined;
        return { body: fs.createReadStream(filePath), contentLength: stat.size };
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
    },

    async exists(key) {
      try {
        return (await fs.promises.stat(localPathForKey(rootDir, key))).isFile();
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },

    async deleteObject(key) {
      try {
        await fs.promises.unlink(localPathForKey(rootDir, key));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
  };
}

export async function createFileStorage(options = {}) {
  const kind = String(options.kind ?? process.env.FILE_STORAGE ?? "local").trim().toLowerCase();
  if (kind === "local") return createLocalFileStorage(options.local);
  if (kind === "s3") {
    const { createS3FileStorage } = await import("./s3FileStorage.js");
    return createS3FileStorage(options.s3);
  }
  throw new Error(`Unsupported FILE_STORAGE value: ${kind}`);
}
