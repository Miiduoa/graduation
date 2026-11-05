import { describe, expect, it } from 'vitest';
import { recognizeRuledTimetableGrid } from './ruledTimetableGrid';

function fixture() {
  const width = 440, height = 240;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x: number, y: number, color: number) => {
    data.fill(color, (y * width + x) * 4, (y * width + x) * 4 + 3);
  };
  for (const y of [44, 94, 144, 194]) for (let x = 20; x <= 400; x++) pixel(x, y, 160);
  for (const x of [20, 100, 200, 300, 400]) for (let y = 44; y <= 194; y++) pixel(x, y, 160);
  const rows = [[1, 1, 0, 0, 0, 0, 0, 0, width, height, -1, ''].join('\t')];
  function word(text: string, x: number, y: number, w = 36, h = 10, confidence = 90, line = y) {
    rows.push([5, 1, 1, 1, line, 1, x, y, w, h, confidence, text].join('\t'));
    for (let row = y + 1; row < y + h; row++) for (let col = x + 1; col < x + w; col++) pixel(col, row, 30);
  }
  word('115學年度第一學期週課表', 28, 9, 138);
  word('節次', 30, 56);
  word('星期一', 115, 56);
  word('星期三', 215, 56);
  word('星期五', 315, 56);
  word('1', 34, 108, 8);
  word('2', 34, 158, 8);
  word('資料庫', 214, 101);
  word('系統', 252, 101, 30);
  word('A301', 214, 124);
  word('English', 315, 158);
  word('Writing', 354, 158);
  const pixels = { width, height, data };
  const read = () => recognizeRuledTimetableGrid(pixels, rows.join('\n'));
  return { pixels, rows, read, pixel, word };
}

describe('ruled screenshot timetable', () => {
  it('preserves the printed title, weekday positions, periods, optional room and English word spacing', () => {
    expect(fixture().read()).toBe([
      '115學年度第一學期週課表',
      '課程名稱\t星期\t開始節次\t結束節次\t教室',
      '資料庫系統\t星期三\t1\t1\tA301',
      'English Writing\t星期五\t2\t2\t',
    ].join('\n'));
  });
  it.each([
    ['horizontal break', (f: ReturnType<typeof fixture>) => f.pixel(230, 144, 255)],
    ['merged period cell', (f: ReturnType<typeof fixture>) => {
      for (let x = 201; x < 300; x++) f.pixel(x, 144, 255);
    }],
    ['merged day cell', (f: ReturnType<typeof fixture>) => {
      for (let y = 95; y < 144; y++) f.pixel(200, y, 255);
    }],
    ['cropped rule', (f: ReturnType<typeof fixture>) => {
      for (let x = 0; x < 20; x++) f.pixel(x, 44, 160);
    }],
    ['irregular rule spacing', (f: ReturnType<typeof fixture>) => {
      for (let y = 44; y <= 194; y++) f.pixel(140, y, 160);
    }],
    ['unread course in a blank cell', (f: ReturnType<typeof fixture>) => f.pixel(140, 120, 40)],
    ['unread course text', (f: ReturnType<typeof fixture>) => f.pixel(284, 131, 40)],
    ['unread footer', (f: ReturnType<typeof fixture>) => f.pixel(230, 206, 30)],
    ['extra footer', (f: ReturnType<typeof fixture>) => f.word('備註', 24, 212)],
    ['extra teacher or note in a cell', (f: ReturnType<typeof fixture>) => f.word('教師', 260, 120)],
    ['uncertain course title', (f: ReturnType<typeof fixture>) => f.word('微積分', 120, 112, 36, 10, 58)],
    ['ambiguous box over a divider', (f: ReturnType<typeof fixture>) => f.word('微積分', 191, 112)],
    ['duplicate weekday', (f: ReturnType<typeof fixture>) => { f.rows[4] = f.rows[4].replace('星期三', '星期一'); }],
    ['out-of-order weekday', (f: ReturnType<typeof fixture>) => { f.rows[5] = f.rows[5].replace('星期五', '星期二'); }],
    ['skipped period label', (f: ReturnType<typeof fixture>) => { f.rows[7] = f.rows[7].replace(/2$/u, '3'); }],
    ['wrong page size', (f: ReturnType<typeof fixture>) => { f.rows[0] = f.rows[0].replace('440', '411'); }],
  ] as const)('declines %s', (_reason, change) => {
    const f = fixture();
    change(f);
    expect(f.read()).toBeNull();
  });
  it('rejects invalid dimensions and oversized or malformed input before interpreting the table', () => {
    const f = fixture();
    expect(recognizeRuledTimetableGrid({ ...f.pixels, width: -8 }, '')).toBeNull();
    expect(recognizeRuledTimetableGrid({ ...f.pixels, height: 4100 }, '')).toBeNull();
    expect(recognizeRuledTimetableGrid({ ...f.pixels, data: f.pixels.data.subarray(1) }, '')).toBeNull();
    expect(recognizeRuledTimetableGrid(f.pixels, 'a'.repeat(260_000))).toBeNull();
    expect(recognizeRuledTimetableGrid(f.pixels, 'bad')).toBeNull();
  });
});
