import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectReference, ObjectStore, PutObjectInput } from "@/persistence/object-store";

export interface CreateNodeObjectStoreOptions {
  /** 工作区根目录；对象只能写入其 data/objects。 */
  workspacePath: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Node/MCP/CLI 的内容寻址对象库。对象写入与数据库引用提交刻意分离：
 * 数据库事务失败后允许留下可审计的孤儿对象，R1 不做自动 GC。
 */
export async function createNodeObjectStore(options: CreateNodeObjectStoreOptions): Promise<ObjectStore> {
  const objectDirectory = path.join(options.workspacePath, "data", "objects");
  const temporaryDirectory = path.join(objectDirectory, ".tmp");
  await mkdir(temporaryDirectory, { recursive: true });

  return {
    async put(input: PutObjectInput): Promise<ObjectReference> {
      const mediaType = validateMediaType(input.mediaType);
      const content = input.content;
      const sha256 = calculateSha256(content);
      const objectPath = path.join(objectDirectory, sha256);

      if (await pathExists(objectPath)) return { sha256, byteLength: content.byteLength, mediaType };

      const temporaryPath = path.join(temporaryDirectory, randomUUID());
      await writeFile(temporaryPath, content, { flag: "wx" });
      try {
        if (await pathExists(objectPath)) return { sha256, byteLength: content.byteLength, mediaType };
        await rename(temporaryPath, objectPath);
      } catch (error) {
        if (!(await pathExists(objectPath))) throw error;
      } finally {
        await rm(temporaryPath, { force: true });
      }

      return { sha256, byteLength: content.byteLength, mediaType };
    },

    async read(sha256: string): Promise<Uint8Array> {
      assertSha256(sha256);
      const content = await readFile(path.join(objectDirectory, sha256));
      if (calculateSha256(content) !== sha256) throw new Error(`Object hash mismatch: ${sha256}`);
      return Uint8Array.from(content);
    },
  };
}

function calculateSha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function assertSha256(sha256: string): void {
  if (!SHA256_PATTERN.test(sha256)) throw new Error("Object hash must be a lowercase SHA-256 hex string.");
}

function validateMediaType(mediaType: string): string {
  const normalized = mediaType.trim();
  if (!normalized) throw new Error("Object media type is required.");
  return normalized;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
