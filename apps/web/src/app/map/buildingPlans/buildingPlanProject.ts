'use client';

import { MAX_BUILDING_PLAN_BYTES, type BuildingPlanScope, type PlanPoint, type PlanRoom } from './buildingPlan';
import { prepareBuildingPlanReference } from './buildingPlanReference';
import { buildTracedBuildingPlan } from './buildingPlanTracing';

export type BuildingPlanProjectDraft = {
  name: string;
  floorLabel: string;
  sourceLabel: string;
  sourceUrl: string;
  outline: PlanPoint[];
  rooms: PlanRoom[];
  mode: 'outline' | 'room' | 'calibration' | null;
  points: PlanPoint[];
  roomName: string;
  calibration: [PlanPoint, PlanPoint] | null;
  metres: string;
  floorHeight: string;
  x: string;
  y: string;
};

export type BuildingPlanProjectReference = { blob: Blob; width: number; height: number; name: string };
type ReferenceMetadata = Omit<BuildingPlanProjectReference, 'blob'>;

export const MAX_BUILDING_PLAN_PROJECT_BYTES = 16 * 1024 * 1024;
export const MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES = 10 * 1024 * 1024;
const FORMAT = 'nuni.building-plan-project';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('已取消讀取編輯檔', 'AbortError');
}

function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), '編輯檔資料格式不正確。');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string {
  requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0),
    `${label}格式不正確或超過 ${max} 字。`);
  return value;
}

function point(value: unknown): PlanPoint {
  requireValue(Array.isArray(value) && value.length === 2 && [value[0], value[1]].every(item =>
    typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1),
  '編輯檔描點需以 0 到 1 的圖片比例表示。');
  return [value[0], value[1]];
}

function points(value: unknown, max = 64): PlanPoint[] {
  requireValue(Array.isArray(value) && value.length <= max, `編輯檔描點數量不可超過 ${max}。`);
  return Array.from(value, point);
}

function scopeSnapshot(scope: BuildingPlanScope): BuildingPlanScope {
  return { schoolId: text(scope.schoolId, '學校代碼', 100, true), buildingId: text(scope.buildingId, '建築代碼', 100, true) };
}

function referenceMetadata(value: unknown): ReferenceMetadata {
  const input = record(value);
  requireValue(typeof input.width === 'number' && Number.isInteger(input.width) && input.width >= 1 && input.width <= 2048 &&
    typeof input.height === 'number' && Number.isInteger(input.height) && input.height >= 1 && input.height <= 2048,
  '編輯檔底圖尺寸不正確，長邊不可超過 2048 像素。');
  return { width: input.width, height: input.height, name: text(input.name, '底圖名稱', 255, true) };
}

/** Clone editable text as-is; only completed polygons must already be valid geometry. */
function draftSnapshot(value: unknown, image: ReferenceMetadata, scope: BuildingPlanScope): BuildingPlanProjectDraft {
  const input = record(value);
  requireValue(input.mode === null || input.mode === 'outline' || input.mode === 'room' || input.mode === 'calibration',
    '編輯檔的描圖步驟不正確。');
  requireValue(Array.isArray(input.rooms) && input.rooms.length <= 200, '編輯檔最多包含 200 個房間。');
  const ids = new Set<string>();
  const rooms = Array.from(input.rooms, item => {
    const room = record(item);
    const id = text(room.id, '房間代碼', 100, true).trim();
    requireValue(!ids.has(id), '編輯檔的房間代碼不可重複。');
    ids.add(id);
    return { id, name: text(room.name, '房間名稱', 100), polygon: points(room.polygon) };
  });
  const calibration = input.calibration === null ? null : points(input.calibration, 2);
  requireValue(calibration === null || calibration.length === 2, '已套用的比例校正需有兩個描點。');
  const result: BuildingPlanProjectDraft = {
    name: text(input.name, '圖面名稱', 100),
    floorLabel: text(input.floorLabel, '樓層名稱', 100),
    sourceLabel: text(input.sourceLabel, '來源名稱', 160),
    sourceUrl: text(input.sourceUrl, '來源網址', 2048),
    outline: points(input.outline), rooms, mode: input.mode,
    points: points(input.points, input.mode === 'calibration' ? 2 : 64),
    roomName: text(input.roomName, '新房間名稱', 100),
    calibration: calibration as [PlanPoint, PlanPoint] | null,
    metres: text(input.metres, '校正距離輸入', 64),
    floorHeight: text(input.floorHeight, '樓高輸入', 64),
    x: text(input.x, '水平位置輸入', 64),
    y: text(input.y, '垂直位置輸入', 64),
  };
  requireValue(result.mode === 'outline'
    ? result.outline.length === 0 && rooms.length === 0 && result.calibration === null
    : result.outline.length >= 3, '編輯檔的外框與描圖步驟不一致。');
  requireValue(result.mode !== null || result.points.length === 0, '編輯檔尚有描點，但未指定描圖步驟。');
  if (result.calibration) {
    const [start, end] = result.calibration;
    requireValue(Math.hypot((end[0] - start[0]) * image.width, (end[1] - start[1]) * image.height) >=
      Math.max(2, Math.max(image.width, image.height) * 0.005), '編輯檔已套用的校正點距離太近。');
  }
  if (result.outline.length) {
    // Draft fields may be temporarily blank or invalid while typing. They do not
    // become links, measurements or trusted plans until the normal build action.
    const checked = buildTracedBuildingPlan({
      name: '描圖草稿', floorLabel: '1F', imageWidth: image.width, imageHeight: image.height,
      outline: result.outline,
      rooms: rooms.map(room => ({ ...room, name: '描圖房間' })),
      source: { label: '圖片描圖，待核對' },
    }, scope);
    requireValue(checked.ok, checked.ok ? '' : checked.message);
  }
  return result;
}

function requireByteLimit(value: string, limit: number, message: string) {
  requireValue(value.length <= limit && new TextEncoder().encode(value).byteLength <= limit, message);
}

function requireMetadataLimit(value: unknown) {
  requireByteLimit(JSON.stringify(value), MAX_BUILDING_PLAN_BYTES, '編輯檔的描點與文字資料超過 256 KB。');
}

function imageSize(size: number) {
  requireValue(Number.isSafeInteger(size) && size > 0 && size <= MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES,
    '編輯檔底圖超過 10 MiB 或沒有圖片內容，請先縮小圖片；目前草稿仍保留。');
}

function validatePngHeader(bytes: Uint8Array, metadata: ReferenceMetadata) {
  imageSize(bytes.byteLength);
  requireValue(bytes.length >= 33 && PNG_SIGNATURE.every((value, index) => bytes[index] === value) &&
    bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82,
  '編輯檔底圖必須是 PNG 圖片。');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireValue(header.getUint32(8) === 13 && header.getUint32(16) === metadata.width && header.getUint32(20) === metadata.height,
    '編輯檔記錄的底圖尺寸與 PNG 不一致，請使用完整的原始編輯檔。');
}

async function sanitizeReference(bytes: Uint8Array<ArrayBuffer>, metadata: ReferenceMetadata, signal: AbortSignal): Promise<BuildingPlanProjectReference> {
  requireActive(signal);
  validatePngHeader(bytes, metadata);
  // A project is an untrusted local file too: re-run the existing decoder and
  // PNG encoder before any imported pixels are displayed.
  const prepared = await prepareBuildingPlanReference(new File([bytes], metadata.name, { type: 'image/png' }), signal);
  requireActive(signal);
  requireValue(prepared.width === metadata.width && prepared.height === metadata.height,
    '解碼後的底圖尺寸與編輯檔不一致。');
  imageSize(prepared.blob.size);
  requireValue(prepared.blob.type === 'image/png', '無法準備編輯檔的 PNG 底圖。');
  return { blob: prepared.blob, width: prepared.width, height: prepared.height, name: metadata.name };
}

function base64Encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  return btoa(chunks.join(''));
}

function base64Decode(value: unknown): Uint8Array<ArrayBuffer> {
  requireValue(typeof value === 'string' && value.length > 0 &&
    value.length <= 4 * Math.ceil(MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES / 3) &&
    value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), '編輯檔底圖的 Base64 格式不正確或超過 10 MiB。');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  imageSize(value.length / 4 * 3 - padding);
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('編輯檔底圖的 Base64 格式不正確。'); }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Capture a stable snapshot before awaiting image work. No object URLs or writes. */
export async function exportBuildingPlanProject(
  scope: BuildingPlanScope,
  draft: BuildingPlanProjectDraft,
  reference: BuildingPlanProjectReference,
  signal?: AbortSignal,
): Promise<Blob> {
  const activeSignal = signal ?? new AbortController().signal;
  requireActive(activeSignal);
  const target = scopeSnapshot(scope);
  const metadata = referenceMetadata(reference);
  const snapshot = draftSnapshot(draft, metadata, target);
  const original = reference.blob;
  requireValue(original?.type === 'image/png', '編輯檔只能保存已處理的 PNG 底圖。');
  imageSize(original.size);
  const envelope = { format: FORMAT, version: 1, ...target, draft: snapshot,
    reference: { mime: 'image/png', ...metadata } };
  requireMetadataLimit(envelope);
  const bytes = new Uint8Array(await original.arrayBuffer());
  requireActive(activeSignal);
  const prepared = await sanitizeReference(bytes, metadata, activeSignal);
  const encodedBytes = new Uint8Array(await prepared.blob.arrayBuffer());
  requireActive(activeSignal);
  validatePngHeader(encodedBytes, metadata);
  const result = new Blob([JSON.stringify({ ...envelope, reference: { ...envelope.reference, base64: base64Encode(encodedBytes) } })],
    { type: 'application/json' });
  requireValue(result.size <= MAX_BUILDING_PLAN_PROJECT_BYTES, '編輯檔超過 16 MiB，請縮小底圖後再下載；目前草稿仍保留。');
  requireActive(activeSignal);
  return result;
}

/** Validate size and scope before image decoding; the caller replaces state only on success. */
export async function importBuildingPlanProject(
  file: File,
  scope: BuildingPlanScope,
  signal?: AbortSignal,
): Promise<{ draft: BuildingPlanProjectDraft; reference: BuildingPlanProjectReference }> {
  const activeSignal = signal ?? new AbortController().signal;
  requireActive(activeSignal);
  const target = scopeSnapshot(scope);
  requireValue(/\.json$/i.test(file.name), '請選擇 .json 編輯檔。');
  requireValue(file.size > 0 && file.size <= MAX_BUILDING_PLAN_PROJECT_BYTES, '編輯檔不可超過 16 MiB。');
  const content = await file.text();
  requireActive(activeSignal);
  requireByteLimit(content, MAX_BUILDING_PLAN_PROJECT_BYTES, '編輯檔不可超過 16 MiB。');
  let decoded: unknown;
  try { decoded = JSON.parse(content); } catch { throw new Error('無法讀取 JSON 編輯檔，請檢查檔案是否完整。'); }
  const input = record(decoded);
  requireValue(input.format === FORMAT && input.version === 1, '請使用第 1 版 nuni 圖面編輯檔；一般圖面 JSON 不含可編輯底圖。');
  requireValue(input.schoolId === target.schoolId && input.buildingId === target.buildingId,
    '這份編輯檔不屬於目前學校或建築，請確認後重新開啟。');
  const rawReference = record(input.reference);
  // Extra fields are never restored; they still count against metadata limits.
  requireMetadataLimit({ ...input, reference: { ...rawReference, base64: '' } });
  requireValue(rawReference.mime === 'image/png', '編輯檔底圖必須是 PNG 圖片。');
  const metadata = referenceMetadata(rawReference);
  const draft = draftSnapshot(input.draft, metadata, target);
  const bytes = base64Decode(rawReference.base64);
  requireActive(activeSignal);
  const reference = await sanitizeReference(bytes, metadata, activeSignal);
  requireActive(activeSignal);
  return { draft, reference };
}
