#!/usr/bin/env node
/** Offline, allowlisted HAR inspection. This tool never enables an adapter. */
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const LIMITS = Object.freeze({
  fileBytes: 16 * 1024 * 1024,
  entries: 1000,
  jsonBodyBytes: 256 * 1024,
  schemaNodes: 64,
  schemaDepth: 6,
  arraySamples: 16,
  receiptSamples: 64,
  evidenceFinals: 32,
  evidenceReadbacks: 64,
  outputBytes: 8 * 1024 * 1024,
});

const ORIGIN = 'https://tronclass.pu.edu.tw';
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
// These are routes seen in this repository or public client source, not verified
// PU write contracts. In particular, recognizing /api/uploads does not establish
// that it is the school's upload endpoint or that binary transfer completed.
const ROUTES = [
  { re: /^\/api\/profile\/?$/, path: '/api/profile', kind: 'profile' },
  { re: /^\/api\/uploads\/?$/, path: '/api/uploads', kind: 'upload_candidate' },
  { re: /^\/api\/uploads\/[A-Za-z0-9_-]{1,128}\/blob\/?$/, path: '/api/uploads/{uploadKey}/blob', kind: 'download' },
  { re: /^\/api\/courses\/?$/, path: '/api/courses', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/?$/, path: '/api/courses/{courseId}/homework-activities', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/(\d{1,20})\/?$/, path: '/api/courses/{courseId}/homework-activities/{activityId}', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/(\d{1,20})\/submissions\/?$/, path: '/api/courses/{courseId}/homework-activities/{activityId}/submissions', kind: 'submission_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/(\d{1,20})\/student-submissions\/?$/, path: '/api/courses/{courseId}/homework-activities/{activityId}/student-submissions', kind: 'readback_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/activities\/(\d{1,20})\/student-submissions\/?$/, path: '/api/courses/{courseId}/activities/{activityId}/student-submissions', kind: 'readback_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/activities\/?$/, path: '/api/courses/{courseId}/activities', kind: 'read' },
  { re: /^\/api\/activities\/(\d{1,20})\/?$/, path: '/api/activities/{activityId}', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/(discussions|forums)\/?$/, path: '/api/courses/{courseId}/{discussionCollection}', kind: 'discussion_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/(discussions|forums)\/(\d{1,20})\/posts\/?$/, path: '/api/courses/{courseId}/{discussionCollection}/{discussionId}/posts', kind: 'discussion_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/surveys\/(\d{1,20})\/responses\/?$/, path: '/api/courses/{courseId}/surveys/{surveyId}/responses', kind: 'survey_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/peer_reviews\/(\d{1,20})\/submissions\/?$/, path: '/api/courses/{courseId}/peer_reviews/{reviewId}/submissions', kind: 'peer_review_candidate' },
];

// A key can contain a student's name, token or assignment text. Unknown keys
// are counted, never emitted, hashed without salt, or recursively traversed.
const FIELDS = new Set([
  'id', 'data', 'user', 'student', 'user_id', 'student_id', 'course_id',
  'activity_id', 'homework_id', 'submission_id', 'submission', 'submissions',
  'student_submissions', 'homework_activities', 'activities', 'courses',
  'upload', 'uploads', 'upload_id', 'upload_ids', 'upload_key', 'upload_keys',
  'key', 'attachments', 'files', 'file', 'file_id', 'name', 'filename', 'size',
  'mime_type', 'content_type', 'content', 'title', 'description', 'status',
  'submitted', 'submitted_at', 'created_at', 'updated_at', 'due_at', 'end_time',
  'start_time', 'allow_download', 'allow_resubmit', 'submit_limit', 'submit_count',
  'page', 'page_size', 'total', 'has_next', 'questions', 'answers', 'scores',
  'comments', 'overallFeedback', 'totalScore', 'posts', 'discussions', 'forums',
  'success', 'error', 'message',
]);

export class HarInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HarInputError';
    this.code = code;
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaOf(value, budget = { remaining: LIMITS.schemaNodes }, depth = 0) {
  if (budget.remaining-- <= 0 || depth > LIMITS.schemaDepth) return { 'x-truncated': true };
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const samples = value.slice(0, LIMITS.arraySamples).map((item) => schemaOf(item, budget, depth + 1));
    const variants = [...new Set(samples.map((item) => JSON.stringify(item)))].map((item) => JSON.parse(item));
    return {
      type: 'array',
      items: variants.length === 1 ? variants[0] : variants.length ? { anyOf: variants } : {},
      ...(value.length > LIMITS.arraySamples ? { 'x-truncated': true } : {}),
    };
  }
  if (object(value)) {
    const properties = {};
    let omitted = 0;
    let truncated = false;
    for (const key of Object.keys(value)) {
      if (!FIELDS.has(key)) { omitted++; continue; }
      if (budget.remaining <= 0) { truncated = true; continue; }
      properties[key] = schemaOf(value[key], budget, depth + 1);
    }
    return {
      type: 'object', properties,
      ...(omitted ? { 'x-omitted-field-count': omitted } : {}),
      ...(truncated ? { 'x-truncated': true } : {}),
    };
  }
  return { type: typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value };
}

function mediaType(value) {
  if (typeof value !== 'string') return 'unknown';
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/json' || /^application\/[a-z0-9.-]+\+json$/.test(mime)) return 'json';
  if (mime === 'multipart/form-data') return 'multipart';
  if (mime === 'application/x-www-form-urlencoded') return 'form';
  if (mime === 'application/octet-stream') return 'binary';
  if (mime === 'text/plain' || mime === 'text/html') return 'text';
  return 'unknown';
}

function bodyOf(body) {
  const format = mediaType(body?.mimeType);
  if (body?.encoding) return { public: { format, state: 'encoded_body_omitted' } };
  if (typeof body?.text !== 'string' || body.text.length === 0) {
    return { public: { format, state: 'body_not_captured' } };
  }
  if (format !== 'json') return { public: { format, state: 'non_json_body_omitted' } };
  if (Buffer.byteLength(body.text, 'utf8') > LIMITS.jsonBodyBytes) {
    return { public: { format, state: 'body_size_limit' } };
  }
  try {
    const value = JSON.parse(body.text);
    return { value, public: { format, state: 'json_shape_observed', schema: schemaOf(value) } };
  } catch {
    return { public: { format, state: 'invalid_json_omitted' } };
  }
}

function routeOf(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.username || url.password) return null;
    // Do not normalize encoded traversal or accept path segments containing PII.
    const rawPath = value.slice(value.indexOf('://') + 3).split(/[?#]/, 1)[0];
    if (rawPath.includes('%') || rawPath.includes('..') || rawPath.includes('\\')) return null;
    for (const route of ROUTES) {
      const match = route.re.exec(url.pathname);
      if (match) return { path: route.path, kind: route.kind, course: match[1], activity: match[2] };
    }
  } catch { /* Never print the URL or URL parser error. */ }
  return null;
}

function scalar(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return `n:${value}`;
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return `s:${value}`;
  return null;
}

function unwrap(value) {
  if (object(value?.data)) return value.data;
  return value;
}

function uploadRefs(value) {
  if (!object(value)) return [];
  const refs = [];
  const add = (item) => {
    if (object(item)) {
      for (const key of ['upload_key', 'key', 'upload_id', 'file_id', 'id']) {
        if (scalar(item[key])) refs.push(scalar(item[key]));
      }
    } else if (scalar(item)) refs.push(scalar(item));
  };
  for (const key of ['upload_key', 'upload_id']) if (scalar(value[key])) refs.push(scalar(value[key]));
  for (const key of ['uploads', 'attachments', 'files', 'upload_ids', 'upload_keys']) {
    if (Array.isArray(value[key])) value[key].slice(0, LIMITS.receiptSamples).forEach(add);
  }
  return [...new Set(refs)];
}

function uploadResponseRefs(value) {
  const data = unwrap(value);
  const upload = object(data?.upload) ? data.upload : data;
  if (!object(upload)) return [];
  return [...new Set(['key', 'upload_key', 'id', 'upload_id'].map((key) => scalar(upload[key])).filter(Boolean))];
}

function receiptCollection(value) {
  const data = unwrap(value);
  if (Array.isArray(data)) return data;
  for (const key of ['submissions', 'student_submissions']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  if (object(data?.submission)) return [data.submission];
  return object(data) ? [data] : [];
}

function receiptRecords(value) {
  return receiptCollection(value).slice(0, LIMITS.receiptSamples).filter(object);
}

function attachmentLimitReached(value) {
  return ['uploads', 'attachments', 'files', 'upload_ids', 'upload_keys']
    .some((key) => Array.isArray(value?.[key]) && value[key].length > LIMITS.receiptSamples);
}

function submissionId(value) {
  return scalar(value?.submission_id) ?? scalar(value?.id);
}

function ownerId(value) {
  const ids = [...new Set([value?.student_id, value?.user_id, value?.student?.id, value?.user?.id]
    .map(scalar).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

function consistentActivity(value, route) {
  return ['course_id', 'activity_id', 'homework_id'].every((key) => {
    if (value?.[key] === undefined) return true;
    const expected = key === 'course_id' ? route.course : route.activity;
    return scalar(value[key]) !== null && String(value[key]) === expected;
  });
}

function explicitSubmitted(value) {
  if (value?.submitted === false) return false;
  if (value?.status !== undefined && value.status !== 'submitted') return false;
  return value?.status === 'submitted' || value?.submitted === true;
}

function hasSubmissionTime(value) {
  return typeof value?.submitted_at === 'string'
    && /^\d{4}-\d\d-\d\dT/.test(value.submitted_at)
    && Number.isFinite(Date.parse(value.submitted_at));
}

function successfulHttp(entry) {
  return entry.status >= 200 && entry.status < 300;
}

function homeworkEvidence(entries) {
  const uploads = entries.filter((entry) => entry.route.kind === 'upload_candidate' && entry.method === 'POST');
  const finals = entries.filter((entry) => entry.route.kind === 'submission_candidate' && entry.method === 'POST');
  const reads = entries.filter((entry) => ['submission_candidate', 'readback_candidate'].includes(entry.route.kind) && entry.method === 'GET');
  const identities = new Map();
  let currentIdentity = null;
  for (const entry of entries) {
    identities.set(entry.index, currentIdentity);
    if (entry.route.kind === 'profile' && entry.method === 'GET') {
      currentIdentity = successfulHttp(entry) ? scalar(unwrap(entry.response.value)?.id) : null;
    }
  }
  const chains = finals.slice(0, LIMITS.evidenceFinals).map((final) => {
    const finalBody = unwrap(final.request.value);
    const finalId = submissionId(receiptRecords(final.response.value)[0]);
    const expectedOwner = identities.get(final.index);
    const expectedFiles = uploadRefs(finalBody);
    const expectsContent = typeof finalBody?.content === 'string' && finalBody.content.length > 0;
    const linkedUploads = uploads.filter((entry) => entry.index < final.index && successfulHttp(entry)
      && uploadResponseRefs(entry.response.value).some((ref) => expectedFiles.includes(ref)));
    const uploadLinks = expectedFiles.length > 0 && expectedFiles.every((ref) => linkedUploads.some((entry) => uploadResponseRefs(entry.response.value).includes(ref)));
    const fileParts = uploadLinks && linkedUploads.every((entry) => entry.hasFilePart);
    const candidateReads = reads.filter((entry) => entry.index > final.index && successfulHttp(entry)
      && entry.route.course === final.route.course && entry.route.activity === final.route.activity);
    const analyzedReads = candidateReads.slice(0, LIMITS.evidenceReadbacks);
    const matches = analyzedReads.flatMap((entry) => receiptRecords(entry.response.value).map((receipt) => {
      const ownerMatches = expectedOwner !== null && ownerId(receipt) === expectedOwner && identities.get(entry.index) === expectedOwner;
      const receiptMatches = finalId !== null && submissionId(receipt) === finalId
        && consistentActivity(receipt, final.route) && consistentActivity(finalBody, final.route);
      const files = uploadRefs(receipt);
      const attachmentsMatch = expectedFiles.length > 0 && expectedFiles.every((ref) => files.includes(ref));
      const contentMatch = expectsContent && receipt.content === finalBody.content;
      return { entry, receipt, ownerMatches, receiptMatches, attachmentsMatch, contentMatch };
    }));
    // Keep each fact on one receipt. Never combine one student's owner field
    // with another student's submission ID or attachment/status evidence.
    const match = matches.find((item) => item.ownerMatches && item.receiptMatches
      && explicitSubmitted(item.receipt) && hasSubmissionTime(item.receipt)
      && (!expectedFiles.length || item.attachmentsMatch)
      && (!expectsContent || item.contentMatch)
      && (expectedFiles.length > 0 || expectsContent))
      ?? matches.find((item) => item.ownerMatches && item.receiptMatches);
    const observed = {
      profileIdentityBeforeFinal: expectedOwner !== null,
      finalHttp2xx: successfulHttp(final),
      finalSubmissionId: finalId !== null,
      finalAttachmentReferences: expectedFiles.length > 0,
      finalContentCaptured: expectsContent,
      uploadReferencesLinked: uploadLinks,
      uploadFilePartMetadata: fileParts,
      sameActivityReadbackAfterFinal: candidateReads.length > 0,
      sameReceiptAndOwner: Boolean(match),
      explicitSubmittedState: Boolean(match && explicitSubmitted(match.receipt)),
      submissionTimestamp: Boolean(match && hasSubmissionTime(match.receipt)),
      attachmentReferencesInReadback: Boolean(match?.attachmentsMatch),
      exactContentInReadback: Boolean(match?.contentMatch),
    };
    const missing = [];
    if (candidateReads.length > LIMITS.evidenceReadbacks) missing.push('readback_analysis_limit');
    if (analyzedReads.some((entry) => receiptCollection(entry.response.value).length > LIMITS.receiptSamples)) missing.push('receipt_analysis_limit');
    if (attachmentLimitReached(finalBody) || attachmentLimitReached(match?.receipt)) missing.push('attachment_analysis_limit');
    if (!observed.profileIdentityBeforeFinal) missing.push('profile_identity_missing');
    if (!observed.finalHttp2xx) missing.push('final_http_2xx_missing');
    if (!observed.finalSubmissionId) missing.push('final_submission_id_missing');
    if (expectedFiles.length && !uploadLinks) missing.push('upload_to_final_reference_link_missing');
    if (expectedFiles.length && !fileParts) missing.push('upload_file_part_metadata_missing');
    if (!observed.sameActivityReadbackAfterFinal) missing.push('same_activity_readback_missing');
    if (!observed.sameReceiptAndOwner) missing.push('same_receipt_and_owner_link_missing');
    if (!observed.explicitSubmittedState) missing.push('explicit_submitted_state_missing');
    if (!observed.submissionTimestamp) missing.push('submission_timestamp_missing');
    if (expectedFiles.length && !observed.attachmentReferencesInReadback) missing.push('attachment_readback_link_missing');
    if ((expectsContent || !expectedFiles.length) && !observed.exactContentInReadback) missing.push('content_readback_link_missing');
    return {
      finalEntry: final.index + 1,
      linkedUploadEntries: linkedUploads.map((entry) => entry.index + 1),
      linkedReadbackEntry: match ? match.entry.index + 1 : null,
      observed, missingEvidence: missing,
    };
  });
  return {
    uploadCandidates: uploads.length, finalCandidates: finals.length, readbackCandidates: reads.length,
    chainAnalysisTruncated: finals.length > LIMITS.evidenceFinals,
    missingTracePhases: [
      ...(!uploads.length ? ['upload_trace_missing'] : []),
      ...(!finals.length ? ['final_trace_missing'] : []),
      ...(!reads.length ? ['readback_trace_missing'] : []),
    ],
    chains,
  };
}

export function analyzeHar(har) {
  if (!object(har?.log) || !Array.isArray(har.log.entries)) throw new HarInputError('invalid_har');
  if (har.log.entries.length > LIMITS.entries) throw new HarInputError('entry_limit_exceeded');
  const selected = [];
  let ignored = 0;
  for (let index = 0; index < har.log.entries.length; index++) {
    const entry = har.log.entries[index];
    const route = routeOf(entry?.request?.url);
    const method = entry?.request?.method;
    if (!route || !METHODS.has(method)) { ignored++; continue; }
    const status = Number.isInteger(entry?.response?.status) && entry.response.status >= 100 && entry.response.status <= 599
      ? entry.response.status : null;
    const request = bodyOf(entry?.request?.postData);
    const response = bodyOf(entry?.response?.content);
    const params = entry?.request?.postData?.params;
    const hasFilePart = request.public.format === 'multipart' && Array.isArray(params)
      && params.some((param) => typeof param?.fileName === 'string' && param.fileName.length > 0);
    selected.push({ index, route, method, status, request, response, hasFilePart });
  }
  return {
    formatVersion: 1,
    contractVerified: false,
    evidenceLevel: 'untrusted_offline_trace_only',
    origin: ORIGIN,
    limits: LIMITS,
    entryCounts: { total: har.log.entries.length, included: selected.length, ignored },
    entries: selected.map((entry) => ({
      entry: entry.index + 1,
      endpoint: entry.route.path,
      role: entry.route.kind,
      method: entry.method,
      httpStatus: entry.status,
      requestBody: entry.request.public,
      responseBody: entry.response.public,
    })),
    homeworkEvidence: homeworkEvidence(selected),
    manualReviewRequired: [
      'school_endpoint_and_field_semantics',
      'account_and_session_binding',
      'actual_binary_upload_completion',
      'authoritative_receipt_and_policy_rules',
      'receipt_freshness_and_server_timestamps',
      'idempotency_timeout_and_error_variants',
      'authorized_school_sandbox_acceptance',
    ],
  };
}

export async function analyzeHarFile(path) {
  if (typeof path !== 'string' || !path || path.includes('://')) throw new HarInputError('local_file_required');
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HarInputError('regular_file_required');
    if (stat.size > LIMITS.fileBytes) throw new HarInputError('file_size_limit_exceeded');
    // Bound the actual read as well as stat: a file can grow after stat.
    const buffer = Buffer.alloc(LIMITS.fileBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const chunk = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (chunk.bytesRead === 0) break;
      bytes += chunk.bytesRead;
    }
    if (bytes > LIMITS.fileBytes) throw new HarInputError('file_size_limit_exceeded');
    let parsed;
    try { parsed = JSON.parse(buffer.subarray(0, bytes).toString('utf8')); }
    catch { throw new HarInputError('invalid_har_json'); }
    return analyzeHar(parsed);
  } catch (error) {
    if (error instanceof HarInputError) throw error;
    throw new HarInputError('local_file_read_failed');
  } finally {
    await handle?.close();
  }
}

async function main() {
  try {
    if (process.argv.length !== 3) throw new HarInputError('usage_node_analyze_har_local_file');
    const report = await analyzeHarFile(process.argv[2]);
    const output = JSON.stringify(report, null, 2);
    if (Buffer.byteLength(output, 'utf8') > LIMITS.outputBytes) throw new HarInputError('output_size_limit_exceeded');
    process.stdout.write(`${output}\n`);
  } catch (error) {
    const code = error instanceof HarInputError ? error.code : 'analysis_failed';
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
