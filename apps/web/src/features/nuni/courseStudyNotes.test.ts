// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { studySourceFromDocument, studySourceFromText, type StudyMode, type StudySource } from '@/lib/studyTutor';
import { buildCourseStudyNotes, courseStudyNotesFilename } from './courseStudyNotes';
import { appendStudyLesson, emptyStudyPassage, type StudyPassageMemory } from './courseStudySession';

const source = studySourceFromText({ id: 'notes', title: '關聯式資料庫', text: '主鍵用來唯一識別資料。' });

function withLesson(mode: StudyMode = 'understand'): StudyPassageMemory {
  return appendStudyLesson(emptyStudyPassage(), mode, {
    question: '能用學號說明嗎？',
    response: {
      title: '唯一識別', explanation: '主鍵像是每位學生的學號。', sourceQuote: '主鍵用來唯一識別資料。',
      question: '兩位學生可以共用學號嗎？', answer: '參考解答秘密：不可以。',
    },
  });
}

describe('course study note downloads', () => {
  it('orders entries by real PDF pages and passages while excluding orphaned session keys', () => {
    const pdf: StudySource = studySourceFromDocument({
      format: 'pdf', name: '資料庫.pdf', warnings: [], sections: [
        { id: 'page-1', label: '第 1 頁', rows: [], needsOcr: true, warnings: [] },
        { id: 'page-3', label: '第 3 頁', rows: [{ line: 1, cells: ['主鍵用來唯一識別資料。'] }], needsOcr: false, warnings: [] },
        { id: 'page-7', label: '第 7 頁', rows: [{ line: 1, cells: [`${'甲'.repeat(1600)}最後一段。`] }], needsOcr: false, warnings: [] },
      ],
    });
    const memories = {
      '99:0': { ...emptyStudyPassage(), note: '舊來源的秘密筆記' },
      '1:1': { ...emptyStudyPassage(), note: '最後一段筆記' },
      '0:0': { ...emptyStudyPassage(), needsReview: true },
      '1:0': { ...emptyStudyPassage(), note: '中間一段筆記' },
      '0:9': withLesson(),
    };
    const before = JSON.stringify({ pdf, memories });
    const text = buildCourseStudyNotes('資料庫系統', pdf, memories);

    expect(text.startsWith('nuni 讀書白板・本次學習筆記\n')).toBe(true);
    expect(text).toContain('課程：資料庫系統\n講義：資料庫.pdf');
    expect(text).toContain('第 1 頁沒有可讀取的文字');
    const first = text.indexOf('第 3 頁 · 第 1 段');
    const middle = text.indexOf('第 7 頁 · 第 1 段');
    const last = text.indexOf('第 7 頁 · 第 2 段');
    expect(first).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(middle);
    expect(text).toContain('複習標記：待複習');
    expect(text).not.toContain('舊來源的秘密筆記');
    expect(text).not.toContain('主鍵像是每位學生的學號。');
    expect(text).not.toContain('第 2 頁 ·');
    expect(JSON.stringify({ pdf, memories })).toBe(before);
  });

  it('does not treat unsent questions or empty notes as completed learning', () => {
    const memory = emptyStudyPassage();
    memory.note = ' \n ';
    memory.modes.understand.question = '尚未送出的私人問題';
    const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
    expect(text).toContain('本次尚未留下筆記、待複習標記或 AI 講解。');
    expect(text).not.toContain('尚未送出的私人問題');
    expect(text).not.toContain('教材原文 · 第 1 段');
    expect(text).toContain('沒有標記不代表已學會');
    expect(text).toContain('非正式評分');
  });

  it('keeps mode-specific lessons, their actual questions, citations and attempts separate', () => {
    let memory = withLesson();
    memory.modes.understand.lessons[0].attempt = '我認為不能共用。';
    memory.modes.understand.question = '還沒送出的追問';
    memory = appendStudyLesson(memory, 'exam', {
      question: '幫我整理概念差異', response: { ...memory.modes.understand.lessons[0].response, title: '考前重點' },
    });
    memory = appendStudyLesson(memory, 'practice', {
      question: '', response: { ...memory.modes.understand.lessons[0].response, title: '先試著想一想' },
    });
    const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
    expect(text).toContain('理解概念・第 1 次講解\n我的問題：\n能用學號說明嗎？');
    expect(text).toContain('考前複習・第 1 次講解\n我的問題：\n幫我整理概念差異');
    expect(text).toContain('練習思路・第 1 次講解\n講解標題：先試著想一想');
    expect(text).toContain('引用原文：\n主鍵用來唯一識別資料。');
    expect(text).toContain('我的試答：\n我認為不能共用。');
    expect(text).not.toContain('還沒送出的追問');
    expect(text).not.toContain('參考解答秘密');
  });

  it.each([
    { attempt: '', visible: false, exported: false },
    { attempt: ' \n\t', visible: true, exported: false },
    { attempt: '我自己的答案', visible: false, exported: false },
    { attempt: '我自己的答案', visible: true, exported: true },
  ])('includes a reference answer only after an attempt and explicit reveal (%#)', ({ attempt, visible, exported }) => {
    for (const includeSteps of [false, true]) {
      const memory = withLesson();
      const lesson = memory.modes.understand.lessons[0];
      Object.assign(lesson, { attempt, answerVisible: visible });
      if (includeSteps) lesson.response.steps = [
        { title: '找主鍵', explanation: '辨認教材討論的對象。', sourceQuote: '主鍵' },
        { title: '確認用途', explanation: '用來分辨每一筆資料。', sourceQuote: '唯一識別資料' },
      ];
      const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(text.includes('參考解答秘密：不可以。')).toBe(exported);
      expect(text.includes('參考回答（已展開）：')).toBe(exported);
    }
  });

  it('exports all step titles, explanations, quotes and optional formulas in order as plain text', () => {
    const formulaSource = studySourceFromText({
      id: 'formula-notes', title: '公式與符號', text: '平均數公式：μ = Σx / n。\r\n比較符號 x < y 表示 x 小於 y。',
    });
    const memory = withLesson();
    memory.modes.understand.lessons[0].response = {
      title: '理解教材符號', explanation: '先讀公式，再辨認比較符號。',
      sourceQuote: '平均數公式：μ = Σx / n。', question: 'n 表示什麼？', answer: '尚未展開的公式參考答案',
      steps: [
        { title: '平均數', explanation: '把總和除以筆數。\n保留這行補充說明。',
          sourceQuote: '平均數公式：μ = Σx / n。', formula: 'μ = Σx / n' },
        { title: '比較符號', explanation: '小於符號依原文顯示；<img src=x> 仍是文字。',
          sourceQuote: '比較符號 x < y 表示 x 小於 y。', formula: 'x < y' },
        { title: '自己解釋', explanation: '請用自己的話解釋符號。', sourceQuote: 'x 小於 y' },
      ],
    };
    const before = JSON.stringify(memory);
    const text = buildCourseStudyNotes('統計', formulaSource, { '0:0': memory });
    expect(text).toContain('AI 講解：\n先讀公式，再辨認比較符號。');
    expect(text).toContain('分步講解：\n\n第 1 步：平均數\n本步講解：\n把總和除以筆數。\n保留這行補充說明。\n本步引用原文：\n平均數公式：μ = Σx / n。\n原文公式：\nμ = Σx / n');
    expect(text).toContain('第 2 步：比較符號\n本步講解：\n小於符號依原文顯示；<img src=x> 仍是文字。\n本步引用原文：\n比較符號 x < y 表示 x 小於 y。\n原文公式：\nx < y');
    expect(text).toContain('第 3 步：自己解釋\n本步講解：\n請用自己的話解釋符號。\n本步引用原文：\nx 小於 y\n\n自我檢查題：\nn 表示什麼？');
    expect(text.indexOf('第 2 步：')).toBeGreaterThan(text.indexOf('第 1 步：'));
    expect(text.indexOf('第 3 步：')).toBeGreaterThan(text.indexOf('第 2 步：'));
    expect(text.match(/原文公式：/g)).toHaveLength(2);
    expect(text).not.toContain('&lt;');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('尚未展開的公式參考答案');
    expect(JSON.stringify(memory)).toBe(before);
  });

  it('preserves Unicode, multiline notes and source text verbatim as plain text', () => {
    const note = '  我的例子：學號 😀\r\n第二行：α＋β\n<img src=x onerror=alert(1)>  ';
    const memory = { ...emptyStudyPassage(), note };
    const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
    expect(text).toContain(`我的筆記：\n${note}\n`);
    expect(text).toContain(`原文：\n${source.sections[0].text}\n`);
    expect(text).not.toContain('&lt;img');
    expect(text).not.toContain('複習標記：待複習');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('study note filenames', () => {
  it('uses a fixed text extension with no path, control or direction-spoofing characters', () => {
    const filename = courseStudyNotesFilename('../私密\\教材\u0000\n<>:"|?*\u202e\u2067.pdf');
    expect(filename).toBe('私密 教材-學習筆記.txt');
    expect(filename).not.toMatch(/[\p{Cc}\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/u);
    expect(courseStudyNotesFilename('  ..  ')).toBe('讀書白板-學習筆記.txt');
    expect(courseStudyNotesFilename('資料庫.MD')).toBe('資料庫-學習筆記.txt');
    expect(courseStudyNotesFilename('資料庫.MARKDOWN')).toBe('資料庫-學習筆記.txt');
  });

  it('keeps long Unicode filenames within a normal filesystem component without splitting emoji', () => {
    const filename = courseStudyNotesFilename('😀'.repeat(150));
    expect(filename).toBe(`${'😀'.repeat(48)}-學習筆記.txt`);
    expect(Buffer.byteLength(filename, 'utf8')).toBeLessThan(255);
  });
});
