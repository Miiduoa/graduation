import {
  presignS3Request,
  s3HeadObject,
  type PresignedRequest,
  type S3Config,
  type S3ObjectInfo,
} from './awsS3';
import { readFileStorageConfig, type FileStorageConfig } from './fileStorageConfig';

export type FileStorage = {
  presignPut: (input: {
    key: string;
    contentType: string;
    contentLength: number;
    ifMatch?: string;
    ifNoneMatch?: string;
    metadata?: Record<string, string>;
    now?: Date;
  }) => PresignedRequest;
  presignGet: (input: { key: string; now?: Date }) => PresignedRequest;
  head: (key: string) => Promise<S3ObjectInfo | null>;
};

export function createR2FileStorage(
  config: FileStorageConfig,
  fetchImpl: typeof fetch = fetch,
): FileStorage {
  const s3: S3Config = config.s3;
  const ttl = config.presignTtlSeconds;
  return {
    presignPut({ key, contentType, contentLength, ifMatch, ifNoneMatch, metadata, now }) {
      const headers: Record<string, string> = {
        'content-type': contentType,
        'content-length': String(contentLength),
        'cache-control': 'private, no-store',
      };
      if (ifMatch) headers['if-match'] = ifMatch.includes('"') ? ifMatch : `"${ifMatch}"`;
      if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
      if (metadata) {
        for (const [name, value] of Object.entries(metadata)) {
          headers[`x-amz-meta-${name.toLowerCase()}`] = value;
        }
      }
      return presignS3Request(s3, {
        method: 'PUT',
        key,
        expiresSeconds: ttl,
        headers,
        now,
      });
    },
    presignGet({ key, now }) {
      return presignS3Request(s3, {
        method: 'GET',
        key,
        expiresSeconds: ttl,
        now,
      });
    },
    head(key) {
      return s3HeadObject(s3, key, fetchImpl);
    },
  };
}

let cached: FileStorage | null | undefined;
let cachedKey = '';

export function resetFileStorageForTests(): void {
  cached = undefined;
  cachedKey = '';
}

export function getFileStorage(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): FileStorage | null {
  const config = readFileStorageConfig(env);
  if (!config) {
    cached = null;
    cachedKey = '';
    return null;
  }
  const key = [
    config.s3.endpoint,
    config.s3.bucket,
    config.s3.accessKeyId,
    config.s3.region,
    String(config.presignTtlSeconds),
  ].join('\0');
  if (cached && cachedKey === key) return cached;
  cached = createR2FileStorage(config, fetchImpl);
  cachedKey = key;
  return cached;
}
