import '@/lib/server-guard';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

/**
 * Durable file storage abstraction.
 *
 * The application never writes uploads to its own working directory in
 * production: Railway's container filesystem is ephemeral, so anything stored
 * there disappears on the next deploy. `local` exists for development only and
 * `checkEnv()` reports it as an error when NODE_ENV=production.
 *
 * Both drivers are addressed by an opaque `storageKey`, so moving from local to
 * S3 changes configuration only — no schema change and no code change.
 */

export interface StoredFile {
  storageKey: string;
  size: number;
  checksum: string;
  contentType: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** A time-limited URL when the driver supports one; null means stream via the app. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}

/* -------------------------------------------------------------------------- */
/* Upload safety                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Allowed upload types. Deliberately a strict allowlist rather than a blocklist:
 * flyers, OMs, photos and ordinary documents cover the real workflow, and nothing
 * executable or script-like is accepted.
 */
export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/heic': ['.heic'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

/** Magic-number checks for the types where a mismatch would matter most. */
const MAGIC: Array<{ type: string; test: (b: Buffer) => boolean }> = [
  { type: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/gif', test: (b) => b.subarray(0, 3).toString('latin1') === 'GIF' },
  { type: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function assertUploadAllowed(filename: string, contentType: string, bytes: Buffer): void {
  if (bytes.length === 0) throw new AppError(422, 'That file is empty.', 'empty_file');
  if (bytes.length > env.storage.maxUploadBytes) {
    const mb = Math.round(env.storage.maxUploadBytes / 1024 / 1024);
    throw new AppError(413, `That file is larger than the ${mb} MB limit.`, 'file_too_large');
  }

  const normalisedType = contentType.split(';')[0]!.trim().toLowerCase();
  const allowedExts = ALLOWED_UPLOAD_TYPES[normalisedType];
  if (!allowedExts) {
    throw new AppError(415, `Files of type "${normalisedType}" are not accepted. Allowed: PDF, images, Office documents, CSV and text.`, 'unsupported_type');
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext && !allowedExts.includes(ext)) {
    throw new AppError(415, `The file extension "${ext}" does not match its declared type "${normalisedType}".`, 'type_mismatch');
  }

  // A browser-declared content type is only a hint; verify the bytes where we can.
  const magic = MAGIC.find((m) => m.type === normalisedType);
  if (magic && !magic.test(bytes)) {
    throw new AppError(415, `That file does not look like a valid ${normalisedType} file.`, 'content_mismatch');
  }
}

/**
 * Builds an opaque, non-guessable storage key. The original filename is kept in
 * the database, never in the key, so a user-supplied name cannot be used to
 * traverse paths or collide with another record.
 */
export function buildStorageKey(scope: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'misc';
  return `${safeScope}/${yyyymm}/${randomUUID()}${ext}`;
}

export const checksumOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/* -------------------------------------------------------------------------- */
/* Local driver (development)                                                 */
/* -------------------------------------------------------------------------- */

class LocalDriver implements StorageDriver {
  readonly name = 'local' as const;
  private root = path.resolve(process.cwd(), env.storage.localDir);

  /** Resolves a key inside the storage root, refusing anything that escapes it. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    const rel = path.relative(this.root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new AppError(400, 'Invalid storage key.', 'bad_storage_key');
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {});
  }

  async signedUrl(): Promise<string | null> {
    return null; // served through the authenticated download route instead
  }
}

/* -------------------------------------------------------------------------- */
/* S3-compatible driver (production)                                          */
/* -------------------------------------------------------------------------- */

class S3Driver implements StorageDriver {
  readonly name = 's3' as const;
  // Imported lazily so development installs never pay the SDK's startup cost.
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client> | null = null;

  private client() {
    this.clientPromise ??= (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: env.storage.region || 'auto',
        endpoint: env.storage.endpoint || undefined,
        forcePathStyle: env.storage.forcePathStyle,
        credentials: {
          accessKeyId: env.storage.accessKeyId,
          secretAccessKey: env.storage.secretAccessKey,
        },
      });
    })();
    return this.clientPromise;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(new PutObjectCommand({
      Bucket: env.storage.bucket, Key: key, Body: body, ContentType: contentType,
    }));
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const res = await client.send(new GetObjectCommand({ Bucket: env.storage.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: env.storage.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = await this.client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: env.storage.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  driver ??= env.storage.driver === 's3' ? new S3Driver() : new LocalDriver();
  return driver;
}
