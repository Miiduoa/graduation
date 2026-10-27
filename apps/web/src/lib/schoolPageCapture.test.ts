import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildSchoolPageCaptureBookmarklet } from '@campus/shared/src/imports/schoolPageCapture';
import { extractSchoolPageTables } from '@campus/shared/src/imports/schoolPageTables';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';

let captured: Blob | undefined;
let downloadedName = '';
const table = (name = '資料庫') =>
  `<table><caption>學期成績</caption><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>${name}</td><td>3</td><td>85</td></tr></table>`;
function runCapture() {
  const url = buildSchoolPageCaptureBookmarklet();
  expect(url.startsWith('javascript:')).toBe(true);
  // Execute the actual copied bookmark, so bundler-scope dependencies cannot hide.
  window.eval(decodeURIComponent(url.slice('javascript:'.length)));
  return document.getElementById('campus-one-school-table-capture')!.shadowRoot!;
}
function press(root: ShadowRoot, text: string) {
  const button = [...root.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  expect(button).toBeTruthy();
  button!.click();
}
async function capturedHtml() {
  expect(captured).toBeDefined();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(captured!);
  });
}
beforeEach(() => {
  captured = undefined;
  downloadedName = '';
  document.body.innerHTML = '';
  document.title = '115 學年度第 1 學期成績';
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    { width: 120, height: 40 },
  ] as unknown as DOMRectList);
  URL.createObjectURL = vi.fn((blob: Blob) => {
    captured = blob;
    return 'blob:captured-school-table';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadedName = this.download;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network access is not allowed');
    }),
  );
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
    throw new Error('Cookie access is not allowed');
  });
});
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('requires a download click, exports only the selected table, and round-trips through the existing school importer', async () => {
  document.body.innerHTML = `<p>不應擷取的其他私人資料</p>${table('資料庫')}${table('統計學')}`;
  const root = runCapture();
  expect(captured).toBeUndefined();
  press(root, '表格 2');
  press(root, '下載選取的表格');
  const html = await capturedHtml();
  expect(downloadedName).toBe('CampusOne-school-table.html');
  expect(html).toContain('統計學');
  expect(html).not.toContain('資料庫');
  expect(html).not.toContain('不應擷取的其他私人資料');
  expect(fetch).not.toHaveBeenCalled();
  const choices = extractSchoolPageTables(html, 'grades');
  expect(choices).toHaveLength(1);
  const parsed = parsePersonalImport(choices[0].text, {
    kind: 'grades',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
  });
  expect(parsed.rows).toHaveLength(1);
  expect(parsed.rows[0]).toMatchObject({ title: '統計學', credits: 3, grade: '85' });
});

it('does not capture form fields, hidden text, executable elements or link attributes', async () => {
  document.body.innerHTML = `<table>
    <tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>
    <tr><td><a href="https://school.example/private?token=secret">資料庫</a><script>privateScriptToken</script><span hidden>hiddenToken</span><span style="display:none">cssHiddenToken</span><span aria-hidden="true">ariaHiddenToken</span><form><label>私人欄位</label><input type="password" value="passwordSecret"></form><textarea>textareaSecret</textarea><button>buttonSecret</button></td><td>3</td><td>85</td></tr>
    <tr hidden><td>hiddenCourse</td><td>4</td><td>90</td></tr>
  </table>`;
  Object.defineProperty(document.querySelector('input'), 'value', {
    get() {
      throw new Error('Do not read credentials');
    },
  });
  const root = runCapture();
  press(root, '下載選取的表格');
  const html = await capturedHtml();
  for (const secret of [
    'privateScriptToken',
    'hiddenToken',
    'cssHiddenToken',
    'ariaHiddenToken',
    'passwordSecret',
    'textareaSecret',
    'buttonSecret',
    'hiddenCourse',
    '私人欄位',
    'token=secret',
  ])
    expect(html).not.toContain(secret);
  const output = new DOMParser().parseFromString(html, 'text/html');
  expect(
    output.querySelectorAll('script, form, input, textarea, button, a, img, iframe, style'),
  ).toHaveLength(0);
  expect(output.querySelectorAll('tr')).toHaveLength(2);
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves weekly rowspan/colspan and adjusts row spans when hidden rows are omitted', async () => {
  document.body.innerHTML = `<table><tr><th>節次</th><th>星期一</th><th>星期二</th><th>星期三</th></tr>
    <tr><td>1</td><td rowspan="3">資料庫<br>王老師</td><td colspan="2">共同課程</td></tr>
    <tr hidden><td>隱藏節次</td><td>隱藏內容</td></tr>
    <tr><td>2</td><td>英文</td><td>統計學</td></tr></table>`;
  const root = runCapture();
  press(root, '下載選取的表格');
  const html = await capturedHtml();
  const output = new DOMParser().parseFromString(html, 'text/html');
  expect(output.querySelector('[rowspan]')?.getAttribute('rowspan')).toBe('2');
  expect(output.querySelector('[colspan]')?.getAttribute('colspan')).toBe('2');
  expect(output.querySelector('[rowspan]')?.textContent).toBe('資料庫\n王老師');
  expect(html).not.toContain('隱藏');
  expect(extractSchoolPageTables(html, 'timetable', 'pu')).toHaveLength(1);
});

it('treats source markup-looking strings as escaped text, never as downloaded HTML', async () => {
  document.body.innerHTML = table();
  document.querySelector('tr:nth-child(2) td')!.textContent =
    '安全課程 <img src=x onerror=alert(1)>';
  const root = runCapture();
  press(root, '下載選取的表格');
  const html = await capturedHtml();
  expect(html).toContain('&lt;img');
  const output = new DOMParser().parseFromString(html, 'text/html');
  expect(output.querySelector('img')).toBeNull();
  expect(output.querySelector('tr:nth-child(2) td')?.textContent).toContain('<img');
});

it('offers a clear fallback on sign-in or non-table pages without reading credentials', () => {
  document.body.innerHTML =
    '<form><table><tr><th>學號</th><td><input value="privateId"></td></tr><tr><th>密碼</th><td><input type="password" value="privatePassword"></td></tr></table></form>';
  const root = runCapture();
  expect(root.textContent).toContain('沒有找到可擷取的校務表格');
  expect(
    [...root.querySelectorAll('button')].some((button) => button.textContent?.includes('下載')),
  ).toBe(false);
  expect(captured).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('only captures inner data tables instead of including an outer layout table twice', async () => {
  document.body.innerHTML = `<table><tr><td>網頁導覽 ${table('英文')}</td></tr><tr><td>footerSecret</td></tr></table>`;
  const root = runCapture();
  expect(root.querySelectorAll('button.table')).toHaveLength(1);
  press(root, '下載選取的表格');
  const html = await capturedHtml();
  expect(html).not.toContain('footerSecret');
  expect(html).not.toContain('網頁導覽');
});

it('does not silently truncate a table larger than the import limit', () => {
  document.body.innerHTML = `<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>${Array.from({ length: 501 }, (_, index) => `<tr><td>課程${index}</td><td>3</td><td>85</td></tr>`).join('')}</table>`;
  const root = runCapture();
  expect(root.textContent).toContain('超過單次擷取範圍');
  expect(root.querySelectorAll('button.table')).toHaveLength(0);
  expect(captured).toBeUndefined();
});

it('opens one chooser, supports Escape, and restores focus to the original page', () => {
  document.body.innerHTML = `<button id="return-focus">返回位置</button>${table()}`;
  const original = document.getElementById('return-focus') as HTMLButtonElement;
  original.focus();
  runCapture();
  runCapture();
  expect(document.querySelectorAll('#campus-one-school-table-capture')).toHaveLength(1);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.getElementById('campus-one-school-table-capture')).toBeNull();
  expect(document.activeElement).toBe(original);
});

it.each([0, 99])(
  'bounds rowspan=%s to its own row group before flattening the captured table',
  async (span) => {
    document.body.innerHTML = `<table>
    <thead><tr><th rowspan="${span}">學期</th><th>課程名稱</th><th>學分</th><th>成績</th></tr></thead>
    <tbody><tr><td rowspan="${span}">1</td><td>資料庫</td><td>3</td><td>85</td></tr><tr><td>英文</td><td>2</td><td>90</td></tr></tbody>
    <tbody><tr><td rowspan="${span}">2</td><td>統計學</td><td>3</td><td>88</td></tr><tr><td>程式設計</td><td>2</td><td>92</td></tr></tbody>
  </table>`;
    const root = runCapture();
    press(root, '下載選取的表格');
    const html = await capturedHtml();
    const output = new DOMParser().parseFromString(html, 'text/html');
    expect(output.querySelector('th')?.hasAttribute('rowspan')).toBe(false);
    expect(
      [...output.querySelectorAll('[rowspan]')].map((cell) => cell.getAttribute('rowspan')),
    ).toEqual(['2', '2']);
    const choices = extractSchoolPageTables(html, 'grades');
    expect(choices).toHaveLength(1);
    const parsed = parsePersonalImport(choices[0].text, {
      kind: 'grades',
      schoolId: 'pu',
      academicYear: '115',
      semester: '',
    });
    expect(parsed.rows.map(({ title, semester }) => ({ title, semester }))).toEqual([
      { title: '資料庫', semester: '1' },
      { title: '英文', semester: '1' },
      { title: '統計學', semester: '2' },
      { title: '程式設計', semester: '2' },
    ]);
  },
);
