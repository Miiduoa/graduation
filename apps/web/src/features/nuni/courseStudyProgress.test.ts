// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { splitStudySection, studySourceFromDocument, studySourceFromText, type TutorExplanation } from '@/lib/studyTutor';
import { appendStudyLesson, emptyStudyPassage, studyLessonHistory, type StudyModeMemory } from './courseStudySession';
import {
  COURSE_STUDY_PROGRESS_LIMITS,
  courseStudyProgressFilename,
  exceedsStudyBackupByteLimit,
  parseCourseStudyProgress,
  serializeCourseStudyProgress,
  type CourseStudyProgressData,
  type CourseStudyProgressScope,
} from './courseStudyProgress';

const scope: CourseStudyProgressScope = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  workspaceId: 'cw_22222222-2222-4222-8222-222222222222',
};
const sourceText = '主鍵用來唯一識別一筆資料，不能重複或為空值。';
const response = {
  title: '辨認一筆資料', explanation: '主鍵像是每位學生的學號。', sourceQuote: '主鍵用來唯一識別一筆資料',
  question: '兩位學生可以共用主鍵嗎？', answer: '參考回答：不可以。',
};

function data(): CourseStudyProgressData {
  const memory = appendStudyLesson(emptyStudyPassage(), 'understand', { question: '用學號說明', response });
  memory.note = '我的例子 😀\r\n第二行保留空白  ';
  memory.needsReview = true;
  memory.modes.understand.question = '還沒送出的追問';
  return {
    scope: { ...scope },
    source: studySourceFromText({ id: 'material-1', title: '關聯式資料庫', text: sourceText }),
    position: { sectionIndex: 0, passageIndex: 0, mode: 'understand' },
    passages: { '0:0': memory },
  };
}

const formulaSourceText = '平均數等於總和除以筆數：μ = Σx / n。\r\n樣本有 n = 3 筆：1、2、3。';
function dataWithSteps(): CourseStudyProgressData {
  const saved = data();
  saved.source = studySourceFromText({ id: 'formula-material', title: '平均數', text: formulaSourceText });
  saved.passages['0:0'].modes.understand.lessons[0].response = {
    title: '看懂平均數', explanation: '先確認總和與筆數，再讀教材公式。',
    sourceQuote: '平均數等於總和除以筆數', question: '公式中的 n 代表什麼？', answer: '樣本筆數。',
    steps: [
      { title: '讀公式', explanation: 'μ 代表平均數；Σx 代表所有數值的總和。',
        sourceQuote: '平均數等於總和除以筆數：μ = Σx / n。', formula: 'μ = Σx / n' },
      { title: '確認筆數', explanation: '這裡列出三個數值，因此筆數是 3。', sourceQuote: '樣本有 n = 3 筆：1、2、3。' },
    ],
  };
  return saved;
}

type Envelope = CourseStudyProgressData & { format: string; version: number; passageLengths: number[][] };
const envelope = () => JSON.parse(serializeCourseStudyProgress(data())) as Envelope;
function changed(update: (value: Envelope) => void): string {
  const value = envelope();
  update(value);
  return JSON.stringify(value);
}
const mode = (value: Envelope): StudyModeMemory => value.passages['0:0'].modes.understand;

describe('portable study progress', () => {
  it('round-trips reading position, page labels, all modes, drafts, attempts and a pruned conversation branch', () => {
    const saved = data();
    saved.source = studySourceFromDocument({ format: 'pdf', name: '課堂講義.pdf', warnings: ['部分頁面為掃描頁'], sections: [
      { id: 'page-1', label: '第 1 頁', rows: [], needsOcr: true, warnings: [] },
      { id: 'page-3', label: '第 3 頁', rows: [{ line: 1, cells: [`${sourceText.padEnd(1600, '甲')}後續內容。`] }], needsOcr: false, warnings: ['文字需對照原檔'] },
      { id: 'page-7', label: '第 7 頁', rows: [{ line: 1, cells: ['交易具有原子性。'] }], needsOcr: false, warnings: [] },
    ] });
    let memory = saved.passages['0:0'];
    for (let id = 2; id <= 7; id += 1)
      memory = appendStudyLesson(memory, 'understand', { question: `追問 ${id}`, response: { ...response, title: `講解 ${id}` } }, id === 7 ? 3 : id - 1);
    memory.modes.understand.selectedLessonId = 3;
    memory.modes.understand.question = '下次繼續的草稿';
    memory.modes.understand.lessons[0].attempt = '我認為同一張表不能重複。';
    memory.modes.understand.lessons[0].answerVisible = true;
    memory.modes.understand.lessons[1].attempt = '還沒展開答案的試答';
    memory = appendStudyLesson(memory, 'exam', { question: '整理差異', response: { ...response, title: '考前重點' } });
    memory.modes.practice.question = '練習模式的未送出問題';
    saved.passages = {
      '1:0': { ...emptyStudyPassage(), note: '最後一頁的筆記' },
      '0:1': { ...emptyStudyPassage(), needsReview: true },
      '0:0': memory,
    };
    saved.position = { sectionIndex: 0, passageIndex: 1, mode: 'practice' };
    const before = JSON.stringify(saved);
    const serialized = serializeCourseStudyProgress(saved);
    const restored = parseCourseStudyProgress(serialized, scope);

    expect(restored).toEqual(saved);
    expect(restored).not.toBe(saved);
    expect(restored.passages['0:0'].modes.understand.lessons[0]).not.toBe(memory.modes.understand.lessons[0]);
    expect(Object.keys(restored.passages)).toEqual(['0:0', '0:1', '1:0']);
    expect(restored.source.sections.map((section) => section.label)).toEqual(['第 3 頁', '第 7 頁']);
    expect(restored.source.warnings.some((warning) => warning.includes('第 1 頁'))).toBe(true);
    expect(studyLessonHistory(restored.passages['0:0'].modes.understand, 7).map((turn) => turn.response.title)).toEqual(['講解 3', '講解 7']);
    expect(restored.passages['0:0'].modes.understand.lessons[0].previousLessonId).toBe(1);
    expect(JSON.parse(serialized).version).toBe(2);
    expect(JSON.parse(serialized).passageLengths).toEqual([[1600, '後續內容。'.length], ['交易具有原子性。'.length]]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('saves hidden reference text for later use without revealing it in the restored state', () => {
    const saved = data();
    saved.passages['0:0'].modes.understand.lessons[0].attempt = '我的試答';
    const serialized = serializeCourseStudyProgress(saved);
    const restored = parseCourseStudyProgress(serialized, scope);
    expect(serialized).toContain(response.answer);
    expect(restored.passages['0:0'].modes.understand.lessons[0].answerVisible).toBe(false);
    expect(restored.passages['0:0'].modes.understand.question).toBe('還沒送出的追問');
  });

  it('can save a reading position before any AI or personal notes exist, including a blank passage', () => {
    const saved = data();
    saved.source = studySourceFromText({ id: 'pasted', title: '空白邊界', text: `${' '.repeat(1600)}最後一句。` });
    saved.passages = {};
    const restored = parseCourseStudyProgress(serializeCourseStudyProgress(saved), scope);
    expect(restored.passages).toEqual({});
    expect(restored.position).toEqual(saved.position);
    expect(splitStudySection(restored.source.sections[0])[0].text).toBe(' '.repeat(1600));
  });

  it('accepts a UTF-8 BOM without changing stored Unicode or multiline text', () => {
    const saved = data();
    saved.passages['0:0'].note = '  α＋β 😀\n<img src=x onerror=alert(1)>  ';
    const restored = parseCourseStudyProgress(`\uFEFF${serializeCourseStudyProgress(saved)}`, scope);
    expect(restored).toEqual(saved);
  });

  it.each([
    { ...scope, platformAccountId: 'another-account' },
    { ...scope, workspaceId: 'another-course' },
  ])('rejects files from another currently selected account or course (%#)', (expected) => {
    expect(() => parseCourseStudyProgress(serializeCourseStudyProgress(data()), expected)).toThrow(/帳號或課程與目前不同/);
  });

  it.each([undefined, null, {}, { platformAccountId: '', workspaceId: scope.workspaceId }])('requires a complete current scope (%#)', (expected) => {
    expect(() => parseCourseStudyProgress(serializeCourseStudyProgress(data()), expected as CourseStudyProgressScope)).toThrow();
  });

  it.each([0, 3, -1, 1.5, '1', '2', null])('rejects unsupported versions without inventing a migration (%s)', (version) => {
    expect(() => parseCourseStudyProgress(changed((value) => Reflect.set(value, 'version', version)), scope)).toThrow(/版本/);
  });

  it.each(['', ' ', 'not json', '{', 'https://example.test/private.json', '{"format":"other-app","version":1}'])('rejects empty, malformed and unrelated files (%#)', (raw) => {
    expect(() => parseCourseStudyProgress(raw, scope)).toThrow();
  });

  it('never serializes an accidental session token or accepts unknown metadata fields', () => {
    const saved = data();
    Reflect.set(saved, 'sessionContext', 'private-session-token');
    expect(() => serializeCourseStudyProgress(saved)).toThrow();
    expect(() => parseCourseStudyProgress(changed((value) => Reflect.set(value.scope, 'token', 'private-token')), scope)).toThrow();
    expect(() => parseCourseStudyProgress(changed((value) => Reflect.set(value, 'session', { token: 'private-token' })), scope)).toThrow();
    expect(serializeCourseStudyProgress(data())).not.toMatch(/sessionContext|token|revision/);
  });
});

describe('study progress format compatibility', () => {
  it('restores an original five-field v1 file and saves it as v2 without inventing steps or changing hidden answers', () => {
    const saved = data();
    saved.passages['0:0'].modes.understand.lessons[0].attempt = '保留還沒展開答案的試答';
    // Construct the legacy envelope independently of the current writer.
    const legacy = JSON.stringify({
      format: 'campus-one-study-progress', version: 1, ...saved, passageLengths: [[sourceText.length]],
    });
    const restored = parseCourseStudyProgress(legacy, scope);
    expect(restored).toEqual(saved);
    expect(restored.passages['0:0'].modes.understand.lessons[0].response).not.toHaveProperty('steps');
    expect(restored.passages['0:0'].modes.understand.lessons[0].answerVisible).toBe(false);
    const upgraded = serializeCourseStudyProgress(restored);
    expect(JSON.parse(upgraded).version).toBe(2);
    expect(parseCourseStudyProgress(upgraded, scope)).toEqual(saved);
  });

  it('round-trips every step, its exact formula and quote in v2 without changing lesson branches or reveal state', () => {
    const saved = dataWithSteps();
    const original = saved.passages['0:0'].modes.understand.lessons[0];
    saved.passages['0:0'] = appendStudyLesson(saved.passages['0:0'], 'understand', {
      question: '再說明筆數', response: { ...original.response, title: '回到樣本筆數' },
    }, original.id);
    const memory = saved.passages['0:0'].modes.understand;
    memory.lessons[0].attempt = '我的第一個想法';
    memory.lessons[0].answerVisible = true;
    memory.lessons[1].attempt = '第二個尚未展開答案的想法';
    memory.selectedLessonId = 1;
    const before = JSON.stringify(saved);
    const serialized = serializeCourseStudyProgress(saved);
    expect(JSON.parse(serialized).version).toBe(2);
    const restored = parseCourseStudyProgress(serialized, scope);
    expect(restored).toEqual(saved);
    const lessons = restored.passages['0:0'].modes.understand.lessons;
    expect(lessons[0].response.steps).not.toBe(original.response.steps);
    expect(lessons[0].response.steps?.[0].formula).toBe('μ = Σx / n');
    expect(lessons[0].response.steps?.[1]).not.toHaveProperty('formula');
    expect(lessons.map((lesson) => lesson.answerVisible)).toEqual([true, false]);
    expect(studyLessonHistory(restored.passages['0:0'].modes.understand, 2).map((turn) => turn.response.steps))
      .toEqual([original.response.steps, original.response.steps]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('rejects steps injected into a v1 file even when their quotes and formula are valid', () => {
    const value = JSON.parse(serializeCourseStudyProgress(dataWithSteps())) as Envelope;
    value.version = 1;
    expect(() => parseCourseStudyProgress(JSON.stringify(value), scope)).toThrow(/無法對照該段原文/);
  });

  it.each([
    ['too few steps', (value: TutorExplanation) => { value.steps!.pop(); }],
    ['too many steps', (value: TutorExplanation) => { value.steps = Array.from({ length: 5 }, () => ({ ...value.steps![0] })); }],
    ['non-array steps', (value: TutorExplanation) => { Reflect.set(value, 'steps', {}); }],
    ['missing quote', (value: TutorExplanation) => { Reflect.deleteProperty(value.steps![0], 'sourceQuote'); }],
    ['quote outside this passage', (value: TutorExplanation) => { value.steps![0].sourceQuote = '另一段原文'; }],
    ['formula only in another step', (value: TutorExplanation) => { value.steps![0].formula = 'n = 3'; }],
    ['invented formula', (value: TutorExplanation) => { value.steps![0].formula = 'μ = 2'; }],
    ['non-string formula', (value: TutorExplanation) => { Reflect.set(value.steps![0], 'formula', 3); }],
    ['unknown step field', (value: TutorExplanation) => { Reflect.set(value.steps![0], 'tool', 'run-code'); }],
  ] as const)('rejects %s when importing and saving v2', (_label, update) => {
    const saved = dataWithSteps();
    update(saved.passages['0:0'].modes.understand.lessons[0].response);
    const raw = JSON.stringify({
      format: 'campus-one-study-progress', version: 2, ...saved, passageLengths: [[formulaSourceText.length]],
    });
    expect(() => parseCourseStudyProgress(raw, scope)).toThrow(/無法對照該段原文/);
    expect(() => serializeCourseStudyProgress(saved)).toThrow(/無法對照該段原文/);
  });
});

describe('source and passage integrity', () => {
  it('rejects notes for missing passages and prototype-shaped keys without polluting objects', () => {
    for (const key of ['0:9', '01:0', '2:0', '__proto__', 'constructor']) {
      const raw = changed((value) => Object.defineProperty(value.passages, key, { value: { polluted: true }, enumerable: true }));
      expect(() => parseCourseStudyProgress(raw, scope)).toThrow(/段落/);
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    }
    const inherited = data();
    inherited.passages = Object.create({ '0:0': emptyStudyPassage() });
    expect(() => serializeCourseStudyProgress(inherited)).toThrow();
  });

  it.each([
    (value: Envelope) => { value.source.sections = []; },
    (value: Envelope) => { value.source.sections[0].text = ' \n '; },
    (value: Envelope) => { value.source.sections[0].label = ''; },
    (value: Envelope) => { value.source.sections.push({ ...value.source.sections[0] }); },
    (value: Envelope) => { value.source.warnings = ['警'.repeat(COURSE_STUDY_PROGRESS_LIMITS.warningCharacters + 1)]; },
    (value: Envelope) => { value.source.sections = Array.from({ length: 21 }, (_, index) => ({ id: `page-${index}`, label: `第 ${index + 1} 頁`, text: '原文' })); },
    (value: Envelope) => { value.source.sections[0].text = '字'.repeat(60001); },
    (value: Envelope) => { value.source.sections = [{ id: 'a', label: '一', text: '甲'.repeat(30000) }, { id: 'b', label: '二', text: '乙'.repeat(30001) }]; },
  ])('rejects invalid or oversized source structure (%#)', (update) => {
    expect(() => parseCourseStudyProgress(changed(update), scope)).toThrow();
  });

  it('accepts the existing twenty-page and total sixty-thousand-character bounds', () => {
    const saved = data();
    saved.source.sections = Array.from({ length: 20 }, (_, index) => ({ id: `page-${index}`, label: `第 ${index + 1} 頁`, text: '字'.repeat(3000) }));
    saved.passages = {};
    expect(parseCourseStudyProgress(serializeCourseStudyProgress(saved), scope).source.sections).toHaveLength(20);
  });

  it.each([
    (value: Envelope) => { value.position.sectionIndex = 1; },
    (value: Envelope) => { value.position.sectionIndex = -1; },
    (value: Envelope) => { value.position.passageIndex = 1; },
    (value: Envelope) => { value.position.passageIndex = 0.5; },
    (value: Envelope) => { value.position.passageIndex = Number.MAX_SAFE_INTEGER; },
    (value: Envelope) => { Reflect.set(value.position, 'mode', 'admin'); },
  ])('rejects an invalid reading position instead of silently clamping it (%#)', (update) => {
    expect(() => parseCourseStudyProgress(changed(update), scope)).toThrow();
  });

  it.each([
    (value: Envelope) => { value.passageLengths[0][0] -= 1; },
    (value: Envelope) => { value.passageLengths[0].push(1); },
    (value: Envelope) => { value.passageLengths = []; },
    (value: Envelope) => { Reflect.set(value, 'passageLengths', null); },
    (value: Envelope) => { Reflect.deleteProperty(value, 'passageLengths'); },
  ])('rejects mismatched boundaries before attaching notes to a different segment (%#)', (update) => {
    expect(() => parseCourseStudyProgress(changed(update), scope)).toThrow();
  });

  it('revalidates every saved explanation against its own passage, not a quote found on another page', () => {
    const raw = changed((value) => {
      value.source.sections.push({ id: 'page-9', label: '第 9 頁', text: '這個句子只存在另一頁。' });
      value.passageLengths.push(['這個句子只存在另一頁。'.length]);
      mode(value).lessons[0].response.sourceQuote = '這個句子只存在另一頁。';
    });
    expect(() => parseCourseStudyProgress(raw, scope)).toThrow(/無法對照該段原文/);
    expect(() => parseCourseStudyProgress(changed((value) => Reflect.set(mode(value).lessons[0].response, 'tool', 'run-code')), scope)).toThrow(/原文/);
  });
});

describe('lesson and draft validation', () => {
  it.each([
    (value: Envelope) => { value.passages['0:0'].note = '字'.repeat(2001); },
    (value: Envelope) => { mode(value).question = '字'.repeat(501); },
    (value: Envelope) => { mode(value).lessons[0].question = '字'.repeat(501); },
    (value: Envelope) => { mode(value).lessons[0].attempt = '字'.repeat(2001); },
    (value: Envelope) => { mode(value).lessons[0].answerVisible = true; },
    (value: Envelope) => { Reflect.set(value.passages['0:0'], 'needsReview', 'yes'); },
    (value: Envelope) => { Reflect.deleteProperty(value.passages['0:0'].modes, 'practice'); },
    (value: Envelope) => { Reflect.set(value.passages['0:0'].modes, 'other', emptyStudyPassage().modes.understand); },
    (value: Envelope) => { mode(value).lessons = Array.from({ length: 7 }, (_, index) => ({ ...mode(value).lessons[0], id: index + 1 })); },
  ])('rejects incomplete, inconsistent or excessive memory without truncating it (%#)', (update) => {
    expect(() => parseCourseStudyProgress(changed(update), scope)).toThrow();
  });

  it.each([
    (value: Envelope) => { mode(value).lessons[0].id = 0; },
    (value: Envelope) => { mode(value).lessons[0].id = 1.5; },
    (value: Envelope) => { mode(value).lessons[0].id = Number.MAX_SAFE_INTEGER; },
    (value: Envelope) => { mode(value).lessons[0].previousLessonId = 1; },
    (value: Envelope) => { mode(value).lessons[0].previousLessonId = 2; },
    (value: Envelope) => { mode(value).lessons[0].previousLessonId = 0; },
    (value: Envelope) => { mode(value).selectedLessonId = 2; },
    (value: Envelope) => { mode(value).selectedLessonId = null; },
    (value: Envelope) => { mode(value).lessons = []; },
    (value: Envelope) => { mode(value).lessons.push({ ...mode(value).lessons[0] }); },
  ])('rejects invalid lesson identity, cyclic or future ancestry, and missing selection (%#)', (update) => {
    expect(() => parseCourseStudyProgress(changed(update), scope)).toThrow();
  });

  it('allows an evicted ancestor but rejects a missing parent inside the retained range', () => {
    const retained = envelope();
    const base = mode(retained).lessons[0];
    mode(retained).lessons = [{ ...base, id: 4, previousLessonId: 2 }, { ...base, id: 6, previousLessonId: 4 }];
    mode(retained).selectedLessonId = 6;
    const restored = parseCourseStudyProgress(JSON.stringify(retained), scope);
    expect(studyLessonHistory(restored.passages['0:0'].modes.understand, 6)).toHaveLength(2);
    mode(retained).lessons[1].previousLessonId = 5;
    expect(() => parseCourseStudyProgress(JSON.stringify(retained), scope)).toThrow(/前後關係/);
  });

  it('accepts the bounded lesson identifier and rejects larger numbers before append could lose integer precision', () => {
    const retained = envelope();
    mode(retained).lessons[0].id = COURSE_STUDY_PROGRESS_LIMITS.lessonId;
    mode(retained).selectedLessonId = COURSE_STUDY_PROGRESS_LIMITS.lessonId;
    expect(parseCourseStudyProgress(JSON.stringify(retained), scope).passages['0:0'].modes.understand.selectedLessonId).toBe(COURSE_STUDY_PROGRESS_LIMITS.lessonId);
    mode(retained).lessons[0].id += 1;
    mode(retained).selectedLessonId! += 1;
    expect(() => parseCourseStudyProgress(JSON.stringify(retained), scope)).toThrow();
  });

  it('rejects sparse in-memory arrays when saving instead of writing unverifiable null entries', () => {
    const saved = data();
    saved.passages['0:0'].modes.understand.lessons.length = 2;
    expect(() => serializeCourseStudyProgress(saved)).toThrow();
  });
});

describe('size and filenames', () => {
  it('matches TextEncoder byte lengths for Chinese, emoji and isolated UTF-16 surrogates', () => {
    for (const input of [
      '', 'ASCII data', '資料庫', 'é', '€', '😀', '甲😀乙', '\u0000', '\ufeff',
      '\ud800', '\udc00', 'A\ud800B', '\ud800\ud800\udc00', '\ud83d\ude00\udc00',
    ]) {
      const actual = new TextEncoder().encode(input).byteLength;
      for (const limit of new Set([0, 1, 2, 3, 4, actual - 1, actual, actual + 1].filter((value) => value >= 0))) {
        expect(exceedsStudyBackupByteLimit(input, limit)).toBe(actual > limit);
      }
    }
  });

  it('accepts the exact 8 MiB boundary without allocating an 8 MiB encoded array', () => {
    const limit = COURSE_STUDY_PROGRESS_LIMITS.bytes;
    expect(exceedsStudyBackupByteLimit('a'.repeat(limit))).toBe(false);
    expect(exceedsStudyBackupByteLimit('a'.repeat(limit + 1))).toBe(true);
    expect(exceedsStudyBackupByteLimit('中'.repeat(Math.floor(limit / 3)))).toBe(false);
    expect(exceedsStudyBackupByteLimit('中'.repeat(Math.floor(limit / 3) + 1))).toBe(true);
    expect(exceedsStudyBackupByteLimit('😀'.repeat(limit / 4))).toBe(false);
    expect(exceedsStudyBackupByteLimit('😀'.repeat(limit / 4) + 'x')).toBe(true);
  });
  it('checks UTF-8 bytes, rather than only JavaScript string length, before parsing', () => {
    const tooLarge = '字'.repeat(Math.floor(COURSE_STUDY_PROGRESS_LIMITS.bytes / 3) + 1);
    expect(tooLarge.length).toBeLessThan(COURSE_STUDY_PROGRESS_LIMITS.bytes);
    expect(() => parseCourseStudyProgress(tooLarge, scope)).toThrow(/8 MiB/);
    expect(() => parseCourseStudyProgress('a'.repeat(COURSE_STUDY_PROGRESS_LIMITS.bytes + 1), scope)).toThrow(/8 MiB/);
  });

  it('accepts exactly the maximum byte size and rejects a backup that would exceed it', () => {
    const serialized = serializeCourseStudyProgress(data());
    const remaining = COURSE_STUDY_PROGRESS_LIMITS.bytes - Buffer.byteLength(serialized, 'utf8');
    const exact = `${' '.repeat(remaining)}${serialized}`;
    expect(Buffer.byteLength(exact, 'utf8')).toBe(COURSE_STUDY_PROGRESS_LIMITS.bytes);
    expect(parseCourseStudyProgress(exact, scope)).toEqual(data());
    const tooLarge = data();
    tooLarge.source.warnings = Array.from({ length: COURSE_STUDY_PROGRESS_LIMITS.warnings }, () => '警'.repeat(COURSE_STUDY_PROGRESS_LIMITS.warningCharacters));
    expect(() => serializeCourseStudyProgress(tooLarge)).toThrow(/8 MiB/);
  });

  it('produces a safe distinct JSON filename without splitting Unicode', () => {
    expect(courseStudyProgressFilename('../資料\\庫\u0000\n<>:"|?*\u202e\u2067.pdf')).toBe('資料 庫-閱讀進度.campus-study.json');
    expect(courseStudyProgressFilename('  ... ')).toBe('讀書白板-閱讀進度.campus-study.json');
    expect(courseStudyProgressFilename('課程.MD')).toBe('課程-閱讀進度.campus-study.json');
    expect(courseStudyProgressFilename('課程.MARKDOWN')).toBe('課程-閱讀進度.campus-study.json');
    expect(courseStudyProgressFilename('課程\\u2060.MARKDOWN')).toBe('課程-閱讀進度.campus-study.json');
    expect(courseStudyProgressFilename('👩‍💻.md')).toBe('👩‍💻-閱讀進度.campus-study.json');
    const name = courseStudyProgressFilename('😀'.repeat(150));
    expect(name).toBe(`${'😀'.repeat(48)}-閱讀進度.campus-study.json`);
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThan(255);
    expect(name).not.toMatch(/[\p{Cc}\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/u);
  });
});
