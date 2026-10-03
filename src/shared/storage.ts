/**
 * Storage abstraction layer.
 * Works with local disk (default) or S3-compatible storage (Cloudflare R2, AWS S3).
 *
 * Set STORAGE_DRIVER=s3 + S3_* env vars to switch to cloud storage.
 * Falls back to local disk if S3 is not configured.
 */

import { join, resolve, normalize, sep } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";

// ── Local Disk Driver ──

function getContentRoot(): string {
  const raw = process.env.CONTENT_ROOT ?? "C:/work/projects";
  return resolve(raw);
}

function resolveLocalFile(relativePath: string): string | null {
  const root = getContentRoot();
  const target = normalize(join(root, relativePath));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

// ── S3 Driver (lazy-loaded) ──

let s3Client: any = null;

async function getS3Client() {
  if (s3Client) return s3Client;

  const { S3Client, GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");

  s3Client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT, // Cloudflare R2 endpoint
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });

  return s3Client;
}

// ── Public API ──

export type StorageDriver = "local" | "s3";

export function getStorageDriver(): StorageDriver {
  return (process.env.STORAGE_DRIVER as StorageDriver) ?? "local";
}

export interface FileMetadata {
  size: number;
  contentType: string;
  lastModified?: Date;
}

/**
 * Check if a file exists and return metadata.
 */
export async function getFileMetadata(relativePath: string): Promise<FileMetadata | null> {
  const driver = getStorageDriver();

  if (driver === "s3") {
    try {
      const client = await getS3Client();
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const key = relativePath.replace(/\\/g, "/");
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
        }),
      );
      return {
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? "application/pdf",
        lastModified: result.LastModified,
      };
    } catch {
      return null;
    }
  }

  // Local driver
  const resolved = resolveLocalFile(relativePath);
  if (!resolved) return null;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return null;
    return {
      size: info.size,
      contentType: "application/pdf",
      lastModified: info.mtime,
    };
  } catch {
    return null;
  }
}

/**
 * Read file as Buffer (for text extraction, etc.)
 */
export async function readFileBuffer(relativePath: string): Promise<Buffer | null> {
  const driver = getStorageDriver();

  if (driver === "s3") {
    try {
      const client = await getS3Client();
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const key = relativePath.replace(/\\/g, "/");
      const result = await client.send(
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
        }),
      );
      const stream = result.Body;
      if (!stream) return null;
      const chunks: Uint8Array[] = [];
      const reader = stream.transformToWebStream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  // Local driver
  const resolved = resolveLocalFile(relativePath);
  if (!resolved) return null;
  try {
    return await readFile(resolved);
  } catch {
    return null;
  }
}

/**
 * Get a streaming Response for serving PDFs.
 */
export async function streamFile(relativePath: string): Promise<Response | null> {
  const meta = await getFileMetadata(relativePath);
  if (!meta) return null;

  const driver = getStorageDriver();

  if (driver === "s3") {
    try {
      const client = await getS3Client();
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const key = relativePath.replace(/\\/g, "/");
      const result = await client.send(
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
        }),
      );
      const stream = result.Body;
      if (!stream) return null;

      const webStream = stream.transformToWebStream();
      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": meta.contentType,
          "Content-Length": String(meta.size),
          "Cache-Control": "private, no-store",
          "Vary": "Cookie, Authorization",
        },
      });
    } catch {
      return null;
    }
  }

  // Local driver
  const resolved = resolveLocalFile(relativePath);
  if (!resolved) return null;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return null;

    const stream = createReadStream(resolved);
    const body = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": meta.contentType,
        "Content-Length": String(meta.size),
        "Cache-Control": "private, no-store",
        "Vary": "Cookie, Authorization",
      },
    });
  } catch {
    return null;
  }
}

/**
 * Get a public URL for a file (for client-side access like react-pdf).
 * Returns a proxy URL that goes through our API for auth.
 */
export function getPublicUrl(relativePath: string): string {
  const driver = getStorageDriver();

  if (driver === "s3") {
    // For S3, we can generate a presigned URL or use public bucket
    const endpoint = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const key = relativePath.replace(/\\/g, "/");
    return `${endpoint}/${bucket}/${key}`;
  }

  // For local, the PDF is served through our API
  return relativePath; // Will be resolved by the API route
}
