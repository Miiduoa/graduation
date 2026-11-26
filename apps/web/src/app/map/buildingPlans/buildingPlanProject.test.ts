import { Blob as RuntimeBlob, File as RuntimeFile } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareBuildingPlanReference } from './buildingPlanReference';
import {
  exportBuildingPlanProject, importBuildingPlanProject,
  MAX_BUILDING_PLAN_PROJECT_BYTES, MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES,
  type BuildingPlanProjectDraft, type BuildingPlanProjectReference,
} from './buildingPlanProject';

vi.mock('./buildingPlanReference', () => ({ prepareBuildingPlanReference: vi.fn() }));

const scope = { schoolId: 'campus-a', buildingId: 'teaching-a' };

// A real transparent PNG. Browser decoding belongs to the shared image helper;
// these tests isolate the project envelope, its byte limits and async ownership.
function pngBytes(level = 6) {
  function chunk(kind: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(kind), data]);
    let crc = 0xffffffff;
    for (const value of body) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(body.length + 8);
    result.writeUInt32BE(data.length);
    body.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(600); header.writeUInt32BE(400, 4);
  header[8] = 8; header[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((600 * 4 + 1) * 400), { level })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const PNG = pngBytes();

function draft(): BuildingPlanProjectDraft {
  return {
    name: '教學樓草稿', floorLabel: '1F', sourceLabel: '待核對平面圖', sourceUrl: 'https://example.com/plan',
    outline: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    rooms: [{ id: 'traced-room-7', name: '教室 101', polygon: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.5], [0.2, 0.5]] }],
    mode: null, points: [], roomName: '', calibration: null,
    metres: '', floorHeight: '', x: '40', y: '50',
  };
}

function reference(): BuildingPlanProjectReference {
  return { blob: new Blob([PNG], { type: 'image/png' }), width: 600, height: 400, name: 'floor-plan.png' };
}

function envelope(state = draft()) {
  return {
    format: 'nuni.building-plan-project', version: 1, ...scope, draft: state,
    reference: { mime: 'image/png', width: 600, height: 400, name: 'floor-plan.png', base64: Buffer.from(PNG).toString('base64') },
  };
}

function file(value: unknown) {
  return new File([JSON.stringify(value)], 'building-plan-project.json', { type: 'application/json' });
}

async function rejectBeforeDecode(value: unknown, message: RegExp) {
  await expect(importBuildingPlanProject(file(value), scope)).rejects.toThrow(message);
  expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubGlobal('Blob', RuntimeBlob);
  vi.stubGlobal('File', RuntimeFile);
  vi.mocked(prepareBuildingPlanReference).mockReset();
  vi.mocked(prepareBuildingPlanReference).mockImplementation(async input => ({
    blob: new Blob([await input.arrayBuffer()], { type: 'image/png' }),
    width: 600, height: 400, name: input.name,
  }));
  vi.spyOn(URL, 'createObjectURL');
  vi.spyOn(URL, 'revokeObjectURL');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('editable building project round trips', () => {
  it('restores the PNG, exact normalized points, text and original room identities without creating URLs', async () => {
    const state = draft();
    const image = reference();
    const blob = await exportBuildingPlanProject(scope, state, image);
    expect(blob.type).toBe('application/json');
    const encoded = JSON.parse(await blob.text());
    expect(encoded).toMatchObject({ format: 'nuni.building-plan-project', version: 1, ...scope, draft: state });
    expect(encoded.reference).toEqual({ mime: 'image/png', width: 600, height: 400, name: image.name, base64: Buffer.from(PNG).toString('base64') });
    const restored = await importBuildingPlanProject(new File([blob], 'building-plan-project.json'), scope);
    expect(restored.draft).toEqual(state);
    expect(restored.reference).toMatchObject({ width: 600, height: 400, name: image.name });
    expect(restored.reference.blob).not.toBe(image.blob);
    expect(new Uint8Array(await restored.reference.blob.arrayBuffer())).toEqual(PNG);
    expect(prepareBuildingPlanReference).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('preserves an unfinished two-point outline and temporarily incomplete text and number inputs', async () => {
    const state: BuildingPlanProjectDraft = {
      ...draft(), name: '', floorLabel: '', sourceLabel: '', sourceUrl: 'https://unfinished',
      outline: [], rooms: [], mode: 'outline', points: [[0.11, 0.25], [0.72, 0.25]],
      roomName: '未完成', metres: '-', floorHeight: '', x: '', y: '1e',
    };
    const blob = await exportBuildingPlanProject(scope, state, reference());
    expect((await importBuildingPlanProject(new File([blob], 'draft.json'), scope)).draft).toEqual(state);
  });

  it('preserves an unfinished crossing room so the user can undo and repair it', async () => {
    const state: BuildingPlanProjectDraft = { ...draft(), mode: 'room', roomName: '',
      points: [[0.2, 0.2], [0.7, 0.7], [0.2, 0.7], [0.7, 0.2]] };
    expect((await importBuildingPlanProject(file(envelope(state)), scope)).draft).toEqual(state);
  });

  it('preserves unfinished calibration input and applied points without treating the strings as trusted metres', async () => {
    const state: BuildingPlanProjectDraft = { ...draft(), mode: 'calibration',
      calibration: [[0.1, 0.1], [0.9, 0.1]], points: [[0.2, 0.2]],
      metres: '', floorHeight: '-', sourceUrl: 'javascript:unfinished-input' };
    state.rooms[0].name = '';
    const restored = await importBuildingPlanProject(file(envelope(state)), scope);
    expect(restored.draft).toEqual(state);
    expect(restored.draft).not.toHaveProperty('plan');
  });

  it('saves re-encoded image bytes rather than embedding the supplied original bytes', async () => {
    const safeBytes = pngBytes(9);
    const safe = { ...reference(), blob: new Blob([safeBytes], { type: 'image/png' }) };
    vi.mocked(prepareBuildingPlanReference).mockResolvedValue(safe);
    const output = JSON.parse(await (await exportBuildingPlanProject(scope, draft(), reference())).text());
    expect(output.reference.base64).toBe(Buffer.from(safeBytes).toString('base64'));
    expect(output.reference.base64).not.toBe(Buffer.from(PNG).toString('base64'));
  });

  it('strips unknown identity, verification, route and image URL fields from every restored object', async () => {
    const input = envelope();
    Object.assign(input, { owner: 'other-account', verified: true, plan: { units: 'm' } });
    Object.assign(input.draft, { verified: true, navigationHref: '/trusted-route' });
    Object.assign(input.draft.rooms[0], { poiId: 'official-poi', verified: true });
    Object.assign(input.reference, { url: 'https://example.com/remote-image', trusted: true });
    const restored = await importBuildingPlanProject(file(input), scope);
    expect(Object.keys(restored)).toEqual(['draft', 'reference']);
    expect(restored.draft).toEqual(draft());
    expect(Object.keys(restored.reference).sort()).toEqual(['blob', 'height', 'name', 'width']);
  });

  it('canonicalizes non-editable room IDs on export and import without trimming editable text', async () => {
    const state = draft();
    state.rooms[0].id = ' traced-room-1 ';
    state.rooms[0].name = ' 教室 101 ';
    state.sourceLabel = ' 待核對 ';
    state.metres = ' 12 ';
    const expected = { ...state, rooms: [{ ...state.rooms[0], id: 'traced-room-1' }] };
    const encoded = JSON.parse(await (await exportBuildingPlanProject(scope, state, reference())).text());
    expect(encoded.draft).toEqual(expected);
    const restored = await importBuildingPlanProject(file(envelope(state)), scope);
    expect(restored.draft).toEqual(expected);
    expect(state.rooms[0].id).toBe(' traced-room-1 ');
  });

  it('captures all draft coordinates and scope before export awaits image work', async () => {
    const state = draft();
    const before = structuredClone(state);
    const target = { ...scope };
    const image = reference();
    let finish!: (value: BuildingPlanProjectReference) => void;
    vi.mocked(prepareBuildingPlanReference).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = exportBuildingPlanProject(target, state, image);
    state.name = 'later edit'; state.outline[0][0] = 0.15; state.rooms[0].polygon[0][1] = 0.3;
    target.buildingId = 'other'; image.name = 'later.png'; image.width = 999;
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish(reference());
    const output = JSON.parse(await (await pending).text());
    expect(output.draft).toEqual(before);
    expect(output.buildingId).toBe(scope.buildingId);
    expect(output.reference).toMatchObject({ name: 'floor-plan.png', width: 600 });
  });
});

describe('project import trust boundary before decoding', () => {
  it.each(['schoolId', 'buildingId'] as const)('rejects a different %s before even inspecting bad image bytes', async field => {
    const input = envelope(); input[field] = 'another'; input.reference.base64 = 'invalid';
    await rejectBeforeDecode(input, /不屬於目前學校或建築/);
  });

  it.each([{ format: 'other' }, { version: 2 }, { format: undefined }])('rejects unsupported envelope metadata %j', async changes => {
    await rejectBeforeDecode({ ...envelope(), ...changes }, /第 1 版/);
  });

  it('rejects malformed JSON without decoding or creating an image URL', async () => {
    await expect(importBuildingPlanProject(new File(['{"draft":'], 'draft.json'), scope)).rejects.toThrow(/JSON/);
    expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects a file over 16 MiB before reading it', async () => {
    const input = file(envelope());
    Object.defineProperty(input, 'size', { value: MAX_BUILDING_PLAN_PROJECT_BYTES + 1 });
    const read = vi.spyOn(input, 'text');
    await expect(importBuildingPlanProject(input, scope)).rejects.toThrow(/16 MiB/);
    expect(read).not.toHaveBeenCalled();
    expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  });

  it('counts UTF-8 metadata bytes, including unknown fields, before image decoding', async () => {
    await rejectBeforeDecode({ ...envelope(), extra: '圖'.repeat(86_000) }, /256 KB/);
  });

  it.each(['image/svg+xml', 'image/jpeg', 'text/html'])('rejects reference MIME %s', async mime => {
    const input = envelope(); input.reference.mime = mime;
    await rejectBeforeDecode(input, /PNG/);
  });

  it.each(['data:image/png;base64,AAAA', 'https://example.com/plan.png', 'AA A', 'AAAA===', '!!!!'])
  ('rejects non-base64 image payload %s', async base64 => {
    const input = envelope(); input.reference.base64 = base64;
    await rejectBeforeDecode(input, /Base64/);
  });

  it('rejects image payloads over 10 MiB before allocating decoded image bytes', async () => {
    const input = envelope();
    input.reference.base64 = 'A'.repeat(4 * Math.ceil(MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES / 3) + 4);
    await rejectBeforeDecode(input, /10 MiB/);
  });

  it('rejects HTML disguised as PNG from its decoded header', async () => {
    const input = envelope(); input.reference.base64 = btoa('<html><script>not an image</script></html>');
    await rejectBeforeDecode(input, /PNG/);
  });

  it('rejects a PNG whose actual header disagrees with the project dimensions', async () => {
    const input = envelope(); input.reference.width = 599;
    await rejectBeforeDecode(input, /尺寸與 PNG 不一致/);
  });

  it.each([0, 2049, 1.5, Infinity])('rejects unusable dimensions %s', async width => {
    const input = envelope(); input.reference.width = width;
    await rejectBeforeDecode(input, /2048 像素/);
  });

  it('also rejects dimensions that disagree after the actual image decoder runs', async () => {
    vi.mocked(prepareBuildingPlanReference).mockResolvedValue({ ...reference(), width: 601 });
    await expect(importBuildingPlanProject(file(envelope()), scope)).rejects.toThrow(/解碼後的底圖尺寸/);
  });

  it('propagates a real decoder failure without returning a partial project', async () => {
    vi.mocked(prepareBuildingPlanReference).mockRejectedValue(new Error('無法解碼圖片'));
    await expect(importBuildingPlanProject(file(envelope()), scope)).rejects.toThrow(/無法解碼圖片/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('editable state bounds and completed geometry', () => {
  it.each([-0.01, 1.01, NaN, Infinity])('rejects invalid pending coordinates %s', async x => {
    const state = { ...draft(), mode: 'room' as const, points: [[x, 0.2]] as [number, number][] };
    await rejectBeforeDecode(envelope(state), /0 到 1/);
  });

  it('rejects sparse point arrays supplied to the exporter before it awaits the image', async () => {
    const state = { ...draft(), mode: 'room' as const, points: [new Array(2) as [number, number]] };
    await expect(exportBuildingPlanProject(scope, state, reference())).rejects.toThrow(/0 到 1/);
    expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  });

  it('rejects completed self-crossing geometry while permitting pending edits elsewhere', async () => {
    const state = draft();
    state.rooms[0].polygon = [[0.2, 0.2], [0.8, 0.7], [0.2, 0.8], [0.6, 0.2]];
    await rejectBeforeDecode(envelope(state), /邊線互相交錯/);
  });

  it('rejects a completed room outside the outline', async () => {
    const state = draft(); state.rooms[0].polygon[0] = [0, 0];
    await rejectBeforeDecode(envelope(state), /超出樓層外框/);
  });

  it('rejects duplicate normalized room identities', async () => {
    const state = draft(); state.rooms.push({ ...state.rooms[0], id: ` ${state.rooms[0].id} ` });
    await rejectBeforeDecode(envelope(state), /房間代碼不可重複/);
  });

  it('enforces room and pending-point limits before image work', async () => {
    const manyRooms = draft();
    manyRooms.rooms = Array.from({ length: 201 }, (_, index) => ({ ...manyRooms.rooms[0], id: `room-${index}` }));
    await rejectBeforeDecode(envelope(manyRooms), /200/);
    const manyPoints = { ...draft(), mode: 'room' as const, points: Array.from({ length: 65 }, () => [0.2, 0.2] as [number, number]) };
    await rejectBeforeDecode(envelope(manyPoints), /64/);
  });

  it.each([
    { mode: 'outline', outline: draft().outline },
    { mode: 'room', outline: [] },
    { mode: null, points: [[0.2, 0.2]] },
    { mode: 'calibration', points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] },
    { mode: 'unknown' },
  ])('rejects an inconsistent editor mode %j', async changes => {
    await rejectBeforeDecode({ ...envelope(), draft: { ...draft(), ...changes } }, /描圖步驟|描點數量|未指定描圖/);
  });

  it('rejects an already applied calibration with no usable length', async () => {
    const state = draft(); state.calibration = [[0.1, 0.1], [0.1, 0.1]];
    await rejectBeforeDecode(envelope(state), /校正點距離太近/);
  });

  it.each(['name', 'floorLabel', 'roomName'] as const)('bounds editable text %s without requiring nonblank values', async field => {
    await rejectBeforeDecode({ ...envelope(), draft: { ...draft(), [field]: 'x'.repeat(101) } }, /100 字/);
  });
});

describe('project cancellation and failed exports', () => {
  it('keeps the original draft when image processing fails', async () => {
    const state = draft(), before = structuredClone(state);
    vi.mocked(prepareBuildingPlanReference).mockRejectedValue(new Error('decode failed'));
    await expect(exportBuildingPlanProject(scope, state, reference())).rejects.toThrow('decode failed');
    expect(state).toEqual(before);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects an oversized re-encoded PNG clearly instead of emitting a project that cannot reopen', async () => {
    const safe = reference();
    Object.defineProperty(safe.blob, 'size', { value: MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES + 1 });
    vi.mocked(prepareBuildingPlanReference).mockResolvedValue(safe);
    await expect(exportBuildingPlanProject(scope, draft(), reference())).rejects.toThrow(/10 MiB.*目前草稿仍保留/);
  });

  it('rejects an oversized supplied PNG before decoding', async () => {
    const image = reference();
    Object.defineProperty(image.blob, 'size', { value: MAX_BUILDING_PLAN_PROJECT_IMAGE_BYTES + 1 });
    await expect(exportBuildingPlanProject(scope, draft(), image)).rejects.toThrow(/10 MiB/);
    expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  });

  it('does not read files or decode images when already cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const input = file(envelope()), read = vi.spyOn(input, 'text');
    await expect(importBuildingPlanProject(input, scope, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(exportBuildingPlanProject(scope, draft(), reference(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
    expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  });

  it('discards a file read that finishes after cancellation before any image decode', async () => {
    let finish!: (text: string) => void;
    const input = file(envelope());
    vi.spyOn(input, 'text').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = importBuildingPlanProject(input, scope, controller.signal);
    controller.abort(); finish(JSON.stringify(envelope()));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  });

  it.each(['import', 'export'] as const)('discards %s image processing that completes after cancellation', async action => {
    let finish!: (value: BuildingPlanProjectReference) => void;
    vi.mocked(prepareBuildingPlanReference).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = action === 'import'
      ? importBuildingPlanProject(file(envelope()), scope, controller.signal)
      : exportBuildingPlanProject(scope, draft(), reference(), controller.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort(); finish(reference());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
