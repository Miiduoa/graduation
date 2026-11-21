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

  it('keeps invisible-only note drafts out of TXT without losing review flags or source data', () => {
    for (const invisible of ['\u200b', '\u200d\u0301', '\u2800', ' \u2060\u2800 \n']) {
      const memory = { ...emptyStudyPassage(), note: invisible };
      const original = JSON.stringify(memory);
      const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(text).toContain('本次尚未留下筆記、待複習標記或 AI 講解。');
      expect(text).not.toContain('我的筆記：');
      expect(text).not.toContain('教材原文 · 第 1 段');
      expect(JSON.stringify(memory)).toBe(original);

      const flagged = { ...memory, needsReview: true };
      const flaggedText = buildCourseStudyNotes('資料庫', source, { '0:0': flagged });
      expect(flaggedText).toContain('複習標記：待複習');
      expect(flaggedText).not.toContain('我的筆記：');
      expect(flagged.note).toBe(invisible);
    }
    // Punctuation, accented words, mathematics and joined emoji are real notes.
    for (const visible of ['？', 'e\u0301', 'x²+y²', '👩‍💻', '⠃']) {
      const memory = { ...emptyStudyPassage(), note: visible };
      const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(text).toContain(`我的筆記：\n${visible}\n`);
      expect(text).toContain('教材原文 · 第 1 段');
    }
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

  it('keeps invalid invisible attempts from exposing saved reference answers in TXT exports', () => {
    for (const invisible of ['\u200b', '\u2060', '\u2800', '\u0301', ' \u2800\u200b ', '\u200d\ufe0f']) {
      const memory = withLesson();
      memory.modes.understand.lessons[0].attempt = invisible;
      memory.modes.understand.lessons[0].answerVisible = true;
      const exportText = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(exportText).not.toContain('參考解答秘密：不可以。');
      expect(exportText).not.toContain('參考回答（已展開）');
      expect(exportText).not.toContain('我的試答：');
      expect(memory.modes.understand.lessons[0].attempt).toBe(invisible);
    }
    for (const visible of ['主鍵', 'x²+y²', '👩‍💻', 'e\u0301', '⠃']) {
      const memory = withLesson();
      memory.modes.understand.lessons[0].attempt = visible;
      memory.modes.understand.lessons[0].answerVisible = true;
      const exportText = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(exportText).toContain('參考解答秘密：不可以。');
      expect(exportText).toContain(`我的試答：\n${visible}`);
    }
  });

  it('omits invisible-only saved lesson questions while preserving visible questions and the original session', () => {
    for (const question of ['\u200b', ' \u2060\u200d\u0301 ', '\u2800', '\u202e']) {
      const memory = withLesson();
      memory.modes.understand.lessons[0].question = question;
      const before = JSON.stringify(memory);
      const exportText = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(exportText).not.toContain('我的問題：');
      expect(exportText).toContain('講解標題：唯一識別');
      expect(exportText).toContain('引用原文：\n主鍵用來唯一識別資料。');
      expect(JSON.stringify(memory)).toBe(before);
    }
    for (const question of ['學號如何唯一？', 'e\u0301', '👩‍💻']) {
      const memory = withLesson();
      memory.modes.understand.lessons[0].question = question;
      const exportText = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(exportText).toContain(`我的問題：\n${question}\n`);
    }
  });

  it('marks missing or invisible model citations explicitly rather than emitting blank-looking TXT evidence', () => {
    for (const quote of ['', '\u200b', '\u2060\u200d\u0301', '\u2800', ' \n\t', '\u202e']) {
      const memory = withLesson();
      const lesson = memory.modes.understand.lessons[0];
      lesson.response = {
        ...lesson.response, sourceQuote: quote,
        steps: [
          { title: '缺少引句', explanation: '先回到原文核對。', sourceQuote: quote },
          { title: '有原文', explanation: '這段可在教材定位。', sourceQuote: '主鍵' },
          { title: '未核對的 AI 引句', explanation: '推測仍需查證。', sourceQuote: '未出現的詞' },
        ],
      };
      const original = JSON.stringify(memory);
      const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });
      expect(text).toContain('AI 講解：\n主鍵像是每位學生的學號。\n\nAI 引句：未提供可讀引句');
      expect(text).toContain('本步講解：\n先回到原文核對。\n本步 AI 引句：未提供可讀引句');
      expect(text).toContain('本步引用原文：\n主鍵');
      expect(text).toContain('本步 AI 引句（無法在本段逐字定位）：\n未出現的詞');
      expect(text).not.toContain('\n引用原文：\n');
      if (/[^\p{White_Space}]/u.test(quote)) expect(text).not.toContain(quote);
      expect(JSON.stringify(memory)).toBe(original);
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


  it('labels unlocatable AI quotes without claiming they came from the current source passage', () => {
    const memory = withLesson();
    const lesson = memory.modes.understand.lessons[0];
    lesson.response = {
      ...lesson.response,
      sourceQuote: '教材沒有提到的外鍵定義',
      steps: [
        { title: '回到原文', explanation: '先看教材。', sourceQuote: '主鍵用來唯一識別資料。' },
        { title: '額外推測', explanation: '此句沒有來源支持。', sourceQuote: '外鍵一定不能為空值' },
        { title: '標點不是證據', explanation: '標點重複不能當佐證。', sourceQuote: '。' },
      ],
    };
    const original = JSON.stringify(memory);
    const text = buildCourseStudyNotes('資料庫', source, { '0:0': memory });

    expect(text).toContain('AI 引句（無法在本段逐字定位）：\n教材沒有提到的外鍵定義');
    expect(text).toContain('本步引用原文：\n主鍵用來唯一識別資料。');
    expect(text).toContain('本步 AI 引句（無法在本段逐字定位）：\n外鍵一定不能為空值');
    expect(text).toContain('本步 AI 引句（無法在本段逐字定位）：\n。');
    expect(text).not.toContain('引用原文：\n教材沒有提到的外鍵定義');
    expect(text).not.toContain('本步引用原文：\n外鍵一定不能為空值');
    expect(text).toContain('AI 講解：\n主鍵像是每位學生的學號。');
    expect(JSON.stringify(memory)).toBe(original);
  });

  it('does not accept a substring of a joined emoji as a source citation in exported notes', () => {
    const emojiSource = studySourceFromText({
      id: 'grapheme-evidence', title: '符號練習', text: '團隊使用 👩‍💻 合作。'
    });
    const memory = withLesson();
    memory.modes.understand.lessons[0].response.sourceQuote = '👩';
    const text = buildCourseStudyNotes('符號', emojiSource, { '0:0': memory });
    expect(text).toContain('AI 引句（無法在本段逐字定位）：\n👩');
    expect(text).toContain('原文：\n團隊使用 👩‍💻 合作。');
  });

  it('separates literal source formulas from generated or incomplete formulas in TXT exports', () => {
    const formulaSource = studySourceFromText({
      id: 'verified-formula', title: '公式驗證',
      text: '已知 x²+y²。團隊使用 👩‍💻 計算。',
    });
    const memory = withLesson();
    memory.modes.understand.lessons[0].response.steps = [
      { title: '教材公式', explanation: '先找到原文。', sourceQuote: 'x²+y²', formula: 'x²+y²' },
      { title: '延伸推測', explanation: '這不是教材上的式子。', sourceQuote: 'x²+y²', formula: 'x²+y³' },
      { title: '殘缺字素', explanation: '不能只引用半個 Emoji。', sourceQuote: '👩‍💻', formula: '👩' },
      { title: '空白符號', explanation: '只有標點不算公式證據。', sourceQuote: 'x²+y²', formula: '。' },
      { title: '隱形草稿', explanation: '不匯出看不見的公式。', sourceQuote: 'x²+y²', formula: '\u200b\u0301' },
    ];
    const original = JSON.stringify(memory);
    const output = buildCourseStudyNotes('資料庫', formulaSource, { '0:0': memory });
    expect(output).toContain('第 1 步：教材公式\n本步講解：\n先找到原文。\n本步引用原文：\nx²+y²\n原文公式：\nx²+y²');
    expect(output).toContain('第 2 步：延伸推測\n本步講解：\n這不是教材上的式子。\n本步引用原文：\nx²+y²\nAI 公式（無法在本段逐字定位）：\nx²+y³');
    expect(output).toContain('AI 公式（無法在本段逐字定位）：\n👩');
    expect(output).toContain('AI 公式（無法在本段逐字定位）：\n。');
    expect(output).not.toContain('原文公式：\nx²+y³');
    expect(output).not.toContain('原文公式：\n👩');
    expect(output).not.toContain('原文公式：\n。');
    expect(output).not.toContain('\u200b\u0301');
    expect(output.match(/原文公式：/g)).toHaveLength(1);
    expect(JSON.stringify(memory)).toBe(original);
  });

  it('does not borrow formulas from another PDF page when labeling an exported passage', () => {
    const pdf = studySourceFromDocument({
      format: 'pdf', name: '跨頁講義.pdf', warnings: [], sections: [
        { id: 'page-1', label: '第 1 頁', rows: [{ line: 1, cells: ['本頁只講 x+y。'] }], needsOcr: false, warnings: [] },
        { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: ['第 2 頁包含 z=7。'] }], needsOcr: false, warnings: [] },
      ],
    });
    const memory = withLesson();
    memory.modes.understand.lessons[0].response.steps = [
      { title: '跨頁式子', explanation: '此式不在目前段落。', sourceQuote: 'x+y', formula: 'z=7' },
    ];
    const output = buildCourseStudyNotes('數學', pdf, { '0:0': memory });
    expect(output).toContain('第 1 頁 · 第 1 段');
    expect(output).toContain('AI 公式（無法在本段逐字定位）：\nz=7');
    expect(output).not.toContain('原文公式：\nz=7');
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
    expect(courseStudyNotesFilename('資料庫\u200b.MARKDOWN')).toBe('資料庫-學習筆記.txt');
    expect(courseStudyNotesFilename('👩‍💻.md')).toBe('👩‍💻-學習筆記.txt');
  });

  it('keeps long Unicode filenames within a normal filesystem component without splitting emoji', () => {
    const filename = courseStudyNotesFilename('😀'.repeat(150));
    expect(filename).toBe(`${'😀'.repeat(48)}-學習筆記.txt`);
    expect(Buffer.byteLength(filename, 'utf8')).toBeLessThan(255);
  });
});
