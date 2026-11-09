import { createHash, createHmac } from 'node:crypto';

export type S3Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
};

export type S3ObjectInfo = {
  contentType: string;
  contentLength: number;
  etag: string;
  metadata: Record<string, string>;
};

export type PresignInput = {
  method: 'GET' | 'PUT' | 'HEAD';
  key: string;
  expiresSeconds: number;
  headers?: Record<string, string>;
  now?: Date;
};

export type PresignedRequest = {
  url: string;
  method: 'GET' | 'PUT' | 'HEAD';
  headers: Record<string, string>;
  expiresAt: string;
};

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** AWS SigV4 URI encode. Keep slashes when encodeSlash is false. */
export function awsUriEncode(value: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
  return encodeSlash ? encoded : encoded.replace(/%2F/g, '/');
}

function encodePath(bucket: string, key: string): string {
  const encodedKey = key
    .split('/')
    .map((segment) => awsUriEncode(segment, true))
    .join('/');
  return `/${awsUriEncode(bucket, true)}/${encodedKey}`;
}

function endpointUrl(config: S3Config): URL {
  return new URL(config.endpoint);
}

function hostHeader(url: URL): string {
  if ((url.protocol === 'https:' && url.port === '') || url.port === '443') return url.hostname;
  if ((url.protocol === 'http:' && url.port === '') || url.port === '80') return url.hostname;
  return url.host;
}

function amzDate(now: Date): { date: string; datetime: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { date: iso.slice(0, 8), datetime: iso };
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.trim().toLowerCase();
    if (!name) continue;
    normalized[name] = String(value).trim().replace(/\s+/g, ' ');
  }
  return normalized;
}

function canonicalHeadersBlock(headers: Record<string, string>): {
  canonical: string;
  signed: string;
} {
  const names = Object.keys(headers).sort();
  return {
    signed: names.join(';'),
    canonical: names.map((name) => `${name}:${headers[name]}\n`).join(''),
  };
}

function queryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${awsUriEncode(key)}=${awsUriEncode(params[key])}`)
    .join('&');
}

export function presignS3Request(config: S3Config, input: PresignInput): PresignedRequest {
  const expiresSeconds = Math.min(60, Math.max(1, Math.floor(input.expiresSeconds)));
  const now = input.now ?? new Date();
  const { date, datetime } = amzDate(now);
  const url = endpointUrl(config);
  const canonicalUri = encodePath(config.bucket, input.key);
  const extraHeaders = normalizeHeaders(input.headers || {});
  extraHeaders.host = hostHeader(url);
  const { canonical, signed } = canonicalHeadersBlock(extraHeaders);
  const credential = `${config.accessKeyId}/${date}/${config.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': datetime,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': signed,
  };
  const canonicalRequest = [
    input.method,
    canonicalUri,
    queryString(query),
    canonical,
    signed,
    UNSIGNED_PAYLOAD,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    `${date}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, date, config.region, 's3'))
    .update(stringToSign, 'utf8')
    .digest('hex');
  query['X-Amz-Signature'] = signature;
  const signedUrl = new URL(canonicalUri, url);
  signedUrl.search = queryString(query);
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (key === 'host') continue;
    responseHeaders[key] = value;
  }
  return {
    url: signedUrl.toString(),
    method: input.method,
    headers: responseHeaders,
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
  };
}

function authorizationHeader(
  config: S3Config,
  method: string,
  canonicalUri: string,
  headers: Record<string, string>,
  payloadHash: string,
  now: Date,
): Record<string, string> {
  const { date, datetime } = amzDate(now);
  const next = normalizeHeaders(headers);
  next['x-amz-date'] = datetime;
  next['x-amz-content-sha256'] = payloadHash;
  const { canonical, signed } = canonicalHeadersBlock(next);
  const canonicalRequest = [method, canonicalUri, '', canonical, signed, payloadHash].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    `${date}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, date, config.region, 's3'))
    .update(stringToSign, 'utf8')
    .digest('hex');
  next.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${date}/${config.region}/s3/aws4_request, ` +
    `SignedHeaders=${signed}, Signature=${signature}`;
  return next;
}

export async function s3HeadObject(
  config: S3Config,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<S3ObjectInfo | null> {
  const url = endpointUrl(config);
  const canonicalUri = encodePath(config.bucket, key);
  const headers = authorizationHeader(
    config,
    'HEAD',
    canonicalUri,
    { host: hostHeader(url) },
    EMPTY_SHA256,
    new Date(),
  );
  const response = await fetchImpl(new URL(canonicalUri, url), {
    method: 'HEAD',
    headers,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw Object.assign(new Error('Object lookup failed'), { statusCode: 500, code: response.status });
  }
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const length = Number(response.headers.get('content-length') || '0');
  const etag = String(response.headers.get('etag') || '').replace(/"/g, '');
  const metadata: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    const match = name.toLowerCase().match(/^x-amz-meta-(.+)$/);
    if (match) metadata[match[1]] = value;
  });
  return {
    contentType,
    contentLength: Number.isFinite(length) ? length : 0,
    etag,
    metadata,
  };
}
