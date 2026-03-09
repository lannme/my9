import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gzipSync, gunzipSync } from "node:zlib";
import { CompactSharePayload, normalizeCompactPayload } from "@/lib/share/compact";

function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

const R2_ENDPOINT = readEnv("R2_ENDPOINT");
const R2_BUCKET = readEnv("R2_BUCKET");
const R2_ACCESS_KEY_ID = readEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = readEnv("R2_SECRET_ACCESS_KEY");
const R2_REGION = readEnv("R2_REGION") ?? "auto";

const COLD_STORAGE_ENABLED = Boolean(
  R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
);

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!COLD_STORAGE_ENABLED) {
    return null;
  }

  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: R2_ENDPOINT!,
      region: R2_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  return s3Client;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);

  const typedBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
  };

  if (typeof typedBody.transformToByteArray === "function") {
    const bytes = await typedBody.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof typedBody.arrayBuffer === "function") {
    const buffer = await typedBody.arrayBuffer();
    return Buffer.from(buffer);
  }

  if (typeof typedBody[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of typedBody as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("unsupported object body type");
}

export function isColdStorageEnabled(): boolean {
  return COLD_STORAGE_ENABLED;
}

export function buildColdObjectKey(shareId: string): string {
  return `shares/v1/${shareId}.json.gz`;
}

export async function putColdSharePayload(
  objectKey: string,
  payload: CompactSharePayload
): Promise<boolean> {
  const client = getS3Client();
  if (!client || !R2_BUCKET) {
    return false;
  }

  try {
    const body = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
        Body: body,
        ContentType: "application/json",
        ContentEncoding: "gzip",
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function getColdSharePayload(objectKey: string): Promise<CompactSharePayload | null> {
  const client = getS3Client();
  if (!client || !R2_BUCKET) {
    return null;
  }

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
      })
    );
    const body = await bodyToBuffer(response.Body);
    const raw = gunzipSync(body).toString("utf8");
    const parsed = JSON.parse(raw);
    return normalizeCompactPayload(parsed);
  } catch {
    return null;
  }
}
