import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

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
  async putObject(key: string, buffer: Buffer, contentType: string) {
    if (s3 && env.S3_BUCKET) {
      await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
      return key;
    }

    const target = path.join(env.LOCAL_STORAGE_PATH, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return key;
  },

  async getObject(key: string) {
    if (s3 && env.S3_BUCKET) {
      const result = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return Buffer.from(bytes ?? []);
    }

    return readFile(path.join(env.LOCAL_STORAGE_PATH, key));
  },

  publicUrl(key: string) {
    if (env.S3_ENDPOINT && env.S3_BUCKET) return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
    return `/files/${key}`;
  }
};
