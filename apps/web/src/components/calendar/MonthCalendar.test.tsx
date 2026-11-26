import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import { MonthCalendar } from './MonthCalendar';
import styles from './MonthCalendar.module.css';

const originalBounds = Element.prototype.getBoundingClientRect;

function mockVisibleDates() {
  // JSDOM does not lay out the date buttons.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains(styles.date)) return new DOMRect(40, 100, 44, 44);
    return originalBounds.call(this);
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const baseProps = {
  records: [] as PersonalImportRecord[],
  month: '2028-01',
  selectedDate: '2028-01-31',
  onDate: vi.fn(),
  onEdit: vi.fn(),
  disabled: false,
};

function focusDate(date: string) {
  const button = screen.getByRole('button', { name: date });
  act(() => button.focus());
  return button;
}

function dateTabStops() {
  return screen
    .getAllByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ })
    .filter((button) => button.tabIndex === 0);
}

it.each([320, 541])('%ipx 月格可辨識行程名稱、展開並直接開啟指定行程', (viewportWidth) => {
  // JSDOM parses media rules but does not apply them based on viewport width.
  const stylesheet = document.createElement('style');
  stylesheet.textContent = readFileSync(
    'src/components/calendar/MonthCalendar.module.css',
    'utf8',
  ).replace(/\.([a-zA-Z]\w*)/g, (selector, name) => (styles[name] ? `.${styles[name]}` : selector));
  document.head.append(stylesheet);
  const rules = Array.from(stylesheet.sheet!.cssRules).flatMap((rule) => {
    if (!(rule instanceof CSSMediaRule)) return [rule.cssText];
    const maxWidth = rule.conditionText.match(/^\(max-width:\s*(\d+)px\)$/);
    return maxWidth && viewportWidth <= Number(maxWidth[1])
      ? Array.from(rule.cssRules, (nestedRule) => nestedRule.cssText)
      : [];
  });
  stylesheet.textContent = rules.join('\n');
  try {
    const records: PersonalImportRecord[] = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      kind: 'events',
      title: i < 2 ? `跨月活動的完整長名稱用於確認月格換行後可辨識第 ${i + 1} 場` : '合成2',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2024-02-29',
      endDate: '2024-03-02',
      allDay: true,
      batchId: 'test',
      importedAt: '2024-01-01T00:00:00Z',
      source: { type: 'paste', line: 1, rawText: '' },
    }));
    const onDate = vi.fn();
    const onEdit = vi.fn();
    render(
      <MonthCalendar
        month="2024-03"
        records={records}
        selectedDate=""
        onDate={onDate}
        onEdit={onEdit}
        disabled={false}
      />,
    );
    expect(screen.getByRole('heading', { name: '2024 / 03' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '2024-03 月格，週日起始' }).tabIndex).toBe(0);
    for (const record of records.slice(0, 2)) {
      const event = screen.getByRole('button', { name: record.title });
      const title = within(event).getByText(record.title);
      const titleStyle = getComputedStyle(title);
      expect(titleStyle.display).toBe(viewportWidth <= 540 ? '-webkit-box' : 'block');
      expect(getComputedStyle(event).overflowWrap).toBe('anywhere');
      fireEvent.click(event);
      expect(onEdit).toHaveBeenLastCalledWith(record, event);
    }
    expect(screen.queryByText('合成2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '還有 1 筆' }));
    const edit = screen.getByRole('button', { name: '合成2' });
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledWith(records[2], edit);
    expect(getComputedStyle(within(edit).getByText('合成2')).display).toBe('block');
    const date = screen.getByRole('button', { name: '2024-03-01' });
    expect(document.getElementById(date.getAttribute('aria-describedby')!)?.textContent).toBe(
      '3 筆行程',
    );
    fireEvent.click(screen.getByRole('button', { name: '2024-03-01' }));
    expect(onDate).toHaveBeenCalledWith('2024-03-01');
    fireEvent.click(screen.getByText('收合'));
    expect(screen.queryByText('合成2')).toBeNull();
  } finally {
    stylesheet.remove();
  }
});

it('所有日期依順序進入 Tab 導覽，包含未選取的日期', () => {
  render(<MonthCalendar {...baseProps} selectedDate="2028-01-12" />);
  const expectedDates = Array.from(
    { length: 31 },
    (_, index) => `2028-01-${String(index + 1).padStart(2, '0')}`,
  );
  expect(dateTabStops().map((button) => button.getAttribute('aria-label'))).toEqual(expectedDates);
  expect(dateTabStops()[12].getAttribute('aria-pressed')).toBe('false');
});

it('方向鍵移動日期焦點，直到啟用日期才改選日', () => {
  mockVisibleDates();
  const onDate = vi.fn();
  render(<MonthCalendar {...baseProps} selectedDate="2028-01-12" onDate={onDate} />);
  fireEvent.keyDown(focusDate('2028-01-12'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-19' }));
  expect(screen.getByRole('button', { name: '2028-01-12' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(onDate).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-20' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-16' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-22' }));
  fireEvent.click(document.activeElement!);
  expect(onDate).toHaveBeenCalledExactlyOnceWith('2028-01-22');
});

it('PageDown 跨到閏年短月保留焦點，只有選取後才改當日內容', () => {
  mockVisibleDates();
  const onDate = vi.fn();
  function ControlledCalendar() {
    const [month, setMonth] = useState('2028-01');
    const [selectedDate, setSelectedDate] = useState('2028-01-31');
    return (
      <MonthCalendar
        {...baseProps}
        month={month}
        selectedDate={selectedDate}
        onMonthChange={(next) => {
          setMonth(next);
          setSelectedDate('');
        }}
        onDate={(date) => {
          onDate(date);
          setSelectedDate(date);
        }}
      />
    );
  }
  render(<ControlledCalendar />);
  fireEvent.keyDown(focusDate('2028-01-31'), { key: 'PageDown' });
  expect(screen.getByRole('heading', { name: '2028 / 02' })).toBeTruthy();
  const target = screen.getByRole('button', { name: '2028-02-29' });
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute('aria-pressed')).toBe('false');
  expect(onDate).not.toHaveBeenCalled();
  fireEvent.click(target);
  expect(onDate).toHaveBeenCalledExactlyOnceWith('2028-02-29');
  expect(target.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(target, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-03-01' }));
  expect(onDate).toHaveBeenCalledTimes(1);
});

it.each([false, true])('跨月進場動畫結束後只揭露仍有焦點的日期（焦點已移開：%s）', (focusMoved) => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { offsetTop: 0, offsetLeft: 0, width: 320, height: 400 },
  });
  let animationOffset = 3;
  let pageOffset = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.id === 'sticky-topbar') return new DOMRect(0, 0, 320, 64);
    if (this.getAttribute('aria-label') === '2028-02-01') {
      return new DOMRect(40, 62 + animationOffset - pageOffset, 44, 44);
    }
    return originalBounds.call(this);
  });
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') pageOffset += options.top ?? 0;
  });

  function ControlledCalendar() {
    const [month, setMonth] = useState('2028-01');
    return (
      <>
        <header id="sticky-topbar" style={{ position: 'sticky', top: 0, opacity: 1 }}>
          <button type="button">其他控制項</button>
        </header>
        <MonthCalendar {...baseProps} month={month} onMonthChange={setMonth} />
      </>
    );
  }

  const { container } = render(<ControlledCalendar />);
  fireEvent.keyDown(focusDate('2028-01-31'), { key: 'ArrowRight' });
  const target = screen.getByRole('button', { name: '2028-02-01' });
  expect(document.activeElement).toBe(target);
  expect(scrollBy).not.toHaveBeenCalled();

  const active = focusMoved ? screen.getByRole('button', { name: '其他控制項' }) : target;
  if (focusMoved) act(() => active.focus());
  animationOffset = 0;
  expect(target.getBoundingClientRect().top).toBe(62);
  fireEvent.animationEnd(container.querySelector(`.${styles.grid}`)!);

  expect(document.activeElement).toBe(active);
  if (focusMoved) {
    expect(scrollBy).not.toHaveBeenCalled();
  } else {
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ left: 0, top: -2, behavior: 'instant' });
    expect(target.getBoundingClientRect().top).toBe(64);
  }
});

it.each(['月格', 'body', '其他控制項'])('跨月首次揭露失敗後由進場動畫結束重試焦點（焦點在 %s）', (focusLocation) => {
  const visualViewport = Object.assign(new EventTarget(), {
    offsetTop: 0, offsetLeft: 0, width: 320, height: 400,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
  let animationOffset = 3;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('aria-label') === '2028-02-01') {
      return new DOMRect(40, 356 + animationOffset, 44, 44);
    }
    if (this.getAttribute('aria-label') === '2028-02 月格，週日起始') {
      return new DOMRect(0, focusLocation === 'body' ? 41 : 40, 320, 360);
    }
    return originalBounds.call(this);
  });
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

  function ControlledCalendar() {
    const [month, setMonth] = useState('2028-01');
    return (
      <>
        <button type="button">其他控制項</button>
        <MonthCalendar {...baseProps} month={month} onMonthChange={setMonth} />
      </>
    );
  }

  render(<ControlledCalendar />);
  fireEvent.keyDown(focusDate('2028-01-31'), { key: 'ArrowRight' });
  const viewport = screen.getByRole('region', { name: '2028-02 月格，週日起始' });
  const target = screen.getByRole('button', { name: '2028-02-01' });
  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 3, behavior: 'instant' });
  const fallback = focusLocation === 'body' ? document.body : viewport;
  expect(document.activeElement).toBe(fallback);
  scrollBy.mockClear();

  const focusMoved = focusLocation === '其他控制項';
  const active = focusMoved ? screen.getByRole('button', { name: '其他控制項' }) : fallback;
  if (focusMoved) act(() => active.focus());
  animationOffset = 0;
  fireEvent.animationEnd(target);
  expect(document.activeElement).toBe(active);
  fireEvent.animationEnd(viewport.querySelector(`.${styles.grid}`)!);

  expect(document.activeElement).toBe(focusMoved ? active : target);
  expect(scrollBy).not.toHaveBeenCalled();
});

it.each([
  { origin: '2028-10-27', key: 'End', expected: '2028-10-28', width: 609, next: null },
  { origin: '2028-10-23', key: 'Home', expected: '2028-10-22', width: 609, next: null },
  { origin: '2028-09-28', key: 'PageDown', expected: '2028-10-28', width: 541, next: null },
  { origin: '2023-10-30', key: 'PageUp', expected: '2023-09-30', width: 541, next: null },
  { origin: '2028-10-27', key: 'ArrowRight', expected: '2028-10-28', width: 609, next: '2028-10-29' },
  { origin: '2028-10-29', key: 'ArrowLeft', expected: '2028-10-28', width: 609, next: '2028-10-27' },
  { origin: '2023-09-29', key: 'ArrowRight', expected: '2023-09-30', width: 609, next: '2023-10-01' },
  { origin: '2023-10-01', key: 'ArrowLeft', expected: '2023-09-30', width: 609, next: '2023-09-29' },
])('$width px、文字放大至兩倍時從 $origin 按 $key，焦點仍完整可見', ({ origin, key, expected, width, next }) => {
  const viewportWidth = width - 80;
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(viewportWidth);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(616);
  let scrollY = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'region') return new DOMRect(40, 500 - scrollY, viewportWidth, 400);
    if (this.classList.contains(styles.weekday)) {
      const index = Array.from(this.parentElement!.children).indexOf(this);
      const viewport = this.closest('[role="region"]')!;
      return new DOMRect(40 + index * 88 - viewport.scrollLeft, 500 - scrollY, 88, 24);
    }
    if (this.classList.contains(styles.date)) {
      const date = new Date(this.getAttribute('aria-label')!);
      const viewport = this.closest('[role="region"]')!;
      return new DOMRect(44 + date.getUTCDay() * 88 - viewport.scrollLeft, 700 - scrollY, 80, 40);
    }
    return originalBounds.call(this);
  });
  const horizontalScroll = vi.spyOn(Element.prototype, 'scrollLeft', 'set');
  const pageScroll = vi.spyOn(window, 'scrollBy').mockImplementation((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') scrollY += options.top ?? 0;
  });
  const onDate = vi.fn();

  function ControlledCalendar() {
    const [month, setMonth] = useState(origin.slice(0, 7));
    return (
      <>
        <style>{`.${styles.viewport} { overflow-x: auto; }`}</style>
        <MonthCalendar
          {...baseProps}
          month={month}
          selectedDate=""
          onDate={onDate}
          onMonthChange={setMonth}
        />
      </>
    );
  }
  render(<ControlledCalendar />);
  if (key === 'PageDown') {
    screen.getByRole('region', { name: '2028-09 月格，週日起始' }).scrollLeft = 155;
  }
  if (key === 'Home') {
    screen.getByRole('region', { name: '2028-10 月格，週日起始' }).scrollLeft = 87;
  }
  const scrollAtFocus = vi.fn((event: FocusEvent) => {
    const button = event.target as HTMLElement;
    if (button.getAttribute('aria-label') === expected) {
      return button.closest('[role="region"]')?.scrollLeft;
    }
  });
  document.addEventListener('focusin', scrollAtFocus);
  horizontalScroll.mockClear();
  try {
    fireEvent.keyDown(focusDate(origin), { key });
  } finally {
    document.removeEventListener('focusin', scrollAtFocus);
  }
  const changesMonthByPage = key === 'PageDown' || key === 'PageUp';
  const expectedScroll = key === 'Home' ? 4 : 612 - viewportWidth;
  expect(horizontalScroll).toHaveBeenCalledExactlyOnceWith(expectedScroll);
  expect(scrollAtFocus).toHaveLastReturnedWith(expectedScroll);
  expect(pageScroll).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 100, behavior: 'instant' });
  expect(onDate).not.toHaveBeenCalled();

  const viewport = screen.getByRole('region', { name: `${expected.slice(0, 7)} 月格，週日起始` });
  const bounds = viewport.getBoundingClientRect();
  const focused = within(viewport).getByRole('button', { name: expected });
  expect(document.activeElement).toBe(focused);
  const focusedBounds = focused.getBoundingClientRect();
  expect(focusedBounds.left).toBeGreaterThanOrEqual(bounds.left);
  expect(focusedBounds.right).toBeLessThanOrEqual(bounds.right);
  expect(focusedBounds.top).toBeGreaterThanOrEqual(0);
  expect(focusedBounds.bottom).toBeLessThanOrEqual(window.innerHeight);

  if (next) {
    fireEvent.keyDown(focused, { key });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: next }));
    expect(onDate).not.toHaveBeenCalled();
  } else if (changesMonthByPage) {
    fireEvent.click(focused);
    expect(onDate).toHaveBeenCalledExactlyOnceWith(expected);
  }
});

it.each([
  ['部分重疊', 120, 616, 0, 'nearest', false],
  ['完全錯開', 700, 616, 0, 'start', false],
  ['完全錯開且七欄溢位', 700, 320, 292, 'start', false],
  ['完全錯開且延後平移', 700, 320, 292, 'start', true],
])('放大後可視視窗與月格%s，End 先平移再聚焦週六', (_case, offsetLeft, width, expectedScroll, inline, delayed) => {
  const visualViewport = Object.assign(new EventTarget(), { offsetLeft, offsetTop: 30, width: 300, height: 640 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(616);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains(styles.viewport)) return new DOMRect(40, 0, width, 500);
    if (this.classList.contains(styles.date)) {
      const column = new Date(this.getAttribute('aria-label')!).getUTCDay();
      const container = this.closest(`.${styles.viewport}`)!;
      return new DOMRect(44 + column * 88 - container.scrollLeft, 100, 80, 40);
    }
    return originalBounds.call(this);
  });
  render(
    <>
      <style>{`.${styles.viewport} { overflow-x: auto; }`}</style>
      <MonthCalendar {...baseProps} />
    </>,
  );
  const viewport = screen.getByRole('region', { name: '2028-01 月格，週日起始' });
  const origin = focusDate('2028-01-12');
  const target = within(viewport).getByRole('button', { name: '2028-01-15' });
  const initialBounds = target.getBoundingClientRect();
  expect(initialBounds.right > offsetLeft + visualViewport.width || initialBounds.right <= offsetLeft).toBe(true);
  const pan = vi.fn((options: ScrollIntoViewOptions) => {
    expect(document.activeElement).toBe(origin);
    expect(viewport.scrollLeft).toBe(expectedScroll);
    if (delayed) return;
    const bounds = target.getBoundingClientRect();
    if (options.inline === 'start') visualViewport.offsetLeft = bounds.left;
    else if (inline === 'nearest') visualViewport.offsetLeft = bounds.right - visualViewport.width;
  });
  Object.defineProperty(target, 'scrollIntoView', { value: pan });

  const key = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
  fireEvent(origin, key);

  expect(key.defaultPrevented).toBe(true);
  expect(pan).toHaveBeenCalledExactlyOnceWith({
    block: 'nearest', inline, behavior: 'instant',
  });
  expect(viewport.scrollLeft).toBe(expectedScroll);
  if (delayed) {
    expect(document.activeElement).toBe(origin);
    visualViewport.offsetLeft = target.getBoundingClientRect().left;
    visualViewport.dispatchEvent(new Event('scroll'));
  }
  expect(document.activeElement).toBe(target);
  expect(target.getBoundingClientRect().left).toBeGreaterThanOrEqual(visualViewport.offsetLeft);
  expect(target.getBoundingClientRect().right).toBeLessThanOrEqual(visualViewport.offsetLeft + visualViewport.width);
});

it('外部月份或日期更新不搶走目前控制的焦點', () => {
  const { rerender } = render(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} />
    </>,
  );
  const outside = screen.getByRole('button', { name: '回今天' });
  act(() => outside.focus());
  rerender(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} month="2028-02" selectedDate="2028-02-14" />
    </>,
  );
  expect(document.activeElement).toBe(outside);
  rerender(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} month="2028-02" selectedDate="2028-02-21" />
    </>,
  );
  expect(document.activeElement).toBe(outside);
});

it('窄螢幕換月後從第一個星期欄開始顯示', () => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(216);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(616);
  const { rerender } = render(<MonthCalendar {...baseProps} selectedDate="" />);
  const calendar = screen.getByRole('region', { name: '2028-01 月格，週日起始' });
  calendar.scrollLeft = 200;

  rerender(<MonthCalendar {...baseProps} month="2028-02" selectedDate="" />);

  expect(screen.getByRole('region', { name: '2028-02 月格，週日起始' }).scrollLeft).toBe(0);
});

it('缺少跨月回呼時留在邊界，不攔截瀏覽器快捷鍵', () => {
  render(<MonthCalendar {...baseProps} />);
  const last = focusDate('2028-01-31');
  fireEvent.keyDown(last, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(last);
  const shortcut = new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(last, shortcut);
  expect(shortcut.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(last);
});

it('今天依台灣日期標示，禁止編輯時仍可查看日期', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2028-01-30T16:30:00Z'));
  const onDate = vi.fn();
  render(<MonthCalendar {...baseProps} selectedDate="" disabled onDate={onDate} />);
  const today = screen.getByRole('button', { name: '2028-01-31' });
  expect(today.getAttribute('aria-current')).toBe('date');
  expect(document.getElementById(today.getAttribute('aria-describedby')!)?.textContent).toBe(
    '今天，沒有個人行程',
  );
  fireEvent.click(today);
  expect(onDate).toHaveBeenCalledExactlyOnceWith('2028-01-31');
});

it('重新開啟窄月格時完整露出已選日期，僅調整月格的水平捲動', () => {
  const originalBounds = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(264);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(616);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'region') return new DOMRect(40, 500, 264, 400);
    if (this.classList.contains(styles.weekday)) {
      const index = Array.from(this.parentElement!.children).indexOf(this);
      const viewport = this.closest('[role="region"]')!;
      return new DOMRect(40 + index * 88 - viewport.scrollLeft, 500, 88, 24);
    }
    if (this.getAttribute('aria-label') === '2028-01-18') {
      const viewport = this.closest('[role="region"]')!;
      return new DOMRect(40 + 176 - viewport.scrollLeft, 600, 88, 96);
    }
    return originalBounds.call(this);
  });
  const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const pageScrollBefore = window.scrollY;
  const onDate = vi.fn();
  const view = render(<button type="button">月格</button>);
  const switcher = screen.getByRole('button', { name: '月格' });
  switcher.focus();

  view.rerender(
    <>
      <button type="button">月格</button>
      <MonthCalendar {...baseProps} selectedDate="2028-01-18" onDate={onDate} />
    </>,
  );
  const viewport = screen.getByRole('region', { name: '2028-01 月格，週日起始' });
  const selected = screen.getByRole('button', { name: '2028-01-18' });
  expect(viewport.scrollLeft).toBe(0);
  expect(selected.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    viewport.getBoundingClientRect().left,
  );
  expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(
    viewport.getBoundingClientRect().right,
  );
  expect(document.activeElement).toBe(switcher);
  expect(window.scrollY).toBe(pageScrollBefore);
  expect(pageScroll).not.toHaveBeenCalled();
  expect(onDate).not.toHaveBeenCalled();

  // A later list→month return creates another viewport; selection remains visible.
  view.rerender(<button type="button">月格</button>);
  view.rerender(
    <>
      <button type="button">月格</button>
      <MonthCalendar {...baseProps} selectedDate="2028-01-18" onDate={onDate} />
    </>,
  );
  expect(screen.getByRole('region', { name: '2028-01 月格，週日起始' }).scrollLeft).toBe(0);
  expect(document.activeElement).toBe(switcher);
  expect(pageScroll).not.toHaveBeenCalled();
});

it('外部選日移到左側時只捲回必要距離，不搶焦點或重設已可見的月份', () => {
  const view = render(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} selectedDate="" />
    </>,
  );
  const outside = screen.getByRole('button', { name: '回今天' });
  outside.focus();
  const viewport = screen.getByRole('region', { name: '2028-01 月格，週日起始' });
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 216 });
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 616 });
  viewport.scrollLeft = 200;
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 500, 216, 400));
  const sunday = within(viewport).getByText('日', { exact: true });
  vi.spyOn(sunday, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(40 - viewport.scrollLeft, 500, 88, 24),
  );
  const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

  view.rerender(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} selectedDate="2028-01-23" />
    </>,
  );
  expect(viewport.scrollLeft).toBe(0);
  expect(document.activeElement).toBe(outside);
  expect(pageScroll).not.toHaveBeenCalled();

  viewport.scrollLeft = 20;
  view.rerender(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} selectedDate="2028-01-23" disabled />
    </>,
  );
  expect(viewport.scrollLeft).toBe(20);
  expect(document.activeElement).toBe(outside);
});

it.each([
  ['月內', '2028-01-27', '2028-01-29'],
  ['跨月', '2028-01-30', '2028-02-01'],
])('待聚焦時連按兩次右鍵可沿待聚焦日期繼續%s移動', (_case, start, expected) => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 450, offsetTop: 0, width: 240, height: 400,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains(styles.viewport)) return new DOMRect(20, 50, 300, 250);
    if (this.classList.contains(styles.date)) return new DOMRect(40, 90, 44, 40);
    return originalBounds.call(this);
  });

  function Calendar() {
    const [month, setMonth] = useState(baseProps.month);
    return <MonthCalendar {...baseProps} month={month} onMonthChange={setMonth} />;
  }

  render(<Calendar />);
  const origin = focusDate(start);
  fireEvent.keyDown(origin, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(origin);
  fireEvent.keyDown(origin, { key: 'ArrowRight' });

  const target = screen.getByRole('button', { name: expected });
  expect(document.activeElement).not.toBe(target);
  viewport.offsetLeft = 20;
  viewport.dispatchEvent(new Event('scroll'));
  expect(document.activeElement).toBe(target);
});

it.each([
  '重試原日期',
  '繼續按方向鍵',
  '從月格繼續按方向鍵',
  '移走焦點',
  '點擊工作區外空白後取消交接',
  '點擊工作區內空白後繼續交接',
  '月格只露出一像素時等待交接',
])(
  '跨月目標在水平畫面外時可%s',
  (action) => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: action === '月格只露出一像素時等待交接' ? -219 : 450,
      offsetTop: 0, width: 240, height: 400,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains(styles.viewport)) return new DOMRect(20, 50, 300, 250);
      if (this.classList.contains(styles.date)) return new DOMRect(40, 90, 44, 40);
      return originalBounds.call(this);
    });

    function Calendar() {
      const [month, setMonth] = useState(baseProps.month);
      const workspaceBoundary = useRef<HTMLDivElement>(null);
      return (
        <>
          <button type="button">其他控制</button>
          <div>工作區外空白</div>
          <div ref={workspaceBoundary}>
            <div>工作區內空白</div>
            <MonthCalendar
              {...baseProps}
              month={month}
              onMonthChange={setMonth}
              workspaceBoundary={workspaceBoundary}
            />
          </div>
        </>
      );
    }
    render(<Calendar />);
    const fromGrid = action === '從月格繼續按方向鍵';
    if (fromGrid) viewport.offsetLeft = 80;
    const origin = focusDate('2028-01-31');
    fireEvent.keyDown(origin, { key: 'ArrowRight' });
    expect(origin.isConnected).toBe(false);
    const grid = screen.getByRole('region', { name: '2028-02 月格，週日起始' });
    const focusOrigin = fromGrid ? grid : document.body;
    expect(document.activeElement).toBe(focusOrigin);
    if (action === '月格只露出一像素時等待交接') {
      expect(scrollBy).toHaveBeenCalledWith({ left: 239, top: 0, behavior: 'instant' });
    }

    const outside = screen.getByRole('button', { name: '其他控制' });
    if (action === '移走焦點') outside.focus();
    const pressedOutside = action === '點擊工作區外空白後取消交接';
    if (pressedOutside || action === '點擊工作區內空白後繼續交接') {
      const blank = screen.getByText(pressedOutside ? '工作區外空白' : '工作區內空白');
      fireEvent.pointerDown(blank);
      fireEvent.pointerUp(blank);
      fireEvent.click(blank);
      expect(document.activeElement).toBe(document.body);
    }
    const continues = action === '繼續按方向鍵' || fromGrid;
    if (continues) {
      const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      fireEvent(focusOrigin, key);
      expect(key.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(focusOrigin);
    }

    viewport.offsetLeft = 20;
    viewport.dispatchEvent(new Event('scroll'));
    if (pressedOutside) {
      expect(document.activeElement).toBe(document.body);
      return;
    }
    expect(document.activeElement).toBe(
      action === '移走焦點'
        ? outside
        : screen.getByRole('button', { name: continues ? '2028-02-02' : '2028-02-01' }),
    );
  },
);

it.each(['頁面垂直捲動', '月格水平捲動'])('手動%s露出目標日期後交接焦點', (source) => {
  const visualViewport = Object.assign(new EventTarget(), {
    offsetLeft: 20, offsetTop: 30, width: 240, height: 300,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
  const pageScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  render(<MonthCalendar {...baseProps} />);

  const grid = screen.getByRole('region', { name: '2028-01 月格，週日起始' });
  const origin = focusDate('2028-01-27');
  const target = screen.getByRole('button', { name: '2028-01-28' });
  const isPageScroll = source === '頁面垂直捲動';
  let pageOffset = 0;
  let gridOffset = 0;
  grid.style.overflowX = 'auto';
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(grid, 'scrollWidth', { configurable: true, value: 616 });
  // The first automatic reveal cannot move either scrollport.
  Object.defineProperty(grid, 'scrollLeft', {
    configurable: true, get: () => gridOffset, set: () => {},
  });
  vi.spyOn(grid, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(20, 50 - pageOffset, 300, 500),
  );
  vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect((isPageScroll ? 80 : 340) - grid.scrollLeft, (isPageScroll ? 420 : 90) - pageOffset, 44, 40),
  );

  fireEvent.keyDown(origin, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(origin);
  pageScroll.mockClear();

  const scrollSource = isPageScroll ? document : grid;
  fireEvent.scroll(scrollSource);
  expect(document.activeElement).toBe(origin);

  if (isPageScroll) pageOffset = 200;
  else gridOffset = 190;
  fireEvent.scroll(scrollSource);

  expect(document.activeElement).toBe(target);
  expect(pageScroll).not.toHaveBeenCalled();
});
