import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, features } from "@/server/env";

// Media bytes live in an S3-compatible bucket (Cloudflare R2 or S3) in
// production, and in .data/media locally. Explicit media never goes through the
// app host's CDN; the API checks ownership, then streams it or redirects to a
// short-lived signed URL.

type S3 = import("@aws-sdk/client-s3").S3Client;
let s3: Promise<S3> | undefined;

function client() {
  s3 ??= import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        region: env.s3Region,
        endpoint: env.s3Endpoint,
        forcePathStyle: Boolean(env.s3Endpoint),
        credentials: { accessKeyId: env.s3AccessKeyId!, secretAccessKey: env.s3SecretAccessKey! },
        // The SDK checksums every upload by default since early 2025, with
        // headers that R2 and other S3-compatible stores have rejected. Only AWS
        // gets the default.
        ...(env.s3Endpoint
          ? { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" } as const
          : {}),
      }),
  );
  return s3;
}

function localPath(key: string) {
  const root = path.resolve(env.mediaDir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  if (features.s3) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await client()).send(
      new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  await writeFile(`${file}.type`, contentType);
}

// Local files only. With S3, use signedUrl instead.
export async function readLocalObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const file = localPath(key);
    const [body, contentType] = await Promise.all([readFile(file), readFile(`${file}.type`, "utf8")]);
    return { body, contentType };
  } catch {
    return null;
  }
}

export async function signedUrl(key: string, expiresInSeconds = 300) {
  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);
  return getSignedUrl(await client(), new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function deleteObject(key: string) {
  if (features.s3) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await client()).send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return;
  }
  await rm(localPath(key), { force: true });
  await rm(`${localPath(key)}.type`, { force: true });
}

export const usesS3 = () => features.s3;
