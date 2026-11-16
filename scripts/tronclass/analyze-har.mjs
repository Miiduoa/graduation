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
// Public-client evidence: docs/nuni/tronclass-public-contract-2026-11-16.md.
// A recognized route is still only an observation in an editable offline HAR.
const ROUTES = [
  { re: /^\/api\/profile\/?$/, path: '/api/profile', kind: 'profile' },
  { re: /^\/api\/uploads\/?$/, path: '/api/uploads', kind: 'upload_metadata' },
  { re: /^\/api\/uploads\/[A-Za-z0-9_-]{1,128}\/blob\/?$/, path: '/api/uploads/{uploadKey}/blob', kind: 'download' },
  { re: /^\/internal-api\/upload\/callback\/(\d{1,20})\/?$/, path: '/internal-api/upload/callback/{uploadId}', kind: 'upload_callback', ids: ['upload'] },
  { re: /^\/api\/course\/activities\/(\d{1,20})\/submissions\/?$/, path: '/api/course/activities/{activityId}/submissions', kind: 'submission', ids: ['activity'] },
  { re: /^\/api\/activities\/(\d{1,20})\/students\/(\d{1,20})\/submission_list\/?$/, path: '/api/activities/{activityId}/students/{studentId}/submission_list', kind: 'student_history', ids: ['activity', 'student'] },
  { re: /^\/api\/course\/activities\/(\d{1,20})\/students\/(\d{1,20})\/submission\/?$/, path: '/api/course/activities/{activityId}/students/{studentId}/submission', kind: 'student_submission', ids: ['activity', 'student'] },
  { re: /^\/api\/activities\/(\d{1,20})\/groups\/(\d{1,20})\/submission_list\/?$/, path: '/api/activities/{activityId}/groups/{groupId}/submission_list', kind: 'group_history', ids: ['activity', 'group'] },
  { re: /^\/api\/courses\/?$/, path: '/api/courses', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/?$/, path: '/api/courses/{courseId}/homework-activities', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/(\d{1,20})\/?$/, path: '/api/courses/{courseId}/homework-activities/{activityId}', kind: 'read' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/(\d{1,20})\/submissions\/?$/, path: '/api/courses/{courseId}/homework-activities/{activityId}/submissions', kind: 'legacy_submission_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/homework-activities\/(\d{1,20})\/student-submissions\/?$/, path: '/api/courses/{courseId}/homework-activities/{activityId}/student-submissions', kind: 'legacy_readback_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/activities\/(\d{1,20})\/student-submissions\/?$/, path: '/api/courses/{courseId}/activities/{activityId}/student-submissions', kind: 'legacy_readback_candidate' },
  { re: /^\/api\/courses\/(\d{1,20})\/activities\/?$/, path: '/api/courses/{courseId}/activities', kind: 'read' },
  { re: /^\/api\/activities\/(\d{1,20})\/?$/, path: '/api/activities/{activityId}', kind: 'activity', ids: ['activity'] },
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
  'list', 'comment', 'is_draft', 'is_redo', 'is_latest_version', 'created_by',
  'submit_by_instructor', 'marked_submitted', 'submit_by_group', 'group_id', 'group',
  'upload_url', 'storage_type', 'transcoder', 'file_key', 'parent_type', 'parent_id',
  'is_scorm', 'is_wmpkg', 'source', 'is_marked_attachment', 'embed_material_type',
  'slides', 'other_resources', 'uploads_in_rich_text', 'multiple_choice_title',
  'mode', 'type', 'is_announce_score_time_passed', 'slide_references',
  'is_hidden', 'hidden', 'published', 'next_page', 'total_count', 'has_more',
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

function safeUrl(value, relative = false) {
  if (typeof value !== 'string' || !value || value.length > 8192
    || Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    || value.includes('\\')) return null;
  const absolute = relative && value.startsWith('/') && !value.startsWith('//') ? `${ORIGIN}${value}` : value;
  if (!absolute.startsWith('https://')) return null;
  try {
    const url = new URL(absolute);
    const rawPath = absolute.slice(absolute.indexOf('://') + 3).split(/[?#]/, 1)[0];
    if (url.username || url.password || url.hash || rawPath.includes('%') || rawPath.includes('..')) return null;
    return url;
  } catch { return null; } // Never print a URL or a URL parser error.
}

function numericId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function sameSchoolOrigin(value) {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && !url.username && !url.password;
  } catch { return false; }
}

function routeOf(value) {
  const url = safeUrl(value);
  if (!url || url.origin !== ORIGIN) return null;
  for (const route of ROUTES) {
    const match = route.re.exec(url.pathname);
    if (match) {
      const ids = Object.fromEntries((route.ids ?? []).map((key, index) => [key, numericId(Number(match[index + 1]))]));
      return { path: route.path, kind: route.kind, ...ids };
    }
  }
  return null;
}

function successfulHttp(entry) {
  return entry?.status >= 200 && entry.status < 300;
}

function visible(value) {
  if (!object(value)) return false;
  return ['is_hidden', 'hidden'].every((key) => value[key] === undefined || value[key] === false || value[key] === 0)
    && (value.published === undefined || value.published === true || value.published === 1);
}

function submissionState(row) {
  if (!object(row) || !visible(row)
    || (row.is_latest_version !== undefined && typeof row.is_latest_version !== 'boolean')) return 'unknown';
  if (row.is_draft === true && row.is_redo === true) return 'unknown';
  if (row.is_draft === true) return 'draft';
  if (row.is_redo === true) return 'returned';
  if (row.is_draft !== false || row.is_redo !== false) return 'unknown';
  if (row.submit_by_instructor === false) return 'submitted';
  if (row.submit_by_instructor === true && row.marked_submitted === true) return 'teacher-marked';
  return 'unknown';
}

function submissionIntent(entry) {
  const flag = entry.request.value?.is_draft;
  return flag === false ? 'final' : flag === true ? 'draft' : 'unknown';
}

function historyDetails(value) {
  const recognized = object(value) && Array.isArray(value.list);
  const rows = recognized ? value.list.slice(0, LIMITS.receiptSamples) : [];
  const truncated = recognized && value.list.length > LIMITS.receiptSamples;
  const ids = rows.map((row) => numericId(row?.id));
  const paginationUnknown = recognized && (
    (value.total !== undefined && value.total !== value.list.length)
    || (value.has_next !== undefined && value.has_next !== false)
    || (value.next_page !== undefined && value.next_page !== null)
    || ['paging', 'pagination', 'page', 'pages', 'page_size', 'page_count', 'total_pages',
      'total_count', 'next', 'next_cursor', 'cursor', 'has_more'].some((key) => Object.hasOwn(value, key)));
  const latest = rows.filter((row) => row?.is_latest_version === true);
  const complete = recognized && !truncated && !paginationUnknown && rows.every(object)
    && ids.every((id) => id !== null) && new Set(ids).size === ids.length && latest.length <= 1;
  const counts = { submitted: 0, draft: 0, returned: 0, 'teacher-marked': 0, unknown: 0 };
  for (const row of rows) counts[submissionState(row)]++;
  return {
    rows, complete, truncated, latest: latest.length === 1 ? latest[0] : null,
    public: {
      recognizedEnvelope: recognized, recordsSampled: rows.length, analysisTruncated: truncated,
      shapeAndPaginationConsistent: complete,
      latestMarker: !recognized ? 'unavailable' : latest.length > 1 ? 'ambiguous' : latest.length === 1 ? 'unique' : 'absent',
      latestState: complete && latest.length === 1 ? submissionState(latest[0]) : null,
      stateCounts: counts,
    },
  };
}

function uploadIds(value, records = false) {
  if (!Array.isArray(value)) return { ids: [], valid: false, truncated: false };
  const truncated = value.length > LIMITS.receiptSamples;
  const ids = value.slice(0, LIMITS.receiptSamples).map((item) => numericId(records ? item?.id : item));
  return { ids: ids.filter((id) => id !== null), valid: !truncated && ids.every((id) => id !== null)
    && new Set(ids).size === ids.length, truncated };
}

function uploadDetails(entry) {
  const request = entry.request.value;
  const response = entry.response.value;
  const url = safeUrl(response?.upload_url, true);
  const urlPolicy = url ? url.origin === ORIGIN ? 'same-origin' : 'cross-origin-unsupported'
    : response?.upload_url === undefined ? 'missing' : 'invalid';
  const storage = response?.storage_type;
  const raw = storage === 'S3' && response?.transcoder === 'WRPC';
  const modeKnown = typeof storage === 'string' && storage.length > 0 && storage.length <= 64
    && storage !== 'QINIU' && (storage !== 'S3' || typeof response?.transcoder === 'string');
  return {
    id: numericId(response?.id), url: urlPolicy === 'same-origin' ? url.href : null, urlPolicy,
    metadataShapeKnown: object(request) && typeof request.name === 'string' && request.name.length > 0
      && Number.isSafeInteger(request.size) && request.size >= 0,
    name: request?.name, size: request?.size,
    mode: !modeKnown ? 'unsupported' : raw ? 'raw-put' : 'multipart-put',
    callbackRequired: modeKnown ? raw : null,
    qiniu: storage === 'QINIU',
  };
}

function identityContexts(entries, interruptions) {
  const contexts = new Map();
  let owner = null;
  let epoch = 0;
  for (const entry of [...entries, ...interruptions].sort((first, second) => first.index - second.index)) {
    contexts.set(entry.index, { owner, epoch });
    if ((entry.route.kind === 'profile' && entry.method === 'GET') || entry.status === 401) {
      const next = entry.route.kind === 'profile' && successfulHttp(entry) ? numericId(entry.response.value?.id) : null;
      if (next !== owner) epoch++;
      owner = next;
    }
  }
  return contexts;
}

function sameContext(contexts, first, second) {
  const a = contexts.get(first.index);
  const b = contexts.get(second.index);
  return Boolean(a && b && a.owner !== null && a.owner === b.owner && a.epoch === b.epoch);
}

function sameScope(row, activity, course) {
  return object(row) && ['activity_id', 'homework_id'].every((key) => row[key] === undefined || row[key] === activity)
    && (row.course_id === undefined || (course !== null && row.course_id === course))
    && Object.entries({ activity, homework: activity, course }).every(([key, expected]) => row[key] === undefined
      || (expected !== null && object(row[key]) && row[key].id === expected));
}

function declaredOwnerConsistent(row, owner, teacherCreator = false) {
  if (!object(row) || owner === null) return false;
  if (['student_id', 'user_id'].some((key) => row[key] !== undefined && row[key] !== owner)) return false;
  for (const key of ['student', 'user', 'created_by']) {
    if (row[key] === undefined) continue;
    if (!object(row[key]) || numericId(row[key].id) === null
      || (!(teacherCreator && key === 'created_by') && row[key].id !== owner)) return false;
  }
  return (row.group_id === undefined || row.group_id === null || row.group_id === 0)
    && (row.group === undefined || row.group === null)
    && (row.submit_by_group === undefined || row.submit_by_group === false);
}

function personalOwner(row, owner) {
  return object(row?.created_by) && row.created_by.id === owner && declaredOwnerConsistent(row, owner);
}

function personalHistoryScope(history, owner, activity, course) {
  return owner !== null && history.complete && history.rows.every((row) =>
    object(row?.created_by) && numericId(row.created_by.id) !== null && visible(row)
    && sameScope(row, activity, course) && declaredOwnerConsistent(row, owner, row.submit_by_instructor === true));
}

function sourceCreatedAt(row) {
  return typeof row?.created_at === 'string' && row.created_at.length <= 80
    && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(row.created_at) && Number.isFinite(Date.parse(row.created_at));
}

function uploadEvidence(id, final, entries, contexts) {
  const metadata = entries.filter((entry) => entry.route.kind === 'upload_metadata' && entry.method === 'POST'
    && entry.index < final.index && entry.upload?.id === id && sameContext(contexts, entry, final));
  const meta = metadata.length === 1 ? metadata[0] : null;
  const binaries = meta ? entries.filter((entry) => entry.route.kind === 'upload_binary' && entry.method === 'PUT'
    && entry.index > meta.index && entry.index < final.index && entry.metadataIndexes.length === 1
    && entry.metadataIndexes[0] === meta.index && sameContext(contexts, entry, final)) : [];
  const binary = binaries.at(-1);
  const callbacks = meta && binary ? entries.filter((entry) => entry.route.kind === 'upload_callback' && entry.method === 'POST'
    && entry.route.upload === id && entry.request.value?.file_key === id
    && entry.index > binary.index && entry.index < final.index && sameContext(contexts, entry, final)) : [];
  const callback = callbacks.at(-1);
  const parent = meta?.request.value;
  const returnedParent = meta?.response.value;
  const parentScopeConsistent = Boolean(parent && (parent.parent_type === 'activity'
    ? parent.parent_id === final.route.activity
    : parent.parent_type === null && parent.parent_id === 0)
    && ['parent_type', 'parent_id'].every((key) => returnedParent?.[key] === undefined || returnedParent[key] === parent[key]));
  const payloadMetadata = Boolean(meta && binary && (meta.upload.mode === 'raw-put'
    ? binary.rawPayloadMetadata && binary.requestBodySize === meta.upload.size
    : meta.upload.mode === 'multipart-put' && binary.fileNames.length === 1 && binary.fileNames[0] === meta.upload.name));
  const observed = {
    uniqueMetadataReference: Boolean(meta), metadataHttp2xx: successfulHttp(meta),
    metadataShapeKnown: Boolean(meta?.upload.metadataShapeKnown),
    parentScopeConsistent,
    sameOriginExactUploadUrl: Boolean(meta?.upload.url && binary),
    binaryHttp2xx: successfulHttp(binary), binaryPayloadMetadata: payloadMetadata,
    callbackRequirementKnown: meta?.upload.callbackRequired !== null && Boolean(meta),
    requiredCallbackHttp2xx: Boolean(meta && meta.upload.callbackRequired !== null
      && (!meta.upload.callbackRequired || successfulHttp(callback))),
  };
  const missing = [];
  if (!meta) missing.push(metadata.length > 1 ? 'upload_metadata_reference_ambiguous' : 'upload_to_final_reference_link_missing');
  if (meta && !observed.metadataHttp2xx) missing.push('upload_metadata_http_2xx_missing');
  if (meta && !observed.metadataShapeKnown) missing.push('upload_metadata_shape_missing');
  if (meta && !parentScopeConsistent) missing.push(parent?.parent_type === 'activity' || returnedParent?.parent_type === 'activity'
    ? 'upload_parent_activity_mismatch' : 'upload_parent_scope_unsupported');
  if (meta?.upload.urlPolicy === 'cross-origin-unsupported') missing.push('cross_origin_upload_url_unsupported');
  if (meta && !meta.upload.url) missing.push('same_origin_upload_url_missing');
  if (meta?.upload.qiniu) missing.push('qiniu_upload_flow_unsupported');
  if (meta?.upload.mode === 'unsupported') missing.push('upload_storage_flow_unsupported');
  if (!observed.sameOriginExactUploadUrl || !observed.binaryHttp2xx) missing.push('binary_put_observation_missing');
  if (!payloadMetadata) missing.push('binary_payload_metadata_missing');
  if (!observed.callbackRequirementKnown) missing.push('upload_callback_requirement_unknown');
  if (meta?.upload.callbackRequired && !observed.requiredCallbackHttp2xx) missing.push('upload_callback_observation_missing');
  return {
    metadataEntry: meta ? meta.index + 1 : null, binaryEntry: binary ? binary.index + 1 : null,
    callbackEntry: callback ? callback.index + 1 : null, observed, missingEvidence: missing,
  };
}

function homeworkEvidence(entries, interruptions) {
  const uploads = entries.filter((entry) => entry.route.kind === 'upload_metadata' && entry.method === 'POST');
  const binaries = entries.filter((entry) => entry.route.kind === 'upload_binary' && entry.method === 'PUT');
  const callbacks = entries.filter((entry) => entry.route.kind === 'upload_callback' && entry.method === 'POST');
  const submissions = entries.filter((entry) => entry.route.kind === 'submission' && ['POST', 'PUT'].includes(entry.method));
  const finals = submissions.filter((entry) => submissionIntent(entry) === 'final');
  const reads = entries.filter((entry) => entry.route.kind === 'student_history' && entry.method === 'GET');
  const activities = entries.filter((entry) => entry.route.kind === 'activity' && entry.method === 'GET');
  const contexts = identityContexts(entries, interruptions);
  const chains = finals.slice(0, LIMITS.evidenceFinals).map((final) => {
    const body = final.request.value;
    const finalRow = final.response.value?.submission;
    const finalId = numericId(finalRow?.id);
    const expectedOwner = contexts.get(final.index).owner;
    const files = uploadIds(body?.uploads);
    const contentCaptured = typeof body?.comment === 'string';
    const activity = activities.filter((entry) => entry.index < final.index && entry.route.activity === final.route.activity
      && sameContext(contexts, entry, final)).at(-1);
    const activityData = activity?.response.value;
    const course = numericId(activityData?.course_id);
    const individualActivity = successfulHttp(activity) && activityData?.id === final.route.activity && course !== null
      && activityData?.type === 'homework' && activityData?.submit_by_group === false && visible(activityData);
    const nextWrite = submissions.find((entry) => entry.index > final.index && entry.route.activity === final.route.activity);
    const candidateReads = reads.filter((entry) => entry.index > final.index && entry.index < (nextWrite?.index ?? Infinity)
      && entry.route.activity === final.route.activity);
    const analyzedReads = candidateReads.slice(0, LIMITS.evidenceReadbacks);
    // Use the latest observed read in this attempt's interval. A later returned,
    // malformed or inaccessible history must not be replaced by an older success.
    const readback = analyzedReads.at(-1);
    const history = historyDetails(readback?.response.value);
    const readbackScope = personalHistoryScope(history, expectedOwner, final.route.activity, course);
    const matched = finalId !== null && readbackScope ? history.rows.find((row) => row.id === finalId) : null;
    const sameReadOwner = Boolean(readback && expectedOwner !== null && readback.route.student === expectedOwner
      && sameContext(contexts, readback, final));
    const ownerMatches = sameReadOwner && personalOwner(matched, expectedOwner);
    const finalIdentityConsistent = declaredOwnerConsistent(final.response.value, expectedOwner)
      && declaredOwnerConsistent(finalRow, expectedOwner);
    const receiptMatches = Boolean(matched && finalIdentityConsistent && sameScope(matched, final.route.activity, course)
      && sameScope(body, final.route.activity, course) && sameScope(finalRow, final.route.activity, course)
      && sameScope(final.response.value, final.route.activity, course));
    const receiptFiles = uploadIds(matched?.uploads, true);
    const attachmentsMatch = Boolean(matched && files.valid && receiptFiles.valid && files.ids.length === receiptFiles.ids.length
      && files.ids.every((id) => receiptFiles.ids.includes(id)));
    const contentMatch = Boolean(matched && contentCaptured && matched.comment === body.comment);
    const baseline = reads.filter((entry) => entry.index < final.index && entry.route.activity === final.route.activity
      && entry.route.student === expectedOwner && sameContext(contexts, entry, final)).at(-1);
    const before = historyDetails(baseline?.response.value);
    const baselineKnown = successfulHttp(baseline) && personalHistoryScope(before, expectedOwner, final.route.activity, course);
    const prior = finalId !== null ? before.rows.find((row) => row?.id === finalId) : null;
    const putTarget = final.method === 'PUT' && finalId !== null && body?.submission_id === finalId;
    const freshTransition = baselineKnown && finalId !== null && (final.method === 'POST'
      ? body?.submission_id === undefined && !prior
      : putTarget && personalOwner(prior, expectedOwner) && sameScope(prior, final.route.activity, course)
        && submissionState(prior) === 'draft');
    const standardResources = body?.mode === 'normal'
      && ['slides', 'other_resources', 'uploads_in_rich_text'].every((key) => Array.isArray(body?.[key]) && body[key].length === 0);
    const stages = files.valid ? files.ids.map((id) => uploadEvidence(id, final, entries, contexts)) : [];
    const observed = {
      profileIdentityBeforeFinal: expectedOwner !== null,
      individualActivityBeforeFinal: Boolean(individualActivity), finalHttp2xx: successfulHttp(final),
      finalSubmissionId: finalId !== null,
      finalResponseStudentConsistent: finalIdentityConsistent,
      finalUploadIdsValid: files.valid, finalAttachmentReferences: files.ids.length > 0,
      finalContentCaptured: contentCaptured, standardResourcesOnly: standardResources,
      finalHasContentOrAttachments: Boolean((contentCaptured && body.comment.trim()) || files.ids.length),
      putDraftTargetMatchesResponse: putTarget,
      uploadReferencesLinked: stages.length > 0 && stages.every((stage) => stage.observed.uniqueMetadataReference
        && stage.observed.metadataHttp2xx && stage.observed.metadataShapeKnown && stage.observed.parentScopeConsistent),
      binaryPutAndPayloadObserved: stages.length > 0 && stages.every((stage) => stage.observed.sameOriginExactUploadUrl
        && stage.observed.binaryHttp2xx && stage.observed.binaryPayloadMetadata),
      requiredCallbacksObserved: stages.length > 0 && stages.every((stage) => stage.observed.callbackRequirementKnown
        && stage.observed.requiredCallbackHttp2xx),
      sameActivityReadbackAfterFinal: candidateReads.length > 0,
      readbackHttp2xx: successfulHttp(readback), readbackShapeAndPaginationConsistent: history.complete,
      readbackScopeConsistent: readbackScope,
      readbackIdentityContext: sameReadOwner,
      sameReceiptAndOwner: ownerMatches && receiptMatches,
      explicitStudentSubmittedState: Boolean(matched && submissionState(matched) === 'submitted'),
      latestVersionMatches: Boolean(matched && history.latest === matched && matched.is_latest_version === true),
      sourceCreatedAtCaptured: sourceCreatedAt(matched),
      attachmentReferencesInReadback: attachmentsMatch, exactContentInReadback: contentMatch,
      prefinalHistoryObserved: baselineKnown, newSubmissionOrDraftTransition: Boolean(freshTransition),
    };
    const missing = [];
    if (candidateReads.length > LIMITS.evidenceReadbacks) missing.push('readback_analysis_limit');
    if (history.truncated || before.truncated) missing.push('receipt_analysis_limit');
    if (files.truncated || receiptFiles.truncated) missing.push('attachment_analysis_limit');
    for (const [field, code] of [
      ['profileIdentityBeforeFinal', 'profile_identity_missing'],
      ['individualActivityBeforeFinal', 'individual_activity_missing_or_unsupported'],
      ['finalHttp2xx', 'final_http_2xx_missing'], ['finalSubmissionId', 'final_submission_id_missing'],
      ['finalResponseStudentConsistent', 'final_response_student_conflict'],
      ['finalUploadIdsValid', 'final_upload_ids_missing_or_invalid'], ['finalContentCaptured', 'final_comment_missing'],
      ['standardResourcesOnly', 'nonstandard_resources_or_mode_unsupported'],
      ['finalHasContentOrAttachments', 'final_content_or_attachments_missing'],
      ['sameActivityReadbackAfterFinal', 'same_activity_readback_missing'], ['readbackHttp2xx', 'readback_http_2xx_missing'],
      ['readbackShapeAndPaginationConsistent', 'readback_shape_or_pagination_incomplete'],
      ['readbackScopeConsistent', 'readback_owner_or_scope_conflict'],
      ['readbackIdentityContext', 'readback_identity_context_missing'],
      ['sameReceiptAndOwner', 'same_receipt_and_owner_link_missing'],
      ['explicitStudentSubmittedState', 'explicit_student_submitted_state_missing'],
      ['latestVersionMatches', 'latest_version_match_missing'], ['sourceCreatedAtCaptured', 'source_created_at_missing'],
      ['attachmentReferencesInReadback', 'attachment_readback_link_missing'], ['exactContentInReadback', 'content_readback_link_missing'],
      ['prefinalHistoryObserved', 'prefinal_history_missing_or_incomplete'],
      ['newSubmissionOrDraftTransition', 'new_submission_or_draft_transition_unproven'],
    ]) if (!observed[field]) missing.push(code);
    if (final.method === 'PUT' && !putTarget) missing.push('put_draft_target_missing_or_conflicting');
    for (const stage of stages) missing.push(...stage.missingEvidence);
    return {
      finalEntry: final.index + 1, method: final.method,
      linkedActivityEntry: activity ? activity.index + 1 : null,
      linkedBaselineReadbackEntry: baseline ? baseline.index + 1 : null,
      linkedUploadEntries: stages.map((stage) => stage.metadataEntry).filter((index) => index !== null),
      linkedBinaryUploadEntries: stages.map((stage) => stage.binaryEntry).filter((index) => index !== null),
      linkedCallbackEntries: stages.map((stage) => stage.callbackEntry).filter((index) => index !== null),
      linkedReadbackEntry: matched && readback ? readback.index + 1 : null,
      readbackState: submissionState(matched), uploads: stages, observed, missingEvidence: [...new Set(missing)],
    };
  });
  return {
    uploadMetadataCandidates: uploads.length, binaryPutCandidates: binaries.length, callbackCandidates: callbacks.length,
    finalCandidates: finals.length, draftCandidates: submissions.filter((entry) => submissionIntent(entry) === 'draft').length,
    unknownSubmissionCandidates: submissions.filter((entry) => submissionIntent(entry) === 'unknown').length,
    readbackCandidates: reads.length, activityReads: activities.length,
    unlistedSessionInterruptions: interruptions.length,
    chainAnalysisTruncated: finals.length > LIMITS.evidenceFinals,
    missingTracePhases: [
      ...(!activities.length ? ['activity_trace_missing'] : []),
      ...(!uploads.length ? ['upload_metadata_trace_missing'] : []),
      ...(!binaries.length ? ['upload_binary_trace_missing'] : []),
      ...(!callbacks.length ? ['upload_callback_trace_missing'] : []),
      ...(!finals.length ? ['final_trace_missing'] : []),
      ...(!reads.length ? ['student_history_trace_missing'] : []),
    ],
    unsupportedTraceKinds: [
      ...(entries.some((entry) => entry.route.kind.startsWith('legacy_')) ? ['legacy_submission_paths'] : []),
      ...(entries.some((entry) => entry.route.kind === 'group_history') ? ['group_submission_history'] : []),
      ...(entries.some((entry) => entry.route.kind === 'student_submission') ? ['single_submission_as_complete_history'] : []),
      ...(uploads.some((entry) => entry.upload.urlPolicy === 'cross-origin-unsupported') ? ['cross_origin_binary_upload'] : []),
      ...(uploads.some((entry) => entry.upload.qiniu) ? ['qiniu_chunk_upload'] : []),
    ],
    chains,
  };
}

export function analyzeHar(har) {
  if (!object(har?.log) || !Array.isArray(har.log.entries)) throw new HarInputError('invalid_har');
  if (har.log.entries.length > LIMITS.entries) throw new HarInputError('entry_limit_exceeded');
  const selected = [];
  const metadata = [];
  const interruptions = [];
  let ignored = 0;
  for (let index = 0; index < har.log.entries.length; index++) {
    const entry = har.log.entries[index];
    const method = entry?.request?.method;
    const status = Number.isInteger(entry?.response?.status) && entry.response.status >= 100 && entry.response.status <= 599
      ? entry.response.status : null;
    let route = routeOf(entry?.request?.url);
    let metadataIndexes = [];
    if (!route && method === 'PUT') {
      const url = safeUrl(entry?.request?.url);
      // No storage-host wildcard: one successful same-origin metadata response
      // authorizes inspection of precisely its returned URL, including query.
      if (url?.origin === ORIGIN) metadataIndexes = metadata.filter((candidate) =>
        successfulHttp(candidate) && candidate.upload.id !== null && candidate.upload.metadataShapeKnown
        && candidate.upload.url === url.href).map((candidate) => candidate.index);
      if (metadataIndexes.length) route = { path: '{sameOriginUploadUrl}', kind: 'upload_binary' };
    }
    if (!route || !METHODS.has(method)) {
      // Retain only a private, path-free interruption marker. Unknown school
      // endpoints can invalidate identity without entering the public allowlist.
      if (status === 401 && sameSchoolOrigin(entry?.request?.url)) {
        interruptions.push({ index, route: { kind: 'session_interruption' }, method: '', status });
      }
      ignored++; continue;
    }
    const request = route.kind === 'upload_binary'
      ? { public: { format: mediaType(entry?.request?.postData?.mimeType), state: 'binary_body_omitted' } }
      : bodyOf(entry?.request?.postData);
    const response = bodyOf(entry?.response?.content);
    const params = entry?.request?.postData?.params;
    const fileNames = request.public.format === 'multipart' && Array.isArray(params) && params.length <= LIMITS.receiptSamples
      ? params.filter((param) => param?.name === 'file' && typeof param.fileName === 'string' && param.fileName.length > 0)
        .map((param) => param.fileName) : [];
    const requestBodySize = Number.isSafeInteger(entry?.request?.bodySize) && entry.request.bodySize >= 0
      ? entry.request.bodySize : null;
    const rawPayloadMetadata = typeof entry?.request?.postData?.mimeType === 'string'
      && entry.request.postData.mimeType.length > 0 && request.public.format !== 'multipart' && requestBodySize !== null;
    const item = { index, route, method, status, request, response, metadataIndexes, fileNames, requestBodySize, rawPayloadMetadata };
    if (route.kind === 'upload_metadata' && method === 'POST') {
      item.upload = uploadDetails(item);
      metadata.push(item);
    }
    selected.push(item);
  }
  return {
    formatVersion: 2,
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
      ...(entry.route.kind === 'submission' && ['POST', 'PUT'].includes(entry.method)
        ? { submissionIntent: submissionIntent(entry) } : {}),
      ...(entry.route.kind === 'student_history' && entry.method === 'GET'
        ? { history: historyDetails(entry.response.value).public } : {}),
      ...(entry.upload ? { uploadMetadata: { uploadUrlPolicy: entry.upload.urlPolicy,
        transferMode: entry.upload.mode, callbackRequired: entry.upload.callbackRequired } } : {}),
      ...(entry.route.kind === 'upload_binary' ? { associatedMetadataEntries: entry.metadataIndexes.map((index) => index + 1) } : {}),
    })),
    homeworkEvidence: homeworkEvidence(selected, interruptions),
    manualReviewRequired: [
      'school_endpoint_and_field_semantics',
      'account_and_session_binding',
      'actual_binary_upload_completion',
      'cross_origin_storage_and_qiniu_contracts',
      'authoritative_receipt_and_policy_rules',
      'history_completeness_and_authoritative_submission_time',
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
