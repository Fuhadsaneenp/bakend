import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const useS3 = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);

const s3 = useS3
  ? new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
      forcePathStyle: Boolean(env.S3_ENDPOINT)
    })
  : null;

export const storageService = {
  async putObject(key: string, buffer: Buffer, contentType: string, fileName?: string) {
    // 1. Upload to S3 if configured
    if (s3 && env.S3_BUCKET) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
      } catch (s3Err) {
        console.error("[storageService] S3 upload error:", s3Err);
      }
    }

    // 2. Always persist into MySQL database (StoredFile) so deployments and server restarts never lose files
    try {
      const derivedFileName = fileName || key.split("/").pop() || "file";
      await prisma.storedFile.upsert({
        where: { fileKey: key },
        create: {
          fileKey: key,
          fileName: derivedFileName,
          mimeType: contentType || "application/octet-stream",
          fileData: new Uint8Array(buffer),
          fileSize: buffer.length
        },
        update: {
          fileName: derivedFileName,
          mimeType: contentType || "application/octet-stream",
          fileData: new Uint8Array(buffer),
          fileSize: buffer.length
        }
      });
    } catch (dbErr) {
      console.error("[storageService] Failed to persist file in MySQL database:", dbErr);
    }

    // 3. Write to local disk cache
    try {
      const target = path.join(env.LOCAL_STORAGE_PATH, key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    } catch (diskErr) {
      // Local disk cache error is non-fatal since database holds the file
    }

    return key;
  },

  async getObject(key: string): Promise<Buffer> {
    // 1. Try S3 if configured
    if (s3 && env.S3_BUCKET) {
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
        const bytes = await result.Body?.transformToByteArray();
        if (bytes && bytes.length > 0) return Buffer.from(bytes);
      } catch {}
    }

    // 2. Try MySQL database (StoredFile)
    try {
      const stored = await prisma.storedFile.findUnique({
        where: { fileKey: key }
      });
      if (stored && stored.fileData) {
        return Buffer.from(stored.fileData);
      }
    } catch {}

    // 3. Fall back to local disk
    return readFile(path.join(env.LOCAL_STORAGE_PATH, key));
  },

  publicUrl(key: string) {
    if (env.S3_ENDPOINT && env.S3_BUCKET) return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
    return `/files/${key}`;
  }
};

