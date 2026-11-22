import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CampusSpatialExplorer from './CampusSpatialExplorer';
import type { MapLocation } from './mapService';
import { PROVIDENCE_BUS_STOPS, PROVIDENCE_CAMPUS_PLACES } from './providenceCampus';
import { parseProvidenceOsmFootprints } from './providenceFootprints';
import { DEFAULT_SPATIAL_BEARING, MAX_SPATIAL_ZOOM, MIN_SPATIAL_ZOOM } from './campusSpatialCamera';

const scene = vi.hoisted(() => ({
  create: vi.fn(),
  setView: vi.fn(),
  setActive: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./campusSpatialScene', () => ({ createCampusSpatialScene: scene.create }));

const places: MapLocation[] = [
  { id: 'library', name: '本校圖書館', category: '圖書館', description: '借書與自習', lat: 24.226, lng: 120.58 },
  { id: 'dorm', name: '本校宿舍', category: '住宿', description: '住宿區', lat: 24.228, lng: 120.582 },
];
const media = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
let intersection: IntersectionObserverCallback | null = null;
const disconnect = vi.fn();

// Browser-shaped observer entries keep synthetic viewport tests type-safe.
function observerEntry(target: Element, isIntersecting: boolean, intersectionRect?: DOMRect, time = 0): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();
  return {
    target,
    isIntersecting,
    boundingClientRect: bounds,
    intersectionRect: intersectionRect ?? (isIntersecting ? bounds : new DOMRect(0, 0, 0, 0)),
    intersectionRatio: isIntersecting ? 1 : 0,
    rootBounds: null,
    time,
  };
}

beforeEach(() => {
  window.sessionStorage.removeItem('nuni:pu:osm-footprint-cooldown-until');
  vi.clearAllMocks();
  media.clear();
  intersection = null;
  scene.create.mockImplementation(() => scene);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() { this.removeAttribute('open'); },
  });
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!media.has(query)) media.set(query, { matches: false, listeners: new Set() });
    const value = media.get(query)!;
    return {
      get matches() { return value.matches; },
      addEventListener: (_: string, callback: () => void) => value.listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) => value.listeners.delete(callback),
    };
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) { intersection = callback; }
    // Most existing tests simulate an on-screen dialog. Real browsers deliver
    // the first observer entry asynchronously; the test fixture reports it
    // immediately to preserve those tests' existing startup assumptions.
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target }] as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver);
    }
    disconnect = disconnect;
  });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-reduced-motion');
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

async function open() {
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  return screen.getByRole('dialog', { name: '校園空間導覽' });
}

it('disambiguates same-name campus markers before opening walking or flat-map navigation', async () => {
  const duplicatePlaces: MapLocation[] = [
    { id: 'same-a', name: '教學大樓', category: '教學', description: '', lat: 24.225, lng: 120.58 },
    { id: 'same-b', name: '教學大樓', category: '行政', description: '', lat: 24.227, lng: 120.581 },
    { id: 'same-c', name: '教學大樓', category: '教學', description: '', lat: 24.229, lng: 120.582 },
    { id: 'unique', name: '圖書館', category: '學習', description: '', lat: 24.226, lng: 120.583 },
  ];
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={duplicatePlaces}
    selected={null} onSelect={onSelect} />);
  const dialog = await open();
  const picker = within(dialog).getByRole('combobox', { name: '想去哪裡' }) as HTMLSelectElement;
  const options = Array.from(picker.options).filter((option) => option.value);
  expect(options.map((option) => option.text)).toEqual([
    '教學大樓（教學 · 地圖座標 24.225, 120.58 · 清單第 1 項）',
    '教學大樓（行政）',
    '教學大樓（教學 · 地圖座標 24.229, 120.582 · 清單第 3 項）',
    '圖書館',
  ]);
  expect(new Set(options.map((option) => option.text)).size).toBe(options.length);

  fireEvent.change(picker, { target: { value: 'same-c' } });
  const duplicateNotice = within(dialog).getByText(/同名地點：目前選擇/);
  expect(duplicateNotice.getAttribute('role')).toBe('status');
  expect(duplicateNotice.getAttribute('aria-live')).toBe('polite');
  expect(duplicateNotice.getAttribute('aria-atomic')).toBe('true');
  expect(duplicateNotice.textContent).toContain('24.229, 120.582，清單第 3 項');
  // A 3D marker click leaves the same visible heading. The live status must
  // change to the newly selected marker so a reader can hear the distinction.
  const sceneSelect = scene.create.mock.calls[0][2].onSelect;
  act(() => sceneSelect('same-a'));
  expect(within(dialog).getByRole('heading', { name: '教學大樓' })).toBeTruthy();
  expect(duplicateNotice.textContent).toContain('24.225, 120.58，清單第 1 項');
  expect(new URL(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!)
    .searchParams.get('destination')).toBe('24.225,120.58');
  act(() => sceneSelect('same-c'));
  expect(duplicateNotice.textContent).toContain('24.229, 120.582，清單第 3 項');
  expect(new URL(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!)
    .searchParams.get('destination')).toBe('24.229,120.582');
  const appleDirections = new URL(within(dialog).getByRole('link', { name: '開啟 Apple 地圖步行導航' }).getAttribute('href')!);
  expect(appleDirections.origin).toBe('https://maps.apple.com');
  expect(appleDirections.searchParams.get('daddr')).toBe('24.229,120.582');
  expect(appleDirections.searchParams.get('dirflg')).toBe('w');
  expect(appleDirections.searchParams.has('saddr')).toBe(false);
  expect(scene.create).toHaveBeenCalledTimes(1);
  // Before taking a step, assistive technology announces which duplicate POI
  // that button will select. Unambiguous adjacent places keep short labels.
  expect(within(dialog).getByRole('button', { name: '上一個地點：教學大樓（行政）' })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: '下一個地點' })).toBeTruthy();
  // The range control is a second way to choose destinations. Its spoken
  // value must disambiguate duplicate POIs just like the select menu.
  const progress = within(dialog).getByRole('slider', { name: /導覽進度/ }) as HTMLInputElement;
  expect(progress.getAttribute('aria-valuetext')).toBe(
    '第 3 個地點，共 4 個：教學大樓（教學 · 地圖座標 24.229, 120.582 · 清單第 3 項）',
  );
  fireEvent.change(progress, { target: { value: '0' } });
  expect(picker.value).toBe('same-a');
  expect(within(dialog).getByRole('button', { name: '下一個地點：教學大樓（行政）' })).toBeTruthy();
  expect(progress.getAttribute('aria-valuetext')).toBe(
    '第 1 個地點，共 4 個：教學大樓（教學 · 地圖座標 24.225, 120.58 · 清單第 1 項）',
  );
  fireEvent.change(progress, { target: { value: '3' } });
  expect(picker.value).toBe('unique');
  expect(progress.getAttribute('aria-valuetext')).toBe('第 4 個地點，共 4 個：圖書館');
  const previous = within(dialog).getByRole('button', {
    name: '上一個地點：教學大樓（教學 · 地圖座標 24.229, 120.582 · 清單第 3 項）',
  });
  fireEvent.click(previous);
  expect(picker.value).toBe('same-c');
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '在平面地圖查看' }));
  expect(onSelect).toHaveBeenCalledWith(duplicatePlaces[2]);
});

it('reveals and copies the original POI marker coordinate without claiming an entrance or stale selection', async () => {
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let finishFirstCopy: (() => void) | undefined;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirstCopy = resolve; }))
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    const picker = within(dialog).getByRole('combobox', { name: '想去哪裡' });
    const copyButton = within(dialog).getByRole('button', { name: '複製地圖標記座標' });

    expect(within(dialog).getByText('地圖標記座標：24.226, 120.58（非建築入口）')).toBeTruthy();
    expect(copyButton.getAttribute('aria-describedby')).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('24.226,120.58');

    // Clipboard permission may remain unresolved while the student switches POIs.
    // The old operation must never announce success for a newly selected marker.
    fireEvent.change(picker, { target: { value: 'dorm' } });
    expect(within(dialog).getByText('地圖標記座標：24.228, 120.582（非建築入口）')).toBeTruthy();
    await act(async () => { finishFirstCopy?.(); });
    expect(within(dialog).queryByText('已複製目前地點標記座標。')).toBeNull();

    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenLastCalledWith('24.228,120.582');
    await waitFor(() => expect(within(dialog).getByText('已複製目前地點標記座標。')).toBeTruthy());
    const google = new URL(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
    const apple = new URL(within(dialog).getByRole('link', { name: '開啟 Apple 地圖步行導航' }).getAttribute('href')!);
    expect(google.searchParams.get('destination')).toBe('24.228,120.582');
    expect(apple.searchParams.get('daddr')).toBe('24.228,120.582');
  } finally {
    if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('does not accept an old clipboard result when the student returns to the original POI', async () => {
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let resolveOldCopy: (() => void) | undefined;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOldCopy = resolve; }))
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    const picker = within(dialog).getByRole('combobox', { name: '想去哪裡' });
    const copy = within(dialog).getByRole('button', { name: '複製地圖標記座標' });

    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('24.226,120.58');
    fireEvent.change(picker, { target: { value: 'dorm' } });
    fireEvent.change(picker, { target: { value: 'library' } });
    expect(within(dialog).getByText('地圖標記座標：24.226, 120.58（非建築入口）')).toBeTruthy();

    // A -> B -> A has the same final identity as the first request.
    // The earlier permission result must not be reported as the latest copy.
    await act(async () => { resolveOldCopy?.(); });
    expect(within(dialog).queryByText('已複製目前地點標記座標。')).toBeNull();

    fireEvent.click(copy);
    await waitFor(() => expect(within(dialog).getByText('已複製目前地點標記座標。')).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith('24.226,120.58');
  } finally {
    if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it.each(['late success', 'late failure', 'never settles', 'close and reopen'] as const)(
  'copies the new marker immediately when the first clipboard request has %s',
  async (outcome) => {
    const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let settleFirstWrite!: () => void;
    const writeText = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
        settleFirstWrite = () => outcome === 'late failure' ? reject(new Error('permission denied')) : resolve();
      }))
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<CampusSpatialExplorer school="other-school" locations={places}
        selected={places[0]} onSelect={vi.fn()} />);
      let dialog = await open();
      const copy = () => fireEvent.click(within(dialog).getByRole('button', { name: '複製地圖標記座標' }));

      copy();
      if (outcome === 'close and reopen') {
        fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
        dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
      }
      fireEvent.change(within(dialog).getByRole('combobox', { name: '想去哪裡' }),
        { target: { value: 'dorm' } });
      copy();
      expect(writeText.mock.calls).toEqual([['24.226,120.58'], ['24.228,120.582']]);
      expect(await within(dialog).findByText('已複製目前地點標記座標。')).toBeTruthy();

      if (outcome === 'late success' || outcome === 'late failure') {
        await act(async () => { settleFirstWrite(); });
      }
      expect(within(dialog).getByText('已複製目前地點標記座標。')).toBeTruthy();
      expect(within(dialog).queryByText(/無法自動複製/)).toBeNull();
    } finally {
      if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  },
);

it('uses only the latest result when copy is clicked repeatedly for the same marker', async () => {
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let resolveFirstWrite!: () => void;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirstWrite = resolve; }))
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('permission denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    const copy = within(dialog).getByRole('button', { name: '複製地圖標記座標' });
    fireEvent.click(copy);
    fireEvent.click(copy);
    fireEvent.click(copy);
    expect(writeText.mock.calls).toEqual([['24.226,120.58'], ['24.226,120.58'], ['24.226,120.58']]);
    expect(await within(dialog).findByText(/無法自動複製/)).toBeTruthy();

    await act(async () => { resolveFirstWrite(); });
    expect(within(dialog).getByText(/無法自動複製/)).toBeTruthy();
    expect(within(dialog).queryByText('已複製目前地點標記座標。')).toBeNull();
  } finally {
    if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('offers manual copy after three seconds and permits another clipboard request', async () => {
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let resolveFirstWrite!: () => void;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirstWrite = resolve; }))
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    const copy = within(dialog).getByRole('button', { name: '複製地圖標記座標' });
    vi.useFakeTimers();
    fireEvent.click(copy);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
    expect(within(dialog).queryByText(/無法自動複製/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(within(dialog).getByText(/無法自動複製/)).toBeTruthy();

    await act(async () => { resolveFirstWrite(); });
    expect(within(dialog).getByText(/無法自動複製/)).toBeTruthy();
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByText('已複製目前地點標記座標。')).toBeTruthy();
  } finally {
    vi.useRealTimers();
    if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('keeps verified marker coordinates readable when a WebView has no Clipboard API', async () => {
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(within(dialog).getByText('地圖標記座標：24.226, 120.58（非建築入口）')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '複製地圖標記座標' }));
    await waitFor(() => expect(within(dialog).getByText('無法自動複製，請手動選取上方的地圖標記座標。')).toBeTruthy());
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('rejects non-finite host DOMRect coordinates before first WebGL allocation and during scene restore', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const validRect = {
    x: 12, y: 16, left: 12, top: 16, right: 312, bottom: 176,
    width: 300, height: 160, toJSON: () => ({}),
  } as DOMRect;
  let currentRect: DOMRect = { ...validRect, left: Number.NaN };
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label') === '校園地點空間圖'
        ? currentRect : originalRect.call(this);
    });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 1,
      intersectionRect: { width: 280, height: 160 } as DOMRect,
      boundingClientRect: validRect, rootBounds: validRect, intersectionRatio: 1,
    } satisfies IntersectionObserverEntry], {} as IntersectionObserver));
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');

    // This is a fresh, measurable host viewport, not a second observer permit.
    currentRect = validRect;
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    currentRect = { ...validRect, bottom: Number.POSITIVE_INFINITY };
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    currentRect = validRect;
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    bounds.mockRestore();
  }
});

it('blocks no-IntersectionObserver WebView when host DOMRect dimensions are non-finite', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const validRect = {
    x: 12, y: 16, left: 12, top: 16, right: 312, bottom: 176,
    width: 300, height: 160, toJSON: () => ({}),
  } as DOMRect;
  let currentRect: DOMRect = { ...validRect, width: Number.POSITIVE_INFINITY };
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label') === '校園地點空間圖'
        ? currentRect : originalRect.call(this);
    });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(scene.create).not.toHaveBeenCalled();

    currentRect = validRect;
    fireEvent(window, new Event('scroll'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    currentRect = { ...validRect, right: Number.NEGATIVE_INFINITY };
    fireEvent(window, new Event('scroll'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    currentRect = validRect;
    fireEvent(window, new Event('scroll'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    bounds.mockRestore();
  }
});


it('defers legacy WebView GPU for invalid layout viewport then pauses and resumes the same scene', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const validRect = {
    x: 12, y: 16, left: 12, top: 16, right: 312, bottom: 176,
    width: 300, height: 160, toJSON: () => ({}),
  } as DOMRect;
  const original = HTMLElement.prototype.getBoundingClientRect;
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label') === '校園地點空間圖' ? validRect : original.call(this);
    });
  try {
    vi.stubGlobal('innerWidth', Number.NaN);
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(scene.create).not.toHaveBeenCalled();

    vi.stubGlobal('innerWidth', width);
    fireEvent(window, new Event('scroll'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    vi.stubGlobal('innerHeight', Number.POSITIVE_INFINITY);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    vi.stubGlobal('innerHeight', height);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    bounds.mockRestore();
  }
});

it('requires restored layout viewport after positive observer before allocating WebGL', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const width = window.innerWidth;
  const height = window.innerHeight;
  const validRect = {
    x: 12, y: 16, left: 12, top: 16, right: 312, bottom: 176,
    width: 300, height: 160, toJSON: () => ({}),
  } as DOMRect;
  vi.stubGlobal('innerWidth', Number.POSITIVE_INFINITY);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue(validRect);
  try {
    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 100,
      intersectionRect: validRect, boundingClientRect: validRect,
      rootBounds: validRect, intersectionRatio: 1,
    } satisfies IntersectionObserverEntry], {} as IntersectionObserver));
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');

    vi.stubGlobal('innerWidth', width);
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    vi.stubGlobal('innerHeight', Number.NaN);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    vi.stubGlobal('innerHeight', height);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    bounds.mockRestore();
  }
});

it('refuses contradictory host DOMRect bounds until WebView layout recovers without rebuilding WebGL', async () => {
  // A mobile WebView can expose positive dimensions with collapsed edges
  // while keyboard, zoom or bfcache layout is being restored.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const validRect = {
    x: 12, y: 16, left: 12, top: 16, right: 312, bottom: 176,
    width: 300, height: 160, toJSON: () => ({}),
  } as DOMRect;
  const rect = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    ...validRect, right: validRect.left,
  });
  try {
    // The legacy viewport shim omits DOMRect coordinates, but the observer
    // entry itself must satisfy the complete browser type contract.
    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 1,
      intersectionRect: { width: 280, height: 160 } as DOMRect,
      boundingClientRect: validRect,
      rootBounds: validRect,
      intersectionRatio: 1,
    } satisfies IntersectionObserverEntry], {} as IntersectionObserver));
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');

    // An earlier positive observer record is not enough; valid current
    // host geometry is required before the first GPU allocation.
    rect.mockReturnValue(validRect);
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    rect.mockReturnValue({ ...validRect, bottom: validRect.top });
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);

    rect.mockReturnValue(validRect);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    rect.mockRestore();
  }
});

it('keeps legacy no-observer WebGL deferred when host edges contradict dimensions', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const validRect = {
    x: 12, y: 16, left: 12, top: 16, right: 312, bottom: 176,
    width: 300, height: 160, toJSON: () => ({}),
  } as DOMRect;
  let currentRect: DOMRect = { ...validRect, right: validRect.left };
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-label') === '校園地點空間圖'
      ? currentRect : originalRect.call(this);
  });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(scene.create).not.toHaveBeenCalled();

    currentRect = validRect;
    fireEvent(window, new Event('scroll'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    rect.mockRestore();
  }
});

it('does not allocate offscreen WebGL or start its deadline until the canvas enters view', async () => {
  // Override the normal on-screen observer fixture: a scrollable narrow
  // viewport can open the modal with the graphics below the fold.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(within(dialog).getByText(/滑動至空間圖後才載入/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create).not.toHaveBeenCalled();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(false);

    act(() => intersection?.([{ isIntersecting: false }] as IntersectionObserverEntry[],
      {} as IntersectionObserver));
    expect(scene.create).not.toHaveBeenCalled();

    act(() => intersection?.([{ isIntersecting: true }] as IntersectionObserverEntry[],
      {} as IntersectionObserver));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    timerSpy.mockRestore();
  }
});

it('does not start or resume WebGL when the canvas only touches the viewport edge', async () => {
  // IntersectionObserver may report isIntersecting=true on an edge-adjacent
  // target even when its intersection rectangle has zero visible area.
  // This synthetic case checks GPU activation boundaries, not phone FPS.
  let observedHost: Element | null = null;
  let options: IntersectionObserverInit | undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
      intersection = callback;
      options = init;
    }
    observe(target: Element) { observedHost = target; }
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  expect(observedHost).toBe(graphics);
  // Edge-touch and positive-area transitions can both have isIntersecting=true.
  // A second threshold is needed to receive the later visible-area callback.
  expect(options?.threshold).toEqual([0, 1e-9, 0.01]);
  expect(scene.create).not.toHaveBeenCalled();

  const notify = (time: number, width: number, height: number, coordinates: Record<string, number | undefined> = {}) => {
    const entries = [{
      isIntersecting: true, target: graphics, time,
      intersectionRect: { width, height, ...coordinates },
    }] as unknown as IntersectionObserverEntry[];
    act(() => intersection?.(entries, {} as IntersectionObserver));
  };
  const notifyThrowingRect = (time: number) => {
    const entries = [{
      isIntersecting: true, target: graphics, time,
      intersectionRect: {
        width: 280, height: 160,
        get left() { throw new Error('WebView DOMRect coordinate unavailable'); },
      },
    }] as unknown as IntersectionObserverEntry[];
    act(() => intersection?.(entries, {} as IntersectionObserver));
  };
  notify(100, 0, 160);
  // Invalid-but-present rectangles must not be treated as old WebViews that
  // omit intersectionRect. No GPU allocation should occur.
  for (const [index, width] of [Number.NaN, Number.POSITIVE_INFINITY, -2].entries()) {
    notify(101 + index, width, 160);
    expect(scene.create).not.toHaveBeenCalled();
  }
  // Dimensions alone are insufficient: broken WebViews may return a
  // positive area with invalid coordinates, or throw on DOMRect access.
  for (const [index, coordinate] of [
    { x: Number.NaN }, { y: Number.POSITIVE_INFINITY },
    { left: Number.NaN }, { top: Number.POSITIVE_INFINITY },
    { right: Number.NEGATIVE_INFINITY }, { bottom: Number.NaN },
  ].entries()) {
    notify(104 + index, 280, 160, coordinate);
    expect(scene.create).not.toHaveBeenCalled();
  }
  // An inconsistent WebView DOMRect can claim positive dimensions but
  // explicitly report an empty or inverted edge interval. Never allocate GPU.
  notify(109.1, 280, 160, { left: 20, right: 20 });
  notify(109.2, 280, 160, { top: 30, bottom: 10 });
  expect(scene.create).not.toHaveBeenCalled();
  notifyThrowingRect(109.5);
  expect(scene.create).not.toHaveBeenCalled();
  expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  notify(110, 280, 160);
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);

  notify(120, 280, 0);
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  // Invalid subsequent positive callbacks cannot reactivate a suspended GPU.
  for (const [index, width] of [Number.NaN, Number.POSITIVE_INFINITY, -2].entries()) {
    notify(121 + index, width, 160);
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
  }
  for (const [index, coordinate] of [
    { x: Number.NaN }, { y: Number.POSITIVE_INFINITY },
    { left: Number.NaN }, { top: Number.POSITIVE_INFINITY },
    { right: Number.NEGATIVE_INFINITY }, { bottom: Number.NaN },
  ].entries()) {
    notify(124 + index, 280, 160, coordinate);
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
  }
  notify(129.1, 280, 160, { left: 20, right: 20 });
  notify(129.2, 280, 160, { top: 30, bottom: 10 });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  notifyThrowingRect(129.5);
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  notify(130, 280, 160);
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('requests a callback between an edge touch and any visible sliver of the canvas', async () => {
  // IntersectionObserver only notifies when isIntersecting or the threshold
  // index changes. Edge touch (ratio 0) and a 0.5% sliver are both
  // intersecting, so the thresholds must place them at different indexes in
  // both directions. Mirrors the spec's threshold-index rule (W3C IO §3.2.8).
  let options: IntersectionObserverInit | undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(_callback: IntersectionObserverCallback, init?: IntersectionObserverInit) { options = init; }
    observe() {}
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const thresholds = options?.threshold as number[];
  const index = (ratio: number) => {
    const found = thresholds.findIndex((value) => value > ratio);
    return found === -1 ? thresholds.length : found;
  };
  // One CSS pixel row of a 2000×2000 canvas is still a visible sliver.
  for (const sliver of [0.005, 1 / (2000 * 2000), 0.009]) {
    expect(index(sliver)).not.toBe(index(0));
  }
  // float32 storage in browser engines must not round the tiny step to 0.
  expect(Math.fround(thresholds[1])).toBeGreaterThan(0);
});

it('uses the latest viewport state when a fast mobile scroll batches observer entries', async () => {
  // A queued offscreen state followed by onscreen in one callback must start
  // WebGL once. The inverse order must suspend it, not keep rendering offscreen.
  // These are synthetic browser callbacks, not measurements from a phone.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
  expect(scene.create).not.toHaveBeenCalled();

  act(() => intersection?.([
    { isIntersecting: false }, { isIntersecting: true },
  ] as IntersectionObserverEntry[], {} as IntersectionObserver));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
  expect(scene.setActive).toHaveBeenLastCalledWith(true);

  act(() => intersection?.([
    { isIntersecting: true }, { isIntersecting: false },
  ] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  // An empty callback is not evidence that the canvas became visible.
  const callsBeforeEmpty = scene.setActive.mock.calls.length;
  act(() => intersection?.([] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive.mock.calls.length).toBe(callsBeforeEmpty);

  act(() => intersection?.([
    { isIntersecting: false }, { isIntersecting: true },
  ] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);

  // Browser entries carry timestamps. If a WebView presents an older
  // transition last in a batch, follow the newest observation, not the
  // final array item. Test doubles above omit time to verify fallback.
  act(() => intersection?.([
    { isIntersecting: false, time: 220 }, { isIntersecting: true, time: 210 },
  ] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => intersection?.([
    { isIntersecting: true, time: 240 }, { isIntersecting: false, time: 230 },
  ] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);

  // A WebView may round two transitions within one callback to the same
  // timestamp. Prefer the final queued transition, not the first one.
  const tiedOffscreen = [
    { isIntersecting: true, time: 300 },
    { isIntersecting: false, time: 300 },
  ] as unknown as IntersectionObserverEntry[];
  act(() => intersection?.(tiedOffscreen, {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);

  const tiedOnscreen = [
    { isIntersecting: false, time: 310 },
    { isIntersecting: true, time: 310 },
  ] as unknown as IntersectionObserverEntry[];
  act(() => intersection?.(tiedOnscreen, {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);

  // Two callbacks can share a rounded timestamp. An equal-time offscreen
  // record must immediately suspend GPU instead of continuing to render offscreen.
  // The equally ambiguous positive record cannot override that safe pause.
  const tiedNegative = [{ isIntersecting: false, time: 310 }] as unknown as IntersectionObserverEntry[];
  act(() => intersection?.(tiedNegative, {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  const callsAfterTiedPause = scene.setActive.mock.calls.length;
  const tiedPositive = [{ isIntersecting: true, time: 310 }] as unknown as IntersectionObserverEntry[];
  act(() => intersection?.(tiedPositive, {} as IntersectionObserver));
  expect(scene.setActive.mock.calls.length).toBe(callsAfterTiedPause);
  // A genuinely newer visible observation can reuse the existing scene.
  const confirmedNewer = [{ isIntersecting: true, time: 311 }] as unknown as IntersectionObserverEntry[];
  act(() => intersection?.(confirmedNewer, {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('ignores foreign and older viewport callbacks without disabling walking navigation', async () => {
  // Synthetic WebView race: a callback for an unrelated element must not
  // allocate our scene, and a timestamp older than an already-processed
  // callback must not wake GPU rendering after the map has moved offscreen.
  let observedHost: Element | null = null;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe(target: Element) { observedHost = target; }
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  expect(observedHost).toBe(graphics);
  expect(scene.create).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  const foreign = document.createElement('div');
  act(() => intersection?.(([{ isIntersecting: true, time: 900, target: foreign }] as unknown as IntersectionObserverEntry[]), {} as IntersectionObserver));
  expect(scene.create).not.toHaveBeenCalled();
  expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');

  act(() => intersection?.(([{ isIntersecting: true, time: 100, target: graphics }] as unknown as IntersectionObserverEntry[]), {} as IntersectionObserver));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);

  act(() => intersection?.(([{ isIntersecting: false, time: 200, target: graphics }] as unknown as IntersectionObserverEntry[]), {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  const countBeforeDelayedCallback = scene.setActive.mock.calls.length;
  // Mobile WebViews may quantize observer timestamps. An equal-time callback
  // delivered in another batch is not proof that the map is back onscreen.
  const ambiguousTie = [{ isIntersecting: true, time: 200, target: graphics }] as unknown as IntersectionObserverEntry[];
  act(() => intersection?.(ambiguousTie, {} as IntersectionObserver));
  expect(scene.setActive.mock.calls.length).toBe(countBeforeDelayedCallback);
  act(() => intersection?.(([{ isIntersecting: true, time: 150, target: graphics }] as unknown as IntersectionObserverEntry[]), {} as IntersectionObserver));
  expect(scene.setActive.mock.calls.length).toBe(countBeforeDelayedCallback);
  expect(scene.create).toHaveBeenCalledTimes(1);

  act(() => intersection?.(([
    { isIntersecting: false, time: 225, target: foreign },
    { isIntersecting: true, time: 250, target: graphics },
  ] as unknown as IntersectionObserverEntry[]), {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('offers an accessible way to recover a suspended scene when mobile visibility stops updating', async () => {
  // Synthetic observer: after a real scene has started, a mobile WebView can
  // stop delivering visibility records. The canvas must not stay black with
  // no keyboard-accessible recovery, and normal recovery must reuse the scene.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) { intersection = callback; }
    observe(target: Element) {
      const entries = [{
        target, isIntersecting: true, time: 100,
        intersectionRect: { width: 280, height: 160 },
      }] as unknown as IntersectionObserverEntry[];
      this.callback(entries, this as unknown as IntersectionObserver);
    }
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const host = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const notify = (isIntersecting: boolean, time: number) => {
    const entries = [{
      target: host, isIntersecting, time,
      intersectionRect: { width: isIntersecting ? 280 : 0, height: isIntersecting ? 160 : 0 },
    }] as unknown as IntersectionObserverEntry[];
    act(() => intersection?.(entries, {} as IntersectionObserver));
  };

  notify(false, 200);
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  expect(within(dialog).getByText(/立體畫面已暫停/)).toBeTruthy();
  const recovery = within(dialog).getByRole('button', { name: '重新啟動立體畫面' });
  expect(recovery).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  notify(true, 300);
  expect(within(dialog).queryByRole('button', { name: '重新啟動立體畫面' })).toBeNull();
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);

  // No later callback arrives after the second pause. The explicit recovery
  // restarts one context, while preserving map keyboard focus and walking link.
  notify(false, 400);
  const retry = within(dialog).getByRole('button', { name: '重新啟動立體畫面' });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(host);
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(within(dialog).queryByRole('button', { name: '重新啟動立體畫面' })).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('does not let untimed WebView records override newer timestamped visibility', async () => {
  // A partially implemented mobile IntersectionObserver can mix entries
  // without time into a batch, and deliver old untimed callbacks later.
  // In neither case should an offscreen WebGL scene resume by mistake.
  let observedHost: Element | null = null;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe(target: Element) { observedHost = target; }
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  expect(observedHost).toBe(graphics);
  expect(scene.create).not.toHaveBeenCalled();

  const notify = (records: Array<{ isIntersecting: boolean; time?: number }>) => {
    const entries = records.map((record) => ({ ...record, target: graphics })) as unknown as IntersectionObserverEntry[];
    act(() => intersection?.(entries, {} as IntersectionObserver));
  };
  // An earlier timed on-screen entry remains valid even when an untimed
  // offscreen record happens to be last in the batch.
  notify([{ isIntersecting: true, time: 100 }, { isIntersecting: false }]);
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);

  notify([{ isIntersecting: false, time: 300 }, { isIntersecting: true }]);
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  const pausedCalls = scene.setActive.mock.calls.length;

  // No timestamp means no evidence that this record is newer; reject it
  // once the observer has established a trustworthy timestamp order.
  notify([{ isIntersecting: true }]);
  notify([{ isIntersecting: true, time: 250 }, { isIntersecting: true }]);
  expect(scene.setActive.mock.calls.length).toBe(pausedCalls);

  notify([{ isIntersecting: true, time: 400 }]);
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('ignores a queued visibility callback after the spatial dialog releases WebGL', async () => {
  // Some embedded WebViews still deliver a queued IntersectionObserver callback
  // after disconnect(). It must not call setActive on the disposed renderer.
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe(target: Element) {
      intersection?.([{ isIntersecting: true, target }] as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver);
    }
    disconnect = disconnect;
  });
  const { unmount } = render(<CampusSpatialExplorer school="other-school"
    locations={places} selected={places[0]} onSelect={vi.fn()} />);
  await open();
  expect(scene.setActive).toHaveBeenCalledWith(true);

  unmount();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
  scene.setActive.mockClear();
  act(() => intersection?.([{ isIntersecting: true }] as IntersectionObserverEntry[],
    {} as IntersectionObserver));
  expect(scene.setActive).not.toHaveBeenCalled();
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('keeps Save-Data browsers marker-only until explicit 3D consent, including after reopening', async () => {
  const previousConnection = Object.getOwnPropertyDescriptor(navigator, 'connection');
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData: true },
  });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    let dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const manual = await within(dialog).findByRole('button', { name: '仍要開啟立體畫面' });
    expect(within(dialog).getByText(/瀏覽器已開啟省流量模式/)).toBeTruthy();
    expect(scene.create).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟 Apple 地圖步行導航' })).toBeTruthy();

    manual.focus();
    fireEvent.click(manual);
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole('button', { name: '仍要開啟立體畫面' })).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('group', { name: '校園地點空間圖' }));
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    expect(screen.queryByRole('dialog', { name: '校園空間導覽' })).toBeNull();
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    await within(dialog).findByRole('button', { name: '仍要開啟立體畫面' });
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    if (previousConnection) Object.defineProperty(navigator, 'connection', previousConnection);
    else Reflect.deleteProperty(navigator, 'connection');
  }
});

it('does not transfer optional Providence OSM geometry in Save-Data before explicit 3D consent', async () => {
  const previousConnection = Object.getOwnPropertyDescriptor(navigator, 'connection');
  Object.defineProperty(navigator, 'connection', {
    configurable: true, value: { saveData: true },
  });
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    let dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(await within(dialog).findByText(/省流量模式已暫停下載靜宜建築輪廓/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scene.create).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟 Apple 地圖步行導航' })).toBeTruthy();
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '仍要開啟立體畫面' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/public/campus-footprints',
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await within(dialog).findByText('1 棟公開建築輪廓')).toBeTruthy();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings));

    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(await within(dialog).findByText(/省流量模式已暫停下載靜宜建築輪廓/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '仍要開啟立體畫面' })).toBeTruthy();
  } finally {
    if (previousConnection) Object.defineProperty(navigator, 'connection', previousConnection);
    else Reflect.deleteProperty(navigator, 'connection');
  }
});

it('lets a student manually start 3D if a WebView never reports canvas visibility', async () => {
  // The API exists and observe() succeeds, but the WebView never invokes its
  // callback. Avoid an infinite offscreen wait without eagerly allocating GPU.
  const observerDisconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = observerDisconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  expect(scene.create).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  const manual = within(dialog).getByRole('button', { name: '手動開啟立體畫面' });
  manual.focus();
  expect(document.activeElement).toBe(manual);

  fireEvent.click(manual);
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  // The manually launched button disappears; focus must stay in the tour.
  expect(document.activeElement).toBe(graphics);
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(graphics.getAttribute('tabindex')).toBe('0');
  expect(observerDisconnect).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).parentElement?.getAttribute('data-spatial-state')).toBe('ready');
  fireEvent(window, new Event('pageshow'));
  expect(scene.create).toHaveBeenCalledTimes(1);
  act(() => intersection?.([observerEntry(graphics, false)],
    {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  expect(scene.create).toHaveBeenCalledTimes(1);

  fireEvent.click(within(dialog).getByRole('button', { name: '重新啟動立體畫面' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  act(() => intersection?.([observerEntry(graphics, false)],
    {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 180));
  act(() => intersection?.([observerEntry(graphics, true, undefined, 1)],
    {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(2);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// Some embedded WebViews report a window-root intersection for pixels that
// are fully clipped by the scrollable modal. The automatic observer path must
// enforce the same dialog clipping check as manual startup before allocating
// mobile WebGL, without disabling external walking navigation.
it('keeps automatic WebGL deferred when an intersecting canvas is clipped by the dialog', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
  let top = 40;
  const originalRect = Element.prototype.getBoundingClientRect;
  const layout = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      if (this.matches('dialog')) return new DOMRect(0, 100, 400, 300);
      if (this.getAttribute('aria-label') === '校園地點空間圖') return new DOMRect(0, top, 320, 50);
      return originalRect.call(this);
    });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    // A broken observer says "visible" even though host y=40..90 lies
    // above the dialog's clipped content y=100..400.
    act(() => intersection?.([observerEntry(graphics, true, undefined, 1)],
      {} as IntersectionObserver));
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    // Scrolling the host into the actual dialog bounds plus a fresh positive
    // observation is sufficient; do not require manual start or a second GPU.
    top = 120;
    act(() => intersection?.([observerEntry(graphics, true, undefined, 2)],
      {} as IntersectionObserver));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
  } finally {
    layout.mockRestore();
  }
});

it.each(['silent', 'missing', 'constructor', 'observe', 'negative', 'callback'] as const)(
  'checks dialog clipping after manual startup with a %s observer',
  async (mode) => {
    const viewport = Object.assign(new EventTarget(), {
      width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
    });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('IntersectionObserver', mode === 'missing' ? undefined : class {
      constructor(callback: IntersectionObserverCallback) {
        if (mode === 'constructor') throw new Error('observer unavailable');
        intersection = callback;
      }
      observe() {
        if (mode === 'observe') throw new Error('registration failed');
      }
      disconnect = disconnect;
    });
    const props = { school: 'other-school', locations: places, selected: places[0], onSelect: vi.fn() };
    const view = render(<CampusSpatialExplorer {...props} />);
    // Force an initially offscreen host so the manual entry is available
    // even in WebViews whose automatic startup uses layout geometry.
    let top = window.innerHeight + 20;
    const originalRect = Element.prototype.getBoundingClientRect;
    const layout = vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        if (this.matches('dialog')) return new DOMRect(0, 100, 400, 300);
        if (this.getAttribute('aria-label') === '校園地點空間圖') return new DOMRect(0, top, 320, 50);
        return originalRect.call(this);
      });
    try {
      fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
      const dialog = screen.getByRole('dialog');
      const host = within(dialog).getByRole('group', { name: '校園地點空間圖' });
      top = 120;
      fireEvent.click(within(dialog).getByRole('button', { name: '手動開啟立體畫面' }));
      await waitFor(() => expect(scene.setActive).toHaveBeenLastCalledWith(true));
      fireEvent.scroll(dialog);
      expect(scene.setActive).toHaveBeenLastCalledWith(true);

      const notify = (isIntersecting: boolean, time: number) => act(() =>
        intersection?.([observerEntry(host, isIntersecting, undefined, time)], {} as IntersectionObserver));
      viewport.height = 110;
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      if (mode === 'negative') notify(false, 1);
      viewport.height = window.innerHeight;
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(scene.setActive).toHaveBeenLastCalledWith(true);

      if (mode === 'negative') {
        notify(false, 2);
        fireEvent.scroll(dialog);
        expect(scene.setActive).toHaveBeenLastCalledWith(false);
        notify(true, 3);
        expect(scene.setActive).toHaveBeenLastCalledWith(true);
      }
      // The host is still inside the window, but has scrolled above the dialog.
      top = 40;
      if (mode === 'callback' || mode === 'negative') notify(false, 4);
      else fireEvent.scroll(dialog);
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      top = 120;
      if (mode === 'callback') notify(true, 5);
      else fireEvent.scroll(dialog);
      expect(scene.setActive).toHaveBeenLastCalledWith(true);
      expect(scene.create).toHaveBeenCalledTimes(1);

      top = 40;
      fireEvent.scroll(dialog);
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      await act(async () => view.rerender(<CampusSpatialExplorer {...props} locations={places.slice(0, -1)} />));
      expect(scene.dispose).toHaveBeenCalledTimes(1);
      expect(scene.create).toHaveBeenCalledTimes(1);
      top = 120;
      fireEvent.scroll(dialog);
      await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
      expect(scene.setActive).toHaveBeenLastCalledWith(true);

      top = 40;
      fireEvent.scroll(dialog);
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
      const updates = scene.setActive.mock.calls.length;
      top = 120;
      fireEvent.scroll(window);
      if (mode === 'callback') notify(true, 6);
      expect(scene.setActive).toHaveBeenCalledTimes(updates);
      expect(scene.create).toHaveBeenCalledTimes(2);
      expect(scene.dispose).toHaveBeenCalledTimes(2);
    } finally {
      layout.mockRestore();
    }
  },
);

it.each(['location update', 'public outlines'] as const)(
  'waits for a fresh observer after manual startup, offscreen notification and %s',
  async (update) => {
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe = observe;
      disconnect() {}
    });
    const { library, body, buildings } = sourcedLibraryFootprintFixture();
    let resolveFootprints!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveFootprints = resolve;
    })));
    const school = update === 'public outlines' ? 'pu' : 'other-school';
    const locations = [library];
    const onSelect = vi.fn();
    const { rerender } = render(<CampusSpatialExplorer school={school} locations={locations}
      selected={library} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    fireEvent.click(within(dialog).getByRole('button', { name: '手動開啟立體畫面' }));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    const previousObserver = intersection;
    act(() => previousObserver?.([observerEntry(graphics, false)], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);

    if (update === 'public outlines') {
      await act(async () => resolveFootprints(new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      })));
      expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    } else {
      await act(async () => rerender(<CampusSpatialExplorer school={school}
        locations={[library, places[1]]} selected={library} onSelect={onSelect} />));
    }
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(intersection).not.toBe(previousObserver);
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(scene.create).toHaveBeenCalledTimes(1);

    vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 180));
    await act(async () => {
      previousObserver?.([observerEntry(graphics, true, undefined, 1)], {} as IntersectionObserver);
      fireEvent(window, new Event('resize'));
    });
    expect(scene.create).toHaveBeenCalledTimes(1);
    act(() => intersection?.([observerEntry(graphics, true)], {} as IntersectionObserver));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(update === 'public outlines' ? buildings : []);
  },
);

it.each(['location update', 'public outlines'] as const)(
  'keeps manual startup across %s with a silent observer',
  async (update) => {
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    });
    const { library, body, buildings } = sourcedLibraryFootprintFixture();
    let resolveFootprints!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveFootprints = resolve;
    })));
    const school = update === 'public outlines' ? 'pu' : 'other-school';
    const onSelect = vi.fn();
    const { rerender } = render(<CampusSpatialExplorer school={school} locations={[library]}
      selected={library} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(scene.create).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '手動開啟立體畫面' }));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));

    if (update === 'public outlines') {
      await act(async () => resolveFootprints(new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      })));
    } else {
      fireEvent(window, new Event('pagehide'));
      await act(async () => rerender(<CampusSpatialExplorer school={school}
        locations={[library, places[1]]} selected={library} onSelect={onSelect} />));
      expect(scene.create).toHaveBeenCalledTimes(1);
      fireEvent(window, new Event('pageshow'));
    }
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(update === 'public outlines' ? buildings : []);
  },
);

it('keeps manual 3D across school changes, view updates and context retry until the tour closes', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
  const props = { locations: places, selected: places[0], onSelect: vi.fn() };
  const { rerender } = render(<CampusSpatialExplorer school="school-a" {...props} />);
  const tour = () => within(screen.getByRole('dialog', { name: '校園空間導覽' }));
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  fireEvent.click(tour().getByRole('button', { name: '手動開啟立體畫面' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));

  rerender(<CampusSpatialExplorer school="school-b" {...props} />);
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  fireEvent.click(tour().getByRole('button', { name: '下一個地點' }));
  fireEvent(window, new Event('resize'));
  await act(async () => { document.documentElement.dataset.reducedMotion = 'true'; });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', motion: false }));
  expect(scene.create).toHaveBeenCalledTimes(2);

  act(() => scene.create.mock.calls.at(-1)?.[2].onError());
  fireEvent.click(tour().getByRole('button', { name: '重試立體畫面' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(3));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', motion: false }));

  fireEvent.click(tour().getByRole('button', { name: '關閉視窗' }));
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  expect(tour().getByRole('button', { name: '手動開啟立體畫面' })).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(3);
});

it('restores manual 3D startup after a background open with no WebView visibility reports', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect = disconnect;
  });
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    const walkingLink = within(dialog).getByRole('link', { name: '開啟步行導航' });
    const walkingHref = walkingLink.getAttribute('href');
    expect(walkingHref).toBeTruthy();
    expect(new URL(walkingHref!).searchParams.get('travelmode')).toBe('walking');
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(within(dialog).getByText(/目前位於背景分頁/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '手動開啟立體畫面' })).toBeNull();
    expect(scene.create).not.toHaveBeenCalled();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(false);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));
    await act(async () => { await Promise.resolve(); });
    expect(scene.create).not.toHaveBeenCalled();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(false);
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(within(dialog).queryByText(/目前位於背景分頁/)).toBeNull();
    expect(within(dialog).getByText(/滑動至空間圖後才載入.*可手動開啟/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')).toBe(walkingHref);

    fireEvent.click(within(dialog).getByRole('button', { name: '手動開啟立體畫面' }));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')).toBe(walkingHref);
  } finally {
    timerSpy.mockRestore();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it('still defers manual 3D startup if the tab backgrounds before the WebView import settles', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect = disconnect;
  });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const manual = within(dialog).getByRole('button', { name: '手動開啟立體畫面' });
  try {
    await act(async () => {
      fireEvent.click(manual);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      fireEvent(document, new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(scene.create).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/目前位於背景分頁，返回導覽後才會啟動立體畫面/)).toBeTruthy();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it('fully tears down WebGL and page listeners if WebView observer disconnect throws', async () => {
  const brokenDisconnect = vi.fn(() => { throw new Error('WebView disconnect failed'); });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target }] as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver);
    }
    disconnect = brokenDisconnect;
  });
  const windowRemove = vi.spyOn(window, 'removeEventListener');
  const documentRemove = vi.spyOn(document, 'removeEventListener');
  try {
    const { unmount } = render(<CampusSpatialExplorer school="other-school"
      locations={places} selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    // The WebView's broken disconnect must not interrupt the rest of cleanup.
    expect(() => unmount()).not.toThrow();
    expect(brokenDisconnect).toHaveBeenCalledTimes(1);
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    expect(windowRemove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(windowRemove).toHaveBeenCalledWith('pageshow', expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  } finally {
    windowRemove.mockRestore();
    documentRemove.mockRestore();
  }
});

it.each(['missing', 'constructor', 'observe'] as const)(
  'defers offscreen WebGL when the WebView observer is %s and resumes on container scroll',
  async (failurePoint) => {
    let onscreen = false;
    const originalRect = Element.prototype.getBoundingClientRect;
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        if (this.getAttribute('aria-label') !== '校園地點空間圖') return originalRect.call(this);
        const top = onscreen ? 24 : window.innerHeight + 40;
        return {
          x: 0, y: top, left: 0, top, right: 300, bottom: top + 180,
          width: 300, height: 180, toJSON: () => ({}),
        } as DOMRect;
      });
    if (failurePoint === 'missing') {
      vi.stubGlobal('IntersectionObserver', undefined);
    } else {
      vi.stubGlobal('IntersectionObserver', class {
        constructor(callback: IntersectionObserverCallback) {
          intersection = callback;
          if (failurePoint === 'constructor') throw new Error('unavailable observer');
        }
        observe() {
          if (failurePoint === 'observe') throw new Error('cannot observe host');
        }
        disconnect = disconnect;
      });
    }
    const timerSpy = vi.spyOn(window, 'setTimeout');
    try {
      const { unmount } = render(<CampusSpatialExplorer school="other-school"
        locations={places} selected={places[0]} onSelect={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
      const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
      const host = within(dialog).getByRole('group', { name: '校園地點空間圖' });
      expect(host.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
      expect(scene.create).not.toHaveBeenCalled();
      expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(false);
      expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

      // Scroll inside the dialog: no resize event and no working observer.
      onscreen = true;
      fireEvent.scroll(host.parentElement!);
      await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
      expect(scene.setActive).toHaveBeenLastCalledWith(true);

      onscreen = false;
      fireEvent.scroll(host.parentElement!);
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      onscreen = true;
      fireEvent.scroll(host.parentElement!);
      expect(scene.setActive).toHaveBeenLastCalledWith(true);
      expect(scene.create).toHaveBeenCalledTimes(1);
      expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

      unmount();
      const calls = scene.setActive.mock.calls.length;
      fireEvent.scroll(window);
      expect(scene.setActive).toHaveBeenCalledTimes(calls);
      expect(scene.dispose).toHaveBeenCalledTimes(1);
    } finally {
      timerSpy.mockRestore();
      rectSpy.mockRestore();
    }
  },
);

it('blocks legacy no-observer WebGL during an invalid VisualViewport and resumes from viewport events', async () => {
  // Some legacy WebViews omit IntersectionObserver while exposing a transient
  // zero-height VisualViewport during soft-keyboard and return transitions.
  vi.stubGlobal('IntersectionObserver', undefined);
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: 0, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  const originalRect = Element.prototype.getBoundingClientRect;
  const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      if (this.getAttribute('aria-label') !== '校園地點空間圖') return originalRect.call(this);
      return {
        x: 0, y: 24, left: 0, top: 24, right: 300, bottom: 204,
        width: 300, height: 180, toJSON: () => ({}),
      } as DOMRect;
    });
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    const { unmount } = render(<CampusSpatialExplorer school="other-school"
      locations={places} selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const host = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    expect(host.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(scene.create).not.toHaveBeenCalled();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(false);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    viewport.height = 0;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);

    unmount();
    const calls = scene.setActive.mock.calls.length;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(scene.setActive).toHaveBeenCalledTimes(calls);
    expect(scene.dispose).toHaveBeenCalledTimes(1);
  } finally {
    timerSpy.mockRestore();
    rectSpy.mockRestore();
  }
});

it.each(['constructor', 'observe'] as const)(
  'falls back to working 3D and walking navigation when a WebView observer fails at %s',
  async (failurePoint) => {
    const brokenDisconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
        if (failurePoint === 'constructor') throw new Error('unsupported observer');
      }
      observe() {
        if (failurePoint === 'observe') throw new Error('observer registration failed');
      }
      disconnect = brokenDisconnect;
    });
    render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
    const dialog = await open();
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    await waitFor(() => expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready'));
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(brokenDisconnect).toHaveBeenCalledTimes(failurePoint === 'observe' ? 1 : 0);
    // Even a failed constructor can leave a queued callback in a WebView.
    // Neither failure path may let it deactivate the eager fallback scene.
    const activeCalls = scene.setActive.mock.calls.length;
    act(() => intersection?.(([{ isIntersecting: false, target: graphics, time: 10 }] as unknown as IntersectionObserverEntry[]), {} as IntersectionObserver));
    expect(scene.setActive.mock.calls.length).toBe(activeCalls);
    expect(scene.setActive).not.toHaveBeenCalledWith(false);
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
  },
);

it('delays hidden-tab WebGL startup and its 12-second deadline until the tour is visible', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(within(dialog).getByText(/目前位於背景分頁，返回導覽後才會啟動立體畫面/)).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toContain('仍可查看地點與步行導航');
    expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(scene.create).not.toHaveBeenCalled();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(false);

    // Mobile restoration can fire pageshow while the document is still hidden.
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(true);
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(graphics.getAttribute('tabindex')).toBe('0');
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    timerSpy.mockRestore();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it('pauses in-flight 3D module startup when the tab backgrounds before import settles', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  // Open while visible, then suspend in the same React act before the lazy
  // Three.js module can resolve. The browser must not allocate WebGL in back.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    await Promise.resolve();
  });
  try {
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(scene.create).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('status').textContent).toContain('返回導覽後才會啟動立體畫面');
    expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});


it('defers WebGL after Safari pagehide before visibilitychange and resumes once on pageshow', async () => {
  // During bfcache navigation Safari may leave document.hidden === false.
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
    // Let React commit the dialog and register its pagehide listener first.
    // Putting both events in one async act batches the mount until *after*
    // pagehide, testing an impossible listener ordering rather than Safari.
    // Do not yield between the committed click and pagehide: the scene's
    // dynamic import still has to be in flight when the page is suspended.
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    fireEvent(window, new Event('pagehide'));
    await act(async () => { await Promise.resolve(); });
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(document.hidden).toBe(false);
    expect(scene.create).not.toHaveBeenCalled();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 12_000)).toBe(true);
    expect(within(dialog).getByRole('status').textContent).toContain('返回導覽後才會啟動立體畫面');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    timerSpy.mockRestore();
  }
});

it('suspends a ready WebGL scene on pagehide even without a hidden document', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  fireEvent(window, new Event('pagehide'));
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  expect(scene.dispose).not.toHaveBeenCalled();
  fireEvent(window, new Event('pageshow'));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  scene.setActive.mockClear();
  fireEvent(window, new Event('pageshow'));
  expect(scene.setActive).not.toHaveBeenCalled();
});

it('keeps WebGL suspended if scroll restoration moves the canvas offscreen before pageshow', async () => {
  // Synthetic Safari bfcache regression: the previous IntersectionObserver
  // entry said visible, but page restore scrolls the host outside the viewport.
  // No GPU restart until a new intersecting event confirms its position.
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const offscreenTop = window.innerHeight + 120;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: offscreenTop, left: 0, top: offscreenTop,
    right: 320, bottom: offscreenTop + 180, width: 320, height: 180,
    toJSON: () => ({}),
  } as DOMRect);
  try {
    fireEvent(window, new Event('pagehide'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    bounds.mockReturnValue({
      x: 0, y: 0, left: 0, top: 0,
      right: 320, bottom: 180, width: 320, height: 180,
      toJSON: () => ({}),
    } as DOMRect);
    act(() => intersection?.([{
      isIntersecting: true, target: graphics,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    bounds.mockRestore();
  }
});

it.each(['observer', 'viewport'])('recovers iOS WebGL when %s detects visual offscreen first', async (firstEvent) => {
  // On Safari the keyboard or pinch zoom can shrink/offset visualViewport
  // while innerHeight stays unchanged and the observer is delayed.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const top = window.innerHeight - 40;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: top, left: 0, top, right: 320, bottom: top + 180,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    viewport.height = top - 10;
    if (firstEvent === 'observer') {
      act(() => intersection?.([observerEntry(graphics, true, new DOMRect(0, top, 320, 40), 99)],
        {} as IntersectionObserver));
    } else {
      act(() => viewport.dispatchEvent(new Event('resize')));
    }
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    // Some iOS WebViews never emit a new intersection record when the soft
    // keyboard closes. A positive viewport measurement must resume the SAME
    // already-created scene without a new observer callback.
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByRole('button', { name: '重新啟動立體畫面' })).toBeNull();

    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 100,
      intersectionRect: { width: 320, height: 40 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);

    // Pinch/pan can move the visual viewport without changing its size.
    viewport.offsetTop = top + 200;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.create).toHaveBeenCalledTimes(1);
    // Reversing just the visual viewport scroll also has no reliable observer
    // delivery; this must recover without a manual restart or context reload.
    viewport.offsetTop = 0;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    viewport.height = top - 10;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    scene.setActive.mockClear();
    viewport.height = window.innerHeight;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('keeps VisualViewport scroll recovery and cleans up after broken resize event APIs', async () => {
  // Some embedded iOS WebViews throw only for resize subscriptions. The
  // independent scroll subscription is then the sole keyboard/pinch signal.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  });
  const add = vi.spyOn(viewport, 'addEventListener').mockImplementation((type, callback, options) => {
    if (type === 'resize') throw new Error('resize subscription unavailable');
    return EventTarget.prototype.addEventListener.call(viewport, type, callback, options);
  });
  const remove = vi.spyOn(viewport, 'removeEventListener').mockImplementation((type, callback, options) => {
    if (type === 'resize') throw new Error('resize cleanup unavailable');
    return EventTarget.prototype.removeEventListener.call(viewport, type, callback, options);
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const top = window.innerHeight - 40;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: top, left: 0, top, right: 320, bottom: top + 180,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    // The layout viewport and observer remain unchanged; only the visual
    // viewport scroll event can stop unnecessary offscreen GPU work.
    viewport.height = top - 10;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    scene.setActive.mockClear();
    viewport.height = 1;
    viewport.dispatchEvent(new Event('scroll'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
    add.mockRestore();
    remove.mockRestore();
  }
});

it('recovers a transient Safari scroll subscription failure without replacing VisualViewport', async () => {
  // A WebView may reject scroll listener registration only during the first
  // keyboard transition, then keep the same viewport instance on pageshow.
  // A one-time registration attempt would miss all later scroll-only changes.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  let rejectScroll = true;
  const add = vi.spyOn(viewport, 'addEventListener').mockImplementation((type, callback, options) => {
    if (type === 'scroll' && rejectScroll) throw new Error('scroll listener temporarily unavailable');
    return EventTarget.prototype.addEventListener.call(viewport, type, callback, options);
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const top = window.innerHeight - 40;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: top, left: 0, top, right: 320, bottom: top + 180,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    expect(add.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    // No scroll subscription was installed, so this event cannot pause the GPU.
    viewport.height = top - 10;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    // Same object, no fresh IntersectionObserver callback or window resize.
    rejectScroll = false;
    viewport.height = window.innerHeight;
    fireEvent(window, new Event('pageshow'));
    expect(add.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2);
    viewport.height = top - 10;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    viewport.height = top - 10;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
    add.mockRestore();
  }
});

it('starts deferred Safari 3D on foreground visibilitychange without pageshow or viewport events', async () => {
  // A normal browser tab switch (unlike bfcache) may only deliver
  // visibilitychange. The initial observer was positive, but height=0
  // prevented its first WebGL allocation until the tab comes back.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: 0, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    expect(scene.create).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    viewport.height = window.innerHeight;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    // No pageshow, resize, scroll or new observer notification.
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent(document, new Event('visibilitychange'));
    expect(scene.create).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    fireEvent(document, new Event('visibilitychange'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it.each(['pageshow', 'visibilitychange'] as const)(
  'starts Safari 3D on resize after a temporarily invalid viewport on %s',
  async (foregroundEvent) => {
    const viewport = Object.assign(new EventTarget(), {
      width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
    });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe() {}
      disconnect() {}
    });
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 320, 180));
    const target = foregroundEvent === 'pageshow' ? window : document;
    const backgroundEvent = foregroundEvent === 'pageshow' ? 'pagehide' : 'visibilitychange';
    try {
      if (target === document) Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      fireEvent(target, new Event(backgroundEvent));
      act(() => intersection?.([observerEntry(graphics, true)], {} as IntersectionObserver));
      expect(scene.create).not.toHaveBeenCalled();

      viewport.height = 0;
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      await act(async () => fireEvent(target, new Event(foregroundEvent)));
      expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
      expect(scene.create).not.toHaveBeenCalled();

      viewport.height = window.innerHeight;
      act(() => viewport.dispatchEvent(new Event('resize')));
      await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
      expect(scene.setActive).toHaveBeenLastCalledWith(true);
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    }
  },
);

it('resumes existing Safari 3D on foreground visibilitychange without pageshow or viewport events', async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    viewport.height = 0;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    viewport.height = window.innerHeight;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    // A tab return does not necessarily trigger bfcache pageshow.
    fireEvent(document, new Event('visibilitychange'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    fireEvent(document, new Event('visibilitychange'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it('keeps a viewport-paused 3D scene suspended while iOS VisualViewport reports invalid bounds', async () => {
  // Safari keyboard and pinch transitions can briefly expose 0/NaN dimensions.
  // The larger layout viewport must not count as proof that an obscured canvas
  // has re-entered the actually visible region.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const top = window.innerHeight - 40;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: top, left: 0, top, right: 320, bottom: top + 180,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    viewport.height = top - 10;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    const callsBeforeInvalid = scene.setActive.mock.calls.length;
    for (const invalidHeight of [0, Number.NaN, -1]) {
      viewport.height = invalidHeight;
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
    }
    viewport.height = window.innerHeight;
    viewport.offsetTop = Number.NaN;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.setActive.mock.calls.slice(callsBeforeInvalid)
      .every(([enabled]) => enabled === false)).toBe(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    // Only valid positive visual-viewport geometry can recover this pause.
    viewport.offsetTop = 0;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('does not reactivate Safari WebGL from a queued observer entry while visual viewport bounds are invalid', async () => {
  // A WebView may deliver an apparently current positive intersection while
  // the visual viewport is briefly 0/NaN during soft-keyboard or zoom changes.
  // A stale callback must not bypass the fail-closed viewport resize gate.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 80, left: 0, top: 80, right: 320, bottom: 260,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  const notify = (time: number) => {
    act(() => intersection?.([{
      target: graphics, time, isIntersecting: true,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
  };
  try {
    for (const invalidHeight of [0, Number.NaN]) {
      viewport.height = invalidHeight;
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      const pausedAt = scene.setActive.mock.calls.length;
      notify(1000 + pausedAt);
      expect(scene.setActive.mock.calls.slice(pausedAt)
        .every(([enabled]) => enabled === false)).toBe(true);
      expect(scene.create).toHaveBeenCalledTimes(1);
      expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    }

    // Recover without another observer callback once the viewport is valid.
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);

    // A bfcache restore cannot bypass the same guard either.
    fireEvent(window, new Event('pagehide'));
    viewport.offsetTop = Number.NaN;
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    // The invalid geometry was first noticed by pageshow, not resize or
    // IntersectionObserver. Once Safari reports valid bounds, the EXISTING
    // scene must recover without another observer entry or manual retry.
    const callsWhileInvalid = scene.setActive.mock.calls.length;
    viewport.offsetTop = 0;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.setActive.mock.calls.length).toBeGreaterThan(callsWhileInvalid);
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByRole('button', { name: '重新啟動立體畫面' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    viewport.dispatchEvent(new Event('resize'));
    notify(2000);
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('keeps Safari WebGL paused when a VisualViewport getter throws, then recovers', async () => {
  // A partially implemented iOS WebView can expose the API but throw while
  // reading a property during keyboard/bfcache restoration. A queued positive
  // observer entry must not wake the GPU or bypass the fail-closed pause.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 80, left: 0, top: 80, right: 320, bottom: 260,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    Object.defineProperty(viewport, 'height', {
      configurable: true,
      get() { throw new Error('transient visual viewport read failure'); },
    });
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    const pausedAt = scene.setActive.mock.calls.length;
    act(() => intersection?.([{
      target: graphics, time: 4100, isIntersecting: true,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive.mock.calls.slice(pausedAt)
      .every(([enabled]) => enabled === false)).toBe(true);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    // Safari recovers the getter but emits no second IntersectionObserver.
    Object.defineProperty(viewport, 'height', {
      configurable: true, writable: true, value: window.innerHeight,
    });
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    viewport.dispatchEvent(new Event('resize'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('starts first WebGL after the keyboard stops hiding a positively intersecting host', async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: 300, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect() {}
  });
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const host = screen.getByRole('group', { name: '校園地點空間圖' });
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 320, 180));

  act(() => intersection?.([observerEntry(host, true, new DOMRect(0, 400, 320, 180))], {} as IntersectionObserver));
  expect(scene.create).not.toHaveBeenCalled();
  expect(host.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');

  viewport.height = window.innerHeight;
  act(() => viewport.dispatchEvent(new Event('resize')));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
});

it('starts first WebGL render after Safari initial invalid VisualViewport recovers without another observer callback', async () => {
  // The initial positive observer callback can race a keyboard transition
  // which temporarily exposes height=0. We must not start then, but a valid
  // measurable on-screen viewport later is sufficient to finish the two gates.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: 0, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    // The default observer mock has already delivered a positive intersection.
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    // A viewport event does not create a second Three.js scene.
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(scene.create).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    viewport.dispatchEvent(new Event('resize'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('starts deferred first WebGL on Safari pageshow when VisualViewport becomes valid with no resize event', async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: 0, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    // The first observer was positive, but invalid iOS geometry blocked startup.
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    fireEvent(window, new Event('pagehide'));
    viewport.height = window.innerHeight;
    // Safari may restore a valid viewport only on pageshow. No resize/scroll
    // or second intersection callback is dispatched in this regression.
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('ready');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent(window, new Event('pageshow'));
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    bounds.mockRestore();
  }
});

it('resumes an existing Safari 3D scene on pageshow after invalid VisualViewport without a resize event', async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    fireEvent(window, new Event('pagehide'));
    viewport.height = 0;
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    fireEvent(window, new Event('pagehide'));
    viewport.height = window.innerHeight;
    // An accessible recovery no longer depends on the WebView sending a
    // VisualViewport event or another IntersectionObserver notification.
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('cancels pending first WebGL startup if a newer observer record says the map is offscreen', async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: Number.NaN, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    expect(scene.create).not.toHaveBeenCalled();
    // A later negative observer entry invalidates the pending initial permit,
    // even if the host's layout rectangle appears on screen.
    act(() => intersection?.([{
      target: graphics, time: 20, isIntersecting: false,
      intersectionRect: { width: 0, height: 0 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.create).not.toHaveBeenCalled();
    expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    // A fresh positive observer record remains required after that denial.
    act(() => intersection?.([{
      target: graphics, time: 21, isIntersecting: true,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
  } finally {
    bounds.mockRestore();
  }
});

it('does not resume WebGL after a newer offscreen observer cancels viewport recovery', async () => {
  // An invalid Safari viewport can pause a scene before the observer reports
  // that the host has moved offscreen. Once the *newer* negative entry
  // arrives, a viewport resize alone must not override that observation.
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', viewport);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 20, left: 0, top: 20,
    right: 320, bottom: 200, width: 320, height: 180,
    toJSON: () => ({}),
  } as DOMRect);
  try {
    viewport.height = 0;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);

    act(() => intersection?.([{
      target: graphics, time: 300, isIntersecting: false,
      intersectionRect: { width: 0, height: 0 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    // The geometry is measurable again, but the *latest observer* explicitly
    // revoked visibility. There is no new affirmative observer evidence.
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    act(() => intersection?.([{
      target: graphics, time: 301, isIntersecting: true,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('pauses a ready mobile WebGL scene when viewport resize moves the host offscreen', async () => {
  // Rotating the device or showing the soft keyboard can change viewport
  // height before IntersectionObserver delivers its next callback.
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const height = window.innerHeight;
  const top = height - 50;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: top, left: 0, top,
    right: 320, bottom: top + 150, width: 320, height: 150,
    toJSON: () => ({}),
  } as DOMRect);
  try {
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    vi.stubGlobal('innerHeight', height - 100);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    vi.stubGlobal('innerHeight', height);
    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 100,
      intersectionRect: { width: 320, height: 50 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});

it('ignores a late positive viewport notification when Safari restored the host offscreen', async () => {
  // A queued observer event can arrive *after* pageshow with a new timestamp
  // even though its intersection rectangle describes the pre-restore scroll.
  // It must not undo the current DOM-position guard or wake the mobile GPU.
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const offscreenTop = window.innerHeight + 80;
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: offscreenTop, left: 0, top: offscreenTop,
    right: 320, bottom: offscreenTop + 180, width: 320, height: 180,
    toJSON: () => ({}),
  } as DOMRect);
  try {
    fireEvent(window, new Event('pagehide'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);

    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 100,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: '重新啟動立體畫面' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    bounds.mockReturnValue({
      x: 0, y: 0, left: 0, top: 0,
      right: 320, bottom: 180, width: 320, height: 180,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent(window, new Event('resize'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);

    act(() => intersection?.([{
      isIntersecting: true, target: graphics, time: 101,
      intersectionRect: { width: 320, height: 180 },
    }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    bounds.mockRestore();
  }
});

it('does not start hidden-tab WebGL after the spatial dialog is closed', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    expect(scene.create).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'));
      fireEvent(window, new Event('pageshow'));
      await Promise.resolve();
    });
    expect(scene.create).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  }
});

it('opens graphics only on request, uses the current places, and leaves selection unchanged on close', async () => {
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={onSelect} />);
  const opener = screen.getByRole('button', { name: '空間導覽' });
  opener.focus();
  expect(scene.create).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  const dialog = await open();
  expect(scene.create.mock.calls[0][1].points.map((point: { id: string }) => point.id)).toEqual(['library', 'dorm']);
  expect(screen.queryByText('主顧樓')).toBeNull();
  expect(within(dialog).getByText(/不代表建築外觀或室內動線/)).toBeTruthy();
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(scene.setView).toHaveBeenLastCalledWith({ selectedId: null, overhead: false, motion: true, dark: false, bearing: DEFAULT_SPATIAL_BEARING, zoom: 1 });
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(opener);
});

it('connects scene markers, the progress control, directions and the original map selection', async () => {
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={onSelect} />);
  const dialog = await open();
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'library' }));
  const callbacks = scene.create.mock.calls[0][2];
  act(() => callbacks.onSelect('dorm'));
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  const directionLink = within(dialog).getByRole('link', { name: '開啟步行導航' });
  const directions = new URL(directionLink.getAttribute('href')!);
  expect(directions.searchParams.get('destination')).toBe('24.228,120.582');
  expect(directions.searchParams.get('travelmode')).toBe('walking');
  // A point location is not a surveyed entrance or an accessible walking path.
  // The on-screen warning must also be linked to the outgoing route for assistive tech.
  const warning = within(dialog).getByText(/導航僅以目前地點標記為目的地.*並非已核實的校舍入口/);
  expect(directionLink.getAttribute('aria-describedby')).toBe(warning.id);
  expect(warning.textContent).toContain('無障礙動線');
  expect(within(dialog).getByRole('button', { name: '下一個地點' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(within(dialog).getByRole('slider'), { target: { value: '0' } });
  expect(within(dialog).getByRole('slider').getAttribute('aria-valuetext')).toContain('本校圖書館');
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '俯視' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', overhead: true }));
  fireEvent.click(within(dialog).getByRole('button', { name: '在平面地圖查看' }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(places[1]);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
});

it('controls camera without changing the place or recreating its context and resets framing after selection', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).tabIndex).toBe(0);
  fireEvent.click(within(dialog).getByRole('button', { name: '向右旋轉' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'library', bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1.25 }));
  const scaleAnnouncement = within(dialog).getByText('視角方位 57° · 縮放 125%');
  expect(scaleAnnouncement.getAttribute('role')).toBe('status');
  expect(scaleAnnouncement.getAttribute('aria-live')).toBe('polite');
  expect(scaleAnnouncement.getAttribute('aria-atomic')).toBe('true');
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '看全部地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null, bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1.25 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '回到北向' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 0, zoom: 1.25 }));
  expect(within(dialog).getByText('視角方位 0° · 縮放 125%')).toBeTruthy();
  expect(within(dialog).getByText('畫面北向').parentElement?.querySelector('g')?.getAttribute('transform')).toBe('rotate(0 20 20)');
  const restoreZoom = within(dialog).getByRole('button', { name: '還原 100% 縮放' }) as HTMLButtonElement;
  expect(restoreZoom.disabled).toBe(false);
  fireEvent.click(restoreZoom);
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null, bearing: 0, zoom: 1 }));
  expect(within(dialog).getByText('視角方位 0° · 縮放 100%')).toBeTruthy();
  expect(restoreZoom.disabled).toBe(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('reflects gesture camera changes in accessible bounded controls without reloading graphics', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const changed = scene.create.mock.calls[0][2].onCameraChange;
  act(() => changed({ bearing: 420, zoom: 9 }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 60, zoom: MAX_SPATIAL_ZOOM }));
  const zoomIn = within(dialog).getByRole('button', { name: '放大空間圖' }) as HTMLButtonElement;
  expect(zoomIn.disabled).toBe(true);
  expect(zoomIn.hasAttribute('aria-disabled')).toBe(false);
  const callsAtMaximum = scene.setView.mock.calls.length;
  fireEvent.click(zoomIn);
  expect(scene.setView).toHaveBeenCalledTimes(callsAtMaximum);
  expect(within(dialog).getByText('視角方位 60° · 縮放 250%')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '向左旋轉' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 30, zoom: MAX_SPATIAL_ZOOM }));
  expect(within(dialog).getByText('視角方位 30° · 縮放 250%')).toBeTruthy();
  act(() => changed({ bearing: -60, zoom: 0 }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 300, zoom: MIN_SPATIAL_ZOOM }));
  expect(within(dialog).getByText('視角方位 300° · 縮放 65%')).toBeTruthy();
  const zoomOut = within(dialog).getByRole('button', { name: '縮小空間圖' }) as HTMLButtonElement;
  expect(zoomOut.disabled).toBe(true);
  expect(zoomOut.hasAttribute('aria-disabled')).toBe(false);
  const callsAtMinimum = scene.setView.mock.calls.length;
  fireEvent.click(zoomOut);
  expect(scene.setView).toHaveBeenCalledTimes(callsAtMinimum);
  const restoreZoom = within(dialog).getByRole('button', { name: '還原 100% 縮放' }) as HTMLButtonElement;
  expect(restoreZoom.disabled).toBe(false);
  fireEvent.click(restoreZoom);
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'library', bearing: 300, zoom: 1 }));
  expect(within(dialog).getByText('視角方位 300° · 縮放 100%')).toBeTruthy();
  expect(restoreZoom.disabled).toBe(true);
  expect(within(dialog).getByRole('heading', { name: '本校圖書館' })).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('keeps real place information and navigation available after WebGL failure and permits a retry', async () => {
  scene.create.mockImplementationOnce(() => { throw new Error('WebGL unavailable'); });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/這次無法顯示立體畫面/)).toBeTruthy();
  expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).tabIndex).toBe(-1);
  expect(within(dialog).queryByRole('group', { name: '調整空間視角' })).toBeNull();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  const retry = within(dialog).getByRole('button', { name: '重試立體畫面' });
  retry.focus();
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  // The retry button disappears. Focus must not fall back to the page body.
  expect(document.activeElement).toBe(within(dialog).getByRole('group', { name: '校園地點空間圖' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm' }));
});

it('disposes a lost graphics context and retains the selected place', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[1]} onSelect={vi.fn()} />);
  const dialog = await open();
  act(() => scene.create.mock.calls[0][2].onError());
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(scene.dispose).toHaveBeenCalledTimes(1);
});

it('does not create a late scene after closing during the import', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  fireEvent.click(screen.getByRole('button', { name: '關閉視窗' }));
  await act(async () => {});
  expect(scene.create).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('applies live system and site motion preferences without recreating the graphics context', async () => {
  document.documentElement.dataset.reducedMotion = 'true';
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: false }));
  await act(async () => { document.documentElement.dataset.reducedMotion = 'false'; });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: true }));
  act(() => {
    const reduced = media.get('(prefers-reduced-motion: reduce)')!;
    reduced.matches = true;
    reduced.listeners.forEach((notify) => notify());
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', motion: false }));
  await act(async () => { document.documentElement.dataset.theme = 'dark'; });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ dark: true, motion: false }));
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('keeps motion and theme preferences reactive on Safari with legacy MediaQueryList listeners', async () => {
  const legacyMedia = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!legacyMedia.has(query)) legacyMedia.set(query, { matches: false, listeners: new Set() });
    const entry = legacyMedia.get(query)!;
    return {
      get matches() { return entry.matches; },
      // Older iOS Safari exposes only addListener/removeListener.
      addListener: (notify: () => void) => entry.listeners.add(notify),
      removeListener: (notify: () => void) => entry.listeners.delete(notify),
    };
  });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const motion = legacyMedia.get('(prefers-reduced-motion: reduce)')!;
  const theme = legacyMedia.get('(prefers-color-scheme: dark)')!;
  expect(motion.listeners.size).toBe(1);
  expect(theme.listeners.size).toBe(1);
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: true, dark: false }));
  act(() => {
    motion.matches = true;
    motion.listeners.forEach((notify) => notify());
  });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: false, dark: false }));
  act(() => {
    theme.matches = true;
    theme.listeners.forEach((notify) => notify());
  });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: false, dark: true }));
  expect(scene.create).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(motion.listeners.size).toBe(0);
  expect(theme.listeners.size).toBe(0);
});

it('suspends graphics when the page is hidden or the canvas is outside the viewport', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  await open();
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    intersection?.([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => intersection?.([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
});

it('preserves single-source warnings and their exact source links', async () => {
  const parking = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-parking-p1')!;
  render(<CampusSpatialExplorer school="pu" locations={[parking]} selected={parking} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(within(dialog).getByText(/僅有單一資料來源/)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '查看地點資料來源 ↗' }).getAttribute('href')).toBe(parking.sourceUrl);
  expect(within(dialog).getByRole('slider').hasAttribute('disabled')).toBe(true);
  expect(within(dialog).getByRole('button', { name: '上一個地點' }).hasAttribute('disabled')).toBe(true);
});

it('does not offer an empty tour and rejects points spread across distant campuses', async () => {
  const view = render(<CampusSpatialExplorer school="other-school" locations={[]} selected={null} onSelect={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '空間導覽' })).toBeNull();
  view.rerender(<CampusSpatialExplorer school="other-school" locations={[places[0], { ...places[1], lat: 25.04, lng: 121.53 }]} selected={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  expect(screen.getByText(/範圍超出單一校區/)).toBeTruthy();
  expect(scene.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回平面地圖' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('destroys old-school graphics and exposes only the replacement school after remounting', async () => {
  const view = render(<CampusSpatialExplorer key="school-a" school="school-a" locations={places} selected={null} onSelect={vi.fn()} />);
  await open();
  const replacement = { ...places[0], id: 'new-library', name: '另一校圖書館' };
  view.rerender(<CampusSpatialExplorer key="school-b" school="school-b" locations={[replacement]} selected={null} onSelect={vi.fn()} />);
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('option', { name: '另一校圖書館' })).toBeTruthy();
  // The camera now has its own live status; scope this assertion to the
  // place guidance so adding accessible announcements cannot break school isolation.
  const guidance = within(screen.getByRole('dialog', { name: '校園空間導覽' }))
    .getByText('請選擇地點，確認位置後再開啟導航。');
  expect(guidance.getAttribute('role')).toBe('status');
  expect(screen.queryByRole('heading', { name: '本校圖書館' })).toBeNull();
  expect(scene.create.mock.calls[1][1].points.map((point: { id: string }) => point.id)).toEqual(['new-library']);
});

it('closes an emptied tour and does not reopen it when location data returns', async () => {
  const props = { school: 'other-school', selected: null, onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} locations={places} />);
  await open();
  view.rerender(<CampusSpatialExplorer {...props} locations={[]} />);
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  view.rerender(<CampusSpatialExplorer {...props} locations={places} />);
  expect(screen.getByRole('button', { name: '空間導覽' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('withdraws inherited navigation when a source makes the original automatic match ambiguous', async () => {
  const props = { school: 'other-school', onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} locations={places} selected={places[0]} />);
  const dialog = await open();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  // The old ID can still exist; the parent has withdrawn its automatic choice.
  view.rerender(<CampusSpatialExplorer {...props} locations={places} selected={null} />);
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null }));
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  view.rerender(<CampusSpatialExplorer {...props} locations={[...places]} selected={null} />);
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('requires a fresh choice when the selected location disappears instead of using the first replacement', async () => {
  const props = { school: 'other-school', onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} locations={places} selected={places[0]} />);
  const dialog = await open();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  const replacement = { ...places[1], id: 'replacement-dorm' };
  view.rerender(<CampusSpatialExplorer {...props} locations={[replacement]} selected={null} />);
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(within(dialog).queryByRole('heading', { name: '本校宿舍' })).toBeNull();
  const missingGuidance = within(dialog).getByText(/先前選擇的地點已變更或不在目前地圖範圍/);
  expect(missingGuidance.getAttribute('role')).toBe('status');
  expect(missingGuidance.getAttribute('aria-live')).toBe('polite');
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(within(dialog).getByRole('button', { name: '看全部地點' }).getAttribute('aria-pressed')).toBe('true');
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null }));

  view.rerender(<CampusSpatialExplorer {...props} locations={places} selected={places[0]} />);
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(within(dialog).queryByRole('link', { name: '開啟 Apple 地圖步行導航' })).toBeNull();
});

it('requires a fresh choice when the source reuses an inherited POI ID at a different destination', async () => {
  const onSelect = vi.fn();
  const props = { school: 'other-school', onSelect };
  const view = render(<CampusSpatialExplorer {...props} locations={places} selected={places[0]} />);
  const dialog = await open();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  const replacement = { ...places[0], lat: places[0].lat + 0.002, name: '新圖書館' };
  view.rerender(<CampusSpatialExplorer {...props} locations={[replacement, places[1]]} selected={places[0]} />);
  // The stale destination must disappear synchronously from the accessible
  // controls. A changed model intentionally disposes the previous WebGL
  // scene and asynchronously imports/creates the replacement scene, so its
  // setView() call is not guaranteed during the same React render tick.
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(within(dialog).queryByRole('link', { name: '開啟 Apple 地圖步行導航' })).toBeNull();
  const changedGuidance = within(dialog).getByText(/先前選擇的地點已變更或不在目前地圖範圍/);
  expect(changedGuidance.getAttribute('role')).toBe('status');
  expect(changedGuidance.getAttribute('aria-atomic')).toBe('true');
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(scene.create).toHaveBeenCalledTimes(2);
    expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null }));
  });

  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: replacement.id } });
  expect(within(dialog).queryByText(/先前選擇的地點已變更或不在目前地圖範圍/)).toBeNull();
  const directions = new URL(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  expect(directions.searchParams.get('destination')).toBe(`${replacement.lat},${replacement.lng}`);
  const updatedApple = new URL(within(dialog).getByRole('link', { name: '開啟 Apple 地圖步行導航' }).getAttribute('href')!);
  expect(updatedApple.searchParams.get('daddr')).toBe(`${replacement.lat},${replacement.lng}`);
  expect(updatedApple.searchParams.get('dirflg')).toBe('w');
  fireEvent.click(within(dialog).getByRole('button', { name: '在平面地圖查看' }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(replacement);
});

it('revokes a deliberate 3D choice if its ID is reused at a changed coordinate, even with the same name', async () => {
  const onSelect = vi.fn();
  const props = { school: 'other-school', selected: null, onSelect };
  const view = render(<CampusSpatialExplorer {...props} locations={places} />);
  const dialog = await open();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  const movedDorm = { ...places[1], lng: places[1].lng + 0.003 };
  view.rerender(<CampusSpatialExplorer {...props} locations={[places[0], movedDorm]} />);
  expect(within(dialog).queryByText(/先前選擇的地點已變更或不在目前地圖範圍/)).toBeTruthy();
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(onSelect).not.toHaveBeenCalled();

  view.rerender(<CampusSpatialExplorer {...props} locations={places} />);
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(within(dialog).queryByRole('link', { name: '開啟 Apple 地圖步行導航' })).toBeNull();

  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  const directions = new URL(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  expect(directions.searchParams.get('destination')).toBe(`${places[1].lat},${places[1].lng}`);
  expect(within(dialog).getByRole('heading', { name: movedDorm.name })).toBeTruthy();
});

it('opens a scoped building preview with one dialog and releases the campus graphics', async () => {
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={onSelect} />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: '平面圖建模預覽' }));
  const preview = await screen.findByRole('dialog', { name: '平面圖建模預覽' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.queryByRole('dialog', { name: '校園空間導覽' })).toBeNull();
  expect(preview.textContent).toContain('本校圖書館');
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(within(preview).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  fireEvent.click(within(preview).getByRole('button', { name: '關閉視窗' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '本校圖書館' })).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});

it('drops a building preview when its selected campus location is withdrawn', async () => {
  const props = { school: 'other-school', locations: places, onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} selected={places[0]} />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: '平面圖建模預覽' }));
  await screen.findByRole('dialog', { name: '平面圖建模預覽' });
  view.rerender(<CampusSpatialExplorer {...props} selected={null} />);
  expect(screen.queryByRole('dialog', { name: '平面圖建模預覽' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '校園空間導覽' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '平面圖建模預覽' })).toBeNull();
});

it('adds source-checked Providence building shapes without changing navigation or hiding source dates', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  let resolveFetch: ((value: unknown) => void) | undefined;
  const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(fetchMock).toHaveBeenCalledWith('/api/public/campus-footprints', expect.objectContaining({ signal: expect.anything() }));
  // Only the loading state belongs to the live region, not its source links.
  expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/).getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' }).closest('[role="status"]')).toBeNull();
  const outline = [
    { lat: 24.22624, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58131 },
  ];
  const buildings = parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry: outline,
      tags: { building: 'yes' }, version: 7, timestamp: '2026-10-15T08:09:10Z' }],
  });
  const fetchedAt = new Date().toISOString();
  const osmBaseAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60 * 60 * 1000)
    .toISOString().replace('.000Z', 'Z');
  await act(async () => {
    resolveFetch?.({ ok: true, text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false, osmBaseAt,
    }) });
  });
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  expect(within(dialog).getByText(/1 棟公開建築輪廓/).getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '靜宜官方校園圖與實境導覽' }).closest('[role="status"]')).toBeNull();
  // Both provenance labels can show the same calendar day; anchor by meaning.
  expect(within(dialog).getByText(new RegExp(`^資料讀取：${fetchedAt.slice(0, 10)}`))).toBeTruthy();
  expect(within(dialog).getByText(new RegExp(`OSM 資料庫同步：${osmBaseAt.slice(0, 10)}.*非現地查證`))).toBeTruthy();
  expect(within(dialog).getByText(/高度：12 公尺示意.*無 OSM 高度標註.*非實際樓高/)).toBeTruthy();
  expect(within(dialog).getByText(/OSM way 版本 v7.*2026-10-15/)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// Firestore/custom map markers can reuse a bundled source ID, but their
// name, category or position may no longer identify the audited building.
// Without any source-checked *visible* candidate, do not request the entire
// campus OSM snapshot merely because its old ID happens to match.
it.each([
  { reason: 'same ID at a moved coordinate', override: { lat: 24.237 } },
  { reason: 'same ID moved 53m diagonally', override: { lat: 24.226632, lng: 120.581727 } },
  { reason: 'same ID under a different name', override: { name: '另一棟圖書館' } },
  { reason: 'same ID reclassified as a bus stop', override: { category: '公車站' } },
])('skips OSM network work for $reason without losing navigation', async ({ override }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const mapPlace: MapLocation = { ...library, ...override };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[mapPlace]} selected={mapPlace} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/目前篩選的地點沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '重新讀取建築輪廓' })).toBeNull();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).queryByRole('link', { name: '查看此棟建築的 OpenStreetMap 原始輪廓' })).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' })).toBeTruthy();
});

it('starts OSM loading only after a reused library ID regains its audited identity, then aborts when lost', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const displaced: MapLocation = { ...library, lat: library.lat + 0.01 };
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url: string, options: { signal: AbortSignal }) => {
    signal = options.signal;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const view = render(
    <CampusSpatialExplorer school="pu" locations={[displaced]} selected={displaced} onSelect={onSelect} />,
  );
  const dialog = await open();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  view.rerender(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={onSelect} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(signal?.aborted).toBe(false);
  expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();

  // Even though the ID remains constant, a later POI identity withdrawal
  // must revoke the request before any response can be treated as sourced.
  view.rerender(<CampusSpatialExplorer school="pu" locations={[displaced]} selected={displaced} onSelect={onSelect} />);
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(within(dialog).getByText(/沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('withdraws a visible OSM building when the map POI identity changes while the dialog is open', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const moved: MapLocation = { ...library, lat: library.lat + 0.01 };
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const { rerender } = render(
    <CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={onSelect} />,
  );
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  rerender(<CampusSpatialExplorer school="pu" locations={[moved]} selected={moved} onSelect={onSelect} />);
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: moved.id } });
  await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
  expect(within(dialog).getByText(/目前篩選的地點沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(within(dialog).queryByText(/棟公開建築輪廓/)).toBeNull();
  expect(within(dialog).queryByRole('link', { name: '查看此棟建築的 OpenStreetMap 原始輪廓' })).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('falls back after 15 seconds even if an OSM proxy ignores abort, and ignores late success', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  let signal: AbortSignal | undefined;
  let resolveFetch: ((value: { ok: true; text: () => Promise<string> }) => void) | undefined;
  // Simulate a response that ignores AbortSignal entirely: abort alone must
  // never leave the campus browser stuck on its loading message.
  vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => {
    signal = init.signal;
    return new Promise<{ ok: true; text: () => Promise<string> }>((resolve) => {
      resolveFetch = resolve;
    });
  }));
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
    const callback = timeoutSpy.mock.calls.find(([, delay]) => delay === 15_000)?.[0];
    expect(typeof callback).toBe('function');
    await act(async () => { (callback as () => void)(); });
    expect(signal?.aborted).toBe(true);
    expect(within(dialog).getByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    // Timeout must throttle subsequent requests even if AbortSignal is ignored.
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
    fireEvent.click(retry);
    fireEvent(window, new Event('pageshow'));
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(scene.create.mock.calls[0][2].footprints).toEqual([]);

    // The request may finally finish after the visible timeout. A valid late
    // snapshot must not revive the expired request or silently change the map.
    const outline = [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ];
    const buildings = parseProvidenceOsmFootprints({
      elements: [{ type: 'way', id: 255784049, geometry: outline, tags: { building: 'yes' } }],
    });
    expect(buildings).toHaveLength(1);
    await act(async () => {
      resolveFetch?.({ ok: true, text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date().toISOString(), stale: false,
      }) });
    });
    expect(within(dialog).getByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    timeoutSpy.mockRestore();
  }
});

it.each([
  { status: 203, contentRange: null },
  { status: 206, contentRange: 'bytes 0-119/250' },
  { status: 200, contentRange: 'bytes 0-119/250' },
])('rejects a transformed or ranged OSM API response ($status, $contentRange)', async ({ status, contentRange }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const response = new Response(JSON.stringify({
    schoolId: 'pu', source: 'OpenStreetMap', buildings,
    fetchedAt: new Date().toISOString(), stale: false,
  }), {
    status,
    headers: contentRange ? { 'Content-Range': contentRange } : undefined,
  });
  // Response.ok is true for every synthetic case; status alone cannot be
  // inferred from ok, and parsing must not begin for these untrusted bodies.
  expect(response.ok).toBe(true);
  const json = vi.spyOn(response, 'json');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(json).not.toHaveBeenCalled();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});


// The public endpoint bounds its decoded upstream OSM payload. A downstream
// proxy could still advertise a huge or malformed 200 response. Reject before
// json() to protect mobile memory; keep verified POIs and walking directions.
it.each([
  { contentLength: '2000001', reason: 'oversized declared body' },
  { contentLength: '9'.repeat(40), reason: 'overflowing decimal length' },
  { contentLength: '1e8', reason: 'nondecimal length' },
])('rejects a $reason on a 200 OSM response without parsing it', async ({ contentLength }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const cancel = vi.fn().mockResolvedValue(undefined);
  const json = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: { get: (name: string) => name === 'content-length' ? contentLength : null },
    body: { cancel },
    json,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(json).not.toHaveBeenCalled();
  const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// Embedded WebViews without a readable Response stream used to call json()
// directly, bypassing the decoded-byte limit. Both ASCII and multi-byte UTF-8
// payloads must be rejected before parsing a spoofed, otherwise valid map.
it.each(['ASCII', 'UTF-8'] as const)(
  'rejects oversized non-streaming %s OSM responses without installing geometry',
  async (encoding) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const buildings = parseProvidenceOsmFootprints({ elements: [{
      type: 'way', id: 255784049, tags: { building: 'yes' },
      geometry: [
        { lat: 24.22624, lon: 120.58131 },
        { lat: 24.22624, lon: 120.58143 },
        { lat: 24.22634, lon: 120.58143 },
        { lat: 24.22634, lon: 120.58131 },
        { lat: 24.22624, lon: 120.58131 },
      ],
    }] });
    expect(buildings).toHaveLength(1);
    const raw = JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
      extra: encoding === 'ASCII' ? 'x'.repeat(2_000_001) : '中'.repeat(700_000),
    });
    expect(raw.length > 2_000_000 || new TextEncoder().encode(raw).byteLength > 2_000_000).toBe(true);
    const textBody = vi.fn().mockResolvedValue(raw);
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, body: null,
      headers: { get: () => null }, text: textBody, json,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(textBody).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  },
);

it.each([
  { name: 'no headers', encoding: null, length: null, result: 'accept' },
  { name: 'identity without length', encoding: 'identity', length: null, result: 'accept' },
  // A parsed JSON object cannot prove identity HTTP framing, even when a
  // stringified payload happens to be the advertised size. The raw response
  // has a trailing newline that is absent from the parsed JSON object.
  { name: 'identity with length', encoding: 'identity', length: 'actual', result: 'skip' },
  { name: 'implicit identity with length', encoding: null, length: 'actual', result: 'skip' },
  { name: 'oversized declaration', encoding: null, length: '2000001', result: 'skip' },
  { name: 'gzip', encoding: 'gzip', length: '100', result: 'skip' },
  { name: 'gzip without length', encoding: 'gzip', length: null, result: 'skip' },
  { name: 'oversized UTF-8 payload without length', encoding: null, length: null, oversized: true, result: 'reject' },
  { name: 'oversized identity payload', encoding: 'identity', length: '100', oversized: true, result: 'skip' },
  { name: 'invalid snapshot', encoding: null, length: null, result: 'reject' },
])('validates JSON-only WebView snapshots ($name)', async ({ name, encoding, length, oversized, result }) => {
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  // Trailing whitespace contributes to wire length but disappears after parsing.
  const raw = body + '\n';
  const payload = JSON.parse(raw) as Record<string, unknown>;
  if (name === 'invalid snapshot') delete payload.buildings;
  if (oversized) payload.extra = '中'.repeat(700_000);
  const json = vi.fn().mockResolvedValue(payload);
  const headers = new Headers();
  if (encoding !== null) headers.set('Content-Encoding', encoding);
  if (length !== null) {
    headers.set('Content-Length', length === 'actual' ? String(new TextEncoder().encode(raw).byteLength) : length);
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers, json }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const accepted = result === 'accept';
  expect(await within(dialog).findByText(accepted ? /1 棟公開建築輪廓/ : /公開建築輪廓目前無法取得/)).toBeTruthy();
  await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(accepted ? buildings : []));
  expect(json).toHaveBeenCalledTimes(result === 'skip' ? 0 : 1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// Fetch decodes Content-Encoding before exposing arrayBuffer(). Some embedded
// WebViews supply those decoded bytes but neither a ReadableStream nor text().
// Never use eager json() when bytes can be size-checked before parsing.
it.each([
  { encoding: 'gzip', length: '100', oversized: false },
  { encoding: 'gzip', length: '100', oversized: true },
  { encoding: 'identity', length: 'actual', oversized: false },
  { encoding: 'identity', length: null, oversized: true },
  { encoding: null, length: null, oversized: false },
  { encoding: null, length: '2000001', oversized: false },
])('bounds byte-only WebView snapshots (%j)', async ({ encoding, length, oversized }) => {
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  const raw = oversized
    ? JSON.stringify({ ...JSON.parse(body) as Record<string, unknown>, padding: 'x'.repeat(2_000_001) })
    : body;
  const bytes = new TextEncoder().encode(raw);
  const arrayBuffer = vi.fn().mockResolvedValue(bytes.buffer);
  const headers = new Headers();
  if (encoding !== null) headers.set('Content-Encoding', encoding);
  if (length !== null) headers.set('Content-Length', length === 'actual' ? String(bytes.byteLength) : length);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, body: null,
    headers, arrayBuffer,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  if (!oversized && length !== '2000001') {
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings));
  } else {
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  }
  expect(arrayBuffer).toHaveBeenCalledTimes(length === '2000001' ? 0 : 1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it.each([
  'exact', 'trailing whitespace', 'escaped text', 'understated', 'overstated',
  'truncated', 'invalid JSON', 'invalid snapshot', 'missing length', 'invalid length',
  'stacked coding', 'invalid coding', 'conflicting framing',
])('verifies a legacy Response with hidden body readers and %s', async (variant) => {
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  let raw = body;
  if (variant === 'trailing whitespace') raw += '\r\n \t';
  if (variant === 'escaped text') raw = raw.replace('OpenStreetMap', '\\u004fpenStreetMap');
  if (variant === 'truncated') raw = raw.slice(0, -1);
  if (variant === 'invalid JSON') raw += '!';
  if (variant === 'invalid snapshot') raw = raw.replace('OpenStreetMap', 'unknown');
  const headers = new Headers({ 'Content-Type': 'application/json', 'Content-Encoding': 'identity' });
  const length = new TextEncoder().encode(variant === 'truncated' ? body : raw).byteLength;
  if (variant !== 'missing length') {
    const declared = length + (variant === 'understated' ? -1 : variant === 'overstated' ? 1 : 0);
    headers.set('Content-Length', variant === 'invalid length' ? '1, 2' : String(declared));
  }
  if (variant === 'stacked coding') headers.set('Content-Encoding', 'identity, gzip');
  if (variant === 'invalid coding') headers.set('Content-Encoding', 'identity; bad');
  if (variant === 'conflicting framing') headers.set('Transfer-Encoding', 'chunked');
  const response = new Response(raw, { headers });
  for (const member of ['body', 'text', 'arrayBuffer', 'blob', 'bytes']) {
    Object.defineProperty(response, member, { value: undefined });
  }
  const json = vi.spyOn(response, 'json');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const valid = ['exact', 'trailing whitespace', 'escaped text', 'missing length', 'conflicting framing'].includes(variant);
  expect(await within(dialog).findByText(valid ? /1 棟公開建築輪廓/ : /公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(valid ? buildings : []);
  expect(json).not.toHaveBeenCalled();
});

it.each(['identity', 'gzip'] as const)(
  'reads and rejects an empty JSON body with %s encoding',
  async (coding) => {
    const { library } = sourcedLibraryFootprintFixture();
    const response = new Response('', {
      headers: { 'Content-Length': '000', 'Content-Encoding': coding },
    });
    const read = vi.spyOn(response.body!, 'getReader');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    render(<CampusSpatialExplorer school="pu" locations={[library]}
      selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(read).toHaveBeenCalledOnce();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }).hasAttribute('disabled')).toBe(true);
  },
);

// A downstream intermediary can change Content-Encoding independently of the
// trusted API. An unknown or stacked coding makes identity framing ambiguous;
// never accept its OSM buildings even when the proxy advertises HTTP 200.
// Reject at headers time without waiting for a stalled body in a mobile WebView.
it.each(['unknown', 'gzip, br', 'zstd, identity', 'zstd;q=1', 'gzip;q=1', ''] as const)(
  'rejects ambiguous Content-Encoding %j without loading an OSM building',
  async (coding) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const cancel = vi.fn();
    const stalledBody = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stalledBody, {
      status: 200, headers: { 'Content-Encoding': coding },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]}
      selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }).hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' })).toBeTruthy();
  },
);

const footprintContentTypes = [
  'application/json', 'text/plain', null, 'text/html', 'application/octet-stream',
  'application/json; charset=UTF-8', 'text/plain; charset=UTF-8',
  'application/vnd.example_campus+json',
];

it.each(footprintContentTypes.flatMap((contentType) =>
  (['valid', 'invalid JSON', 'unverified source', 'invalid structure'] as const)
    .map((payload) => ({ contentType, payload })),
))('validates $payload outline data with Content-Type $contentType', async ({ contentType, payload }) => {
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  const raw = {
    valid: body,
    'invalid JSON': body + '!',
    'unverified source': body.replace('OpenStreetMap', 'unknown'),
    'invalid structure': '{"schoolId":"pu","source":"OpenStreetMap"}',
  }[payload];
  const headers = new Headers();
  if (contentType !== null) headers.set('Content-Type', contentType);
  const response = new Response(new TextEncoder().encode(raw), { headers });
  const read = vi.spyOn(response.body!, 'getReader');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  render(<CampusSpatialExplorer school="pu" locations={[library]}
    selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const valid = payload === 'valid';
  expect(await within(dialog).findByText(valid ? /1 棟公開建築輪廓/ : /公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(read).toHaveBeenCalledOnce();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(valid ? buildings : []);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('reads the final successful outline response after a redirect', async () => {
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  const response = new Response(body, { headers: { 'Content-Type': 'text/plain' } });
  vi.spyOn(response, 'redirected', 'get').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  render(<CampusSpatialExplorer school="pu" locations={[library]}
    selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
});

it('accepts a small, valid non-streaming text response for legacy WebViews', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const textBody = vi.fn().mockResolvedValue(JSON.stringify({
    schoolId: 'pu', source: 'OpenStreetMap', buildings,
    fetchedAt: new Date().toISOString(), stale: false,
  }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, body: null, headers: { get: () => null },
    text: textBody,
  }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(textBody).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('accepts a complete, correctly sized JSON snapshot with a valid Content-Length', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const payload = JSON.stringify({
    schoolId: 'pu', source: 'OpenStreetMap', buildings,
    fetchedAt: new Date().toISOString(), stale: false,
  });
  const bytes = new TextEncoder().encode(payload);
  // Deliberately fragment the stream to verify byte offsets and UTF-8
  // reconstruction, rather than relying on a single Response body chunk.
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const split = Math.floor(bytes.byteLength / 2);
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json',
      'Content-Length': String(bytes.byteLength) },
  });
  const json = vi.spyOn(response, 'json');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  // A native streaming Response must use bounded decoded-byte reading,
// not Response.json(), which buffers without an actual byte ceiling.
  expect(json).not.toHaveBeenCalled();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// A 200 JSON body can be syntactically valid despite missing/trailing bytes.
// Only an identity-encoded Content-Length can be compared with decoded bytes:
// on gzip/br, browsers deliver decompressed bytes but keep the wire length.
function sourcedLibraryFootprintFixture() {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  if (buildings.length !== 1) throw new Error('Missing source-checked OSM fixture');
  return { library, buildings, body: JSON.stringify({
    schoolId: 'pu', source: 'OpenStreetMap',
    fetchedAt: new Date().toISOString(), stale: false, buildings,
  }) };
}

it.each(['understated', 'overstated'] as const)(
  'rejects valid-looking 200 outline JSON with %s identity Content-Length',
  async (difference) => {
    const { library, body } = sourcedLibraryFootprintFixture();
    const bytes = new TextEncoder().encode(body);
    const declared = bytes.byteLength + (difference === 'understated' ? -5 : 5);
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }), {
      status: 200,
      headers: { 'Content-Length': String(declared), 'Content-Type': 'application/json' },
    });
    const json = vi.spyOn(response, 'json');
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(json).not.toHaveBeenCalled();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { description: 'shorter than identity Content-Length', oversized: false },
  { description: 'over the UTF-8 byte limit without Content-Length', oversized: true },
])('rejects a legacy non-streaming WebView text body $description', async ({ oversized }) => {
  const { library, body } = sourcedLibraryFootprintFixture();
  const raw = oversized
    ? JSON.stringify({ ...JSON.parse(body) as Record<string, unknown>, padding: '中'.repeat(700_000) })
    : body;
  const headers = new Headers();
  if (!oversized) {
    headers.set('Content-Length', String(new TextEncoder().encode(raw).byteLength + 1));
  }
  const json = vi.fn();
  const textBody = vi.fn().mockResolvedValue(raw);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, body: null,
    headers, text: textBody, json,
  }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(textBody).toHaveBeenCalledTimes(1);
  expect(json).not.toHaveBeenCalled();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it.each(['gzip', 'x-gzip', 'br', 'deflate', 'zstd', 'dcb', 'dcz'] as const)(
  'accepts an already-decoded %s map body with a different wire Content-Length', async (coding) => {
    const { library, buildings, body } = sourcedLibraryFootprintFixture();
    // Browser fetch has already decoded the body before exposing the ReadableStream.
    const bytes = new TextEncoder().encode(body);
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }), {
      status: 200,
      headers: { 'Content-Encoding': coding, 'Content-Length': '40' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  },
);

// Content-Length is optional and can be incorrect. A decoded-byte cap must
// reject a too-large streaming 200 response before JSON parsing and keep
// campus POIs/navigation usable without hammering the public API.
it.each([
  { description: 'no Content-Length', headers: new Headers() },
  { description: 'an understated Content-Length', headers: new Headers({ 'Content-Length': '20' }) },
  { description: 'zstd wire framing', headers: new Headers({ 'Content-Length': '40', 'Content-Encoding': 'zstd' }) },
])('rejects more than 2 MB of decoded OSM JSON with $description', async ({ headers }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_000_000));
      controller.enqueue(new Uint8Array(1_000_001));
    },
    cancel,
  });
  const response = new Response(stream, {
    status: 200,
    headers,
  });
  const json = vi.spyOn(response, 'json');
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(json).not.toHaveBeenCalled();
  const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  fireEvent.click(retry);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// A downstream WebView/proxy can return an endless stream of zero-byte chunks.
// The 2 MB decoded-byte guard alone never progresses; cap stream iterations to
// keep the map responsive even when microtasks starve the 15s timeout.
it('stops an OSM stream of empty chunks without parsing JSON or hammering the source', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(0)); },
    cancel,
  });
  const response = new Response(stream, { status: 200 });
  const json = vi.spyOn(response, 'json');
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(json).not.toHaveBeenCalled();
  const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// A long sequence of immediately resolved chunks must not monopolize a mobile
// WebView's event loop. Prove that a timer scheduled *after* stream reading
// starts gets a turn before all chunks are consumed, while the real decoded
// OSM snapshot remains intact. This is a synthetic transport fixture.
it('yields between fragmented campus outline chunks without losing valid geometry', async () => {
  const { library, buildings, body } = sourcedLibraryFootprintFixture();
  let produced = 0;
  let timerObservedAt: number | null = null;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      produced += 1;
      // Schedule only after the reader is actively consuming the stream,
      // not at construction (which could make a pre-fix test pass by chance).
      if (produced === 64) {
        window.setTimeout(() => { timerObservedAt = produced; }, 0);
      }
      if (produced <= 320) controller.enqueue(new Uint8Array(0));
      else {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      }
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]}
    selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  await waitFor(() => expect(timerObservedAt).not.toBeNull());
  // Without yielding, the timer runs only after all 321 reads have finished.
  expect(timerObservedAt).toBeLessThan(320);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// Fetch may resolve its headers before a suspended WebView delivers the rest
// of the OSM body. Abort must cancel the acquired reader, not only the fetch
// controller, so closing or backgrounding the map stops unneeded data work.
it.each(['pagehide', 'dialog close'] as const)(
  'cancels a pending OSM response body on mobile %s',
  async (reason) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const cancel = vi.fn();
    // A valid 200 response whose stream has not finished (and will not
    // deliver more bytes until explicitly canceled).
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {},
      cancel,
    }), { status: 200 });
    const json = vi.spyOn(response, 'json');
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    await waitFor(() => expect(response.body?.locked).toBe(true));

    if (reason === 'pagehide') {
      fireEvent(window, new Event('pagehide'));
      expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    } else {
      fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (reason === 'pagehide') {
      fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    }
  },
);

it('keeps the spatial map usable when Providence building geometry is unavailable', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const unavailableNotice = await within(dialog).findByText(/公開建築輪廓目前無法取得/);
  expect(unavailableNotice.getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }).closest('[role="status"]')).toBeNull();
  expect(within(dialog).getByRole('button', { name: '在平面地圖查看' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
});

it('keeps real campus navigation when a tampered API snapshot repeats a verified building', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const outline = [
    { lat: 24.22624, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58131 },
  ];
  const buildings = parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry: outline, tags: { building: 'yes' } }],
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap',
      fetchedAt: new Date().toISOString(), stale: false,
      buildings: [buildings[0], { ...buildings[0], heightMeters: 90, heightBasis: 'osm-tag' }],
    }),
  }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' })).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
});

// Offline fetch rejections are usually TypeError. Some WebViews instead
// surface DOMException or an ordinary Error named NetworkError; all represent
// the same failed request and require origin backoff, not rapid manual retries.
it.each([
  { kind: 'TypeError', reason: () => new TypeError('Failed to fetch') },
  { kind: 'DOMException NetworkError', reason: () => new DOMException('Network disconnected', 'NetworkError') },
  { kind: 'Error named NetworkError', reason: () => Object.assign(new Error('WebView network offline'), { name: 'NetworkError' }) },
])('backs off a rejected OSM request with no response ($kind)', async ({ reason }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockRejectedValue(reason());
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
});

it('does not rate-limit a generic application failure disguised as a rejected OSM fetch', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockRejectedValue(new Error('Application error'));
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(within(dialog).getByText(/公開建築輪廓目前無法取得/)).toBeTruthy());
  expect(retry.hasAttribute('disabled')).toBe(false);
  expect(window.sessionStorage.getItem('nuni:pu:osm-footprint-cooldown-until')).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// Closing and reopening a dialog must not bypass an origin-protecting wait.
// The stored value is only a deadline; no map coordinates or student data.
it('retains a source cooldown after closing and reopening the spatial dialog', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const firstDialog = await open();
  const firstRetry = await within(firstDialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(firstRetry.hasAttribute('disabled')).toBe(true));
  const persisted = window.sessionStorage.getItem('nuni:pu:osm-footprint-cooldown-until');
  expect(Number(persisted)).toBeGreaterThan(Date.now());
  fireEvent.click(within(firstDialog).getByRole('button', { name: '關閉視窗' }));
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const reopened = screen.getByRole('dialog', { name: '校園空間導覽' });
  const retry = await within(reopened).findByRole('button', { name: '重新讀取建築輪廓' });
  expect(retry.hasAttribute('disabled')).toBe(true);
  expect(within(reopened).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(reopened).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('permits a deliberate retry after a restored cooldown expires, without automatic polling', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const key = 'nuni:pu:osm-footprint-cooldown-until';
  const future = Date.now() + 60_000;
  window.sessionStorage.setItem(key, String(future));
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetchMock);
  const now = vi.spyOn(Date, 'now');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    now.mockReturnValue(future + 1000);
    await act(async () => { fireEvent(window, new Event('pageshow')); });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  } finally {
    now.mockRestore();
  }
});

it.each(['not-a-timestamp', String(Date.now() + 3 * 24 * 60 * 60 * 1000)])(
  'ignores invalid or out-of-range stored OSM cooldown %s', async (badDeadline) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const key = 'nuni:pu:osm-footprint-cooldown-until';
    window.sessionStorage.setItem(key, badDeadline);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(key)).toBeNull();
  },
);

// Synthetic HTTP 200 responses from a proxy can still be corrupt, truncated,
// or fail the OSM source/geometry contract. Reject them without inviting a
// rapid retry loop, while keeping POIs and the existing walking route available.
it.each([
  { label: 'truncated JSON', brokenJson: true, retryAfter: null, minutes: 1 },
  { label: 'untrusted OSM source', brokenJson: false, retryAfter: null, minutes: 1 },
  { label: 'truncated JSON with Retry-After', brokenJson: true, retryAfter: '600', minutes: 10 },
])('backs off an untrusted HTTP 200 footprint body ($label)', async ({ brokenJson, retryAfter, minutes }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const text = vi.fn().mockResolvedValue(brokenJson ? '{' :
    JSON.stringify({ schoolId: 'untrusted-campus', source: 'OpenStreetMap', buildings: [] }));
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: { get: (name: string) => name === 'retry-after' ? retryAfter : null },
    text,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(new RegExp(`約 ${minutes} 分鐘冷卻，到期後可再試`))).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(text).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('keeps a dated stale outline when a subsequent HTTP 200 refresh has invalid JSON', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: true }),
    })
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => '{',
    });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
  fireEvent.click(retry);
  expect(await within(dialog).findByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeTruthy();
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).getByText(new RegExp(`資料讀取：${fetchedAt.slice(0, 10)}`))).toBeTruthy();
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('honors the API Retry-After cooldown without hammering Overpass or blocking navigation', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: false, status: 503,
      headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
    })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
    }) });
  vi.stubGlobal('fetch', fetchMock);
  // The scheduled callback must run after the absolute wall-clock deadline.
  // Invoking a timer early must never bypass a server cooldown.
  let now = Date.now();
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 10 分鐘冷卻，到期後可再試/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Use the actual scheduled cooldown callback instead of advancing every
    // unrelated React and graphics timer. This is a synthetic server response,
    // not a real public Overpass rate-limit observation.
    const release = timeoutSpy.mock.calls.find(([, delay]) => typeof delay === 'number' && delay >= 599_000 && delay <= 600_000)?.[0];
    expect(typeof release).toBe('function');
    now += 600_001;
    await act(async () => { (release as () => void)(); });
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/約 10 分鐘冷卻，到期後可再試/)).toBeNull();
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }
});

// Rejected HTTP headers arrive before the response body. An overloaded
// intermediary may continue streaming an error page or partial JSON unless
// we explicitly cancel the unused body; only headers determine the backoff.
it.each([
  { status: 503, ok: false, contentRange: null },
  { status: 200, ok: true, contentRange: 'bytes 0-99/200' },
])('cancels the unused OSM response body on rejected HTTP $status / range $contentRange',
  async ({ status, ok, contentRange }) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const cancel = vi.fn().mockResolvedValue(undefined);
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok, status,
      headers: { get: (name: string) => name === 'content-range' ? contentRange : null },
      body: { cancel },
      json,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    expect(retry.hasAttribute('disabled')).toBe(true);
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  });

// A browser/WebView may throw while canceling a locked body. It must not
// bypass the 503 Retry-After gate or leak an unhandled promise rejection.
it.each(['throws synchronously', 'rejects asynchronously'] as const)(
  'preserves origin cooldown when rejected OSM response body cancellation %s',
  async (failure) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const cancel = vi.fn().mockImplementation(() => {
      if (failure === 'throws synchronously') throw new TypeError('locked response stream');
      return Promise.reject(new TypeError('stream cancellation rejected'));
    });
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
      body: { cancel },
      json,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 10 分鐘冷卻，到期後可再試/)).toBeTruthy();
    fireEvent.click(retry);
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  },
);

it.each([
  { status: 429, kind: 'delay-seconds', header: '600', minutes: 10 },
  { status: 503, kind: 'HTTP-date', header: null, minutes: 10 },
  { status: 429, kind: 'zero-padded delay-seconds', header: '00000600', minutes: 10 },
  { status: 429, kind: 'more than 64 leading zeroes', header: '0'.repeat(80) + '600', minutes: 10 },
  { status: 503, kind: 'long delay-seconds capped to 24h', header: '1000000', minutes: 1440 },
  { status: 429, kind: 'more than 64 positive digits capped to 24h', header: '9'.repeat(80), minutes: 1440 },
])('does not repeatedly retry a rate-limited OSM source ($status, $kind)', async ({ status, kind, header, minutes }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  // RFC 9110 permits leading zeroes and arbitrarily long digit strings.
  // The client limits a genuine wait to 24h; these are synthetic responses,
  // not observed Overpass headers.
  const retryAfter = kind === 'HTTP-date'
    ? new Date(Date.now() + 10 * 60_000).toUTCString()
    : header;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status,
    headers: { get: (name: string) => name === 'retry-after' ? retryAfter : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(new RegExp(`約 ${minutes} 分鐘冷卻，到期後可再試`))).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
});

it.each([
  { status: 202, contentRange: null },
  { status: 204, contentRange: null },
  { status: 205, contentRange: null },
  { status: 206, contentRange: 'bytes 0-63/4096' },
  { status: 304, contentRange: null },
  { status: 408, contentRange: null },
  { status: 502, contentRange: null },
  { status: 504, contentRange: null },
  { status: 200, contentRange: 'bytes 0-63/4096' },
])('honors Retry-After on rejected incomplete or gateway footprints ($status)', async ({ status, contentRange }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const json = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    headers: { get: (name: string) =>
      name === 'retry-after' ? '600' : name === 'content-range' ? contentRange : null },
    json,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 10 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(json).not.toHaveBeenCalled();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// A suspended/incorrectly configured phone may disagree with the response
// server's Date header. HTTP-date Retry-After is on the origin's time scale.
// These are synthetic 429/503 responses, not real Overpass observations.
it.each([
  { status: 429, serverOffsetMinutes: -20, retryOffsetMinutes: -10, expectedMinutes: 10 },
  { status: 503, serverOffsetMinutes: 20, retryOffsetMinutes: 30, expectedMinutes: 30 },
  { status: 429, serverOffsetMinutes: null, retryOffsetMinutes: 10, expectedMinutes: 10 },
])('keeps the longer valid HTTP-date cooldown with clock skew ($status, server $serverOffsetMinutes)',
  async ({ status, serverOffsetMinutes, retryOffsetMinutes, expectedMinutes }) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const now = Date.now();
    const serverDate = serverOffsetMinutes === null ? 'invalid Date'
      : new Date(now + serverOffsetMinutes * 60_000).toUTCString();
    const retryDate = new Date(now + retryOffsetMinutes * 60_000).toUTCString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status,
      headers: { get: (name: string) =>
        name === 'retry-after' ? retryDate : name === 'date' ? serverDate : null },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(new RegExp(`約 ${expectedMinutes} 分鐘冷卻，到期後可再試`))).toBeTruthy();
    fireEvent.click(retry);
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  });

// Incomplete success responses (202/204/205/206), unexpected 304, 408,
// 200 with Content-Range, and gateway failures may omit Retry-After.
// A one-minute local backoff avoids
// repeated requests while original POIs and walking directions stay usable.
// These are synthetic proxy responses, not observed Overpass behavior.
it.each([
  { status: 202, retryAfter: null, contentRange: null },
  { status: 204, retryAfter: null, contentRange: null },
  { status: 205, retryAfter: null, contentRange: null },
  { status: 206, retryAfter: null, contentRange: null },
  { status: 207, retryAfter: null, contentRange: null },
  { status: 304, retryAfter: null, contentRange: null },
  { status: 206, retryAfter: null, contentRange: 'bytes 0-63/4096' },
  { status: 200, retryAfter: null, contentRange: 'bytes 0-63/4096' },
  { status: 408, retryAfter: null, contentRange: null },
  { status: 502, retryAfter: null, contentRange: null },
  { status: 503, retryAfter: null, contentRange: null },
  { status: 503, retryAfter: 'invalid HTTP-date', contentRange: null },
  { status: 504, retryAfter: null, contentRange: null },
])('backs off an incomplete or failed OSM response without usable Retry-After ($status, $retryAfter, $contentRange)',
  async ({ status, retryAfter, contentRange }) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300, status,
      headers: { get: (name: string) => name === 'retry-after' ? retryAfter :
        name === 'content-range' ? contentRange : null },
      json,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
    fireEvent.click(retry);
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  });

it('quarantines an in-flight OSM response on Safari pagehide even before document.hidden changes', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  let resolveFirst: ((response: {
    ok: boolean; status: number; headers: { get: () => null }; text: () => Promise<string>;
  }) => void) | undefined;
  const fetchMock = vi.fn((_url: string, _init: { signal: AbortSignal }) =>
    new Promise<{
      ok: boolean; status: number; headers: { get: () => null }; text: () => Promise<string>;
    }>((resolve) => { resolveFirst = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const firstSignal = fetchMock.mock.calls[0][1].signal;
  expect(firstSignal.aborted).toBe(false);

  // Safari bfcache can suspend the page without updating document.hidden.
  fireEvent(window, new Event('pagehide'));
  expect(document.hidden).toBe(false);
  expect(firstSignal.aborted).toBe(true);
  expect(within(dialog).getByText(/返回導覽後才會讀取靜宜建築輪廓/).getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  // A proxy may ignore AbortSignal and deliver a seemingly valid snapshot.
  // That late response must not install geometry while the page is suspended.
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049,
    geometry: [
      { lat: 24.22624, lon: 120.58131 }, { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 }, { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ], tags: { building: 'yes' },
  }] });
  expect(buildings).toHaveLength(1);
  await act(async () => {
    resolveFirst?.({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date().toISOString(), stale: false,
      }),
    });
  });
  expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // A pageshow while still hidden cannot start an OSM fetch; only the true
  // foreground transition resumes one request, never a duplicate on pageshow.
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  fireEvent(window, new Event('pagehide'));
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('quarantines an in-flight OSM response when a mobile tab hides without pagehide', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  let resolveFirst: ((response: {
    ok: boolean; status: number; headers: { get: () => null }; text: () => Promise<string>;
  }) => void) | undefined;
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValue({ ok: false, status: 503, headers: { get: () => null } });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  expect(firstSignal.aborted).toBe(false);

  // Switching apps can hide a tab without pagehide; its in-flight OSM
  // geometry must be aborted rather than continuing to load in the background.
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  fireEvent(document, new Event('visibilitychange'));
  expect(firstSignal.aborted).toBe(true);
  expect(within(dialog).getByText(/返回導覽後才會讀取靜宜建築輪廓/).getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  // A proxy that ignores AbortSignal must not install its late valid shape.
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 }, { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 }, { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  await act(async () => {
    resolveFirst?.({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date().toISOString(), stale: false,
      }),
    });
  });
  expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fireEvent(window, new Event('pageshow')); // No real foreground transition yet.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not re-fetch settled OSM errors just because Safari restores a page', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event('pagehide'));
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }).hasAttribute('disabled')).toBe(false);
});

it('defers an OSM request opened in a hidden mobile tab until one foreground resume', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503, headers: { get: () => null },
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  // The shared open() helper expects an initialized WebGL scene, which must
  // deliberately NOT exist while the page is hidden.
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  expect(scene.create).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  // A suspended mobile tab is waiting, not actively downloading OSM data.
  const deferred = within(dialog).getByText(/目前位於背景分頁，返回導覽後才會讀取靜宜建築輪廓/);
  expect(deferred.getAttribute('role')).toBe('status');
  expect(within(dialog).queryByText(/正在讀取靜宜建築輪廓/)).toBeNull();
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  // A spurious pageshow while still hidden must not touch public Overpass.
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).not.toHaveBeenCalled();
  // WebGL and OSM each explain their independent background wait; an
  // unscoped text query would be ambiguous despite correct visible UI.
  expect(deferred.isConnected).toBe(true);
  expect(deferred.getAttribute('role')).toBe('status');
  expect(deferred.textContent).toContain('目前位於背景分頁');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(scene.create).not.toHaveBeenCalled();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('pageshow'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(within(dialog).queryByText(/目前位於背景分頁/)).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('removes a hidden-tab OSM resume listener when the spatial dialog closes', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
  expect(scene.create).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(scene.create).not.toHaveBeenCalled();
});

it('allows a single retry when an unlabelled 503 gateway cooldown expires', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503, headers: { get: () => null },
  });
  vi.stubGlobal('fetch', fetchMock);
  // The scheduled callback must run after the absolute wall-clock deadline.
  // Invoking a timer early must never bypass a server cooldown.
  let now = Date.now();
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    const release = timeoutSpy.mock.calls.find(([, delay]) =>
      typeof delay === 'number' && delay >= 59_000 && delay <= 60_000)?.[0];
    expect(typeof release).toBe('function');
    now += 60_001;
    await act(async () => { (release as () => void)(); });
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }
});

// These are synthetic intermediary 429s, not observations from Overpass.
// 429 may omit Retry-After entirely; invalid/expired values also must not
// invite a rapid manual retry loop. A one-minute client backoff protects the
// API without treating malformed headers as arbitrary 24-hour lockouts.
it.each([
  'Sun, 32 Nov 2026 01:02:03 GMT',
  'Sun, 01 Nov 2026 01:02:03 GMT',
  'not a date',
  '0',
  null,
])('backs off a 429 without a usable Retry-After (%s)', async (retryAfter) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 429,
    headers: { get: (name: string) => name === 'retry-after' ? retryAfter : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  const cooldownNotice = within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/);
  // A disabled retry control needs a live explanation for screen-reader users.
  expect(cooldownNotice.getAttribute('role')).toBe('status');
  expect(cooldownNotice.id).toBeTruthy();
  expect(retry.getAttribute('aria-describedby')).toBe(cooldownNotice.id);
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
});

it('preserves a dated stale 3D outline through cooldown, a failed refresh and recovery', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  let rejectRefresh!: (reason: Error) => void;
  const stalledRefresh = new Promise<unknown>((_resolve, reject) => {
    rejectRefresh = reject;
  });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), stale: true,
      }),
    })
    .mockReturnValueOnce(stalledRefresh)
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date().toISOString(), stale: false,
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  // The scheduled callback must run after the absolute wall-clock deadline.
  // Invoking a timer early must never bypass a server cooldown.
  let now = Date.now();
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    const staleCooldownNotice = within(dialog).getByText(/約 10 分鐘冷卻/);
    expect(staleCooldownNotice.getAttribute('role')).toBe('status');
    expect(staleCooldownNotice.id).toBeTruthy();
    expect(retry.getAttribute('aria-describedby')).toBe(staleCooldownNotice.id);
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const release = timeoutSpy.mock.calls.find(([, delay]) =>
      typeof delay === 'number' && delay >= 599_000 && delay <= 600_000)?.[0];
    expect(typeof release).toBe('function');
    now += 600_001;
    await act(async () => { (release as () => void)(); });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    // When the cooldown ends, do not reference a notice that has disappeared.
    expect(retry.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    const refreshingNotice = within(dialog).getByText(/正在檢查更新，暫時保留舊輪廓/);
    expect(refreshingNotice.getAttribute('role')).toBe('status');
    expect(refreshingNotice.id).toBeTruthy();
    expect(retry.hasAttribute('disabled')).toBe(true);
    // The disabled stale-snapshot retry must explain its in-flight state,
    // not just an earlier rate-limit cooldown that has already disappeared.
    expect(retry.getAttribute('aria-describedby')).toBe(refreshingNotice.id);

    await act(async () => { rejectRefresh(new Error('offline during refresh')); });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(retry.hasAttribute('aria-describedby')).toBe(false);
    expect(within(dialog).getByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(retry);
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: '重新讀取建築輪廓' })).toBeNull());
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeNull();
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }
});

it('keeps the existing WebGL scene when an OSM refresh only updates the fetch date', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), stale: true,
      }),
    })
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap',
        // Real JSON requests decode new objects, not the same in-memory array.
        buildings: JSON.parse(JSON.stringify(buildings)),
        fetchedAt: new Date().toISOString(), stale: false,
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toHaveLength(1));
  const createdScenes = scene.create.mock.calls.length;
  const disposedScenes = scene.dispose.mock.calls.length;
  fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull());
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  // Data date is new, but geometry and source details did not change.
  expect(scene.create).toHaveBeenCalledTimes(createdScenes);
  expect(scene.dispose).toHaveBeenCalledTimes(disposedScenes);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('releases a server cooldown after a suspended mobile tab resumes, without auto retrying', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503,
    headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  // The real timeout remains pending: simulate a browser returning from the
  // background with a wall clock later than the server's 10-minute deadline.
  let clock = Date.now();
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    clock += 70_000;
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(within(dialog).getByText(/約 9 分鐘冷卻/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 531_000;
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(within(dialog).queryByText(/分鐘冷卻/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  } finally {
    clockSpy.mockRestore();
  }
});

it('keeps an OSM cooldown locked if a mobile clock moves backwards before its timer fires', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503,
    headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  let clock = Date.now();
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cooldownTimer = timerSpy.mock.calls.find(([, delay]) => delay === 600_000);
    expect(cooldownTimer).toBeTruthy();

    // The timeout was scheduled before an NTP/time-zone clock correction.
    // A browser timer firing must not bypass the server's absolute cooldown.
    clock -= 2 * 60_000;
    act(() => { (cooldownTimer![0] as () => void)(); });
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText(/約 12 分鐘冷卻/)).toBeTruthy();
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    clock += 12 * 60_000 + 1;
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it('rearms a cooldown timeout after a small clock rollback without a minute-label change', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503,
    headers: { get: (name: string) => name === 'retry-after' ? '605' : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  let clock = Date.now();
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 11 分鐘冷卻/)).toBeTruthy();
    const original = timerSpy.mock.calls.find(([, delay]) => delay === 605_000);
    expect(original).toBeTruthy();

    // The first timeout runs after NTP moves the wall clock back 20 seconds.
    // Both 605s and 625s round to 11 minutes. No React status change can
    // incidentally restart the timer: the callback itself must rearm it.
    clock -= 20_000;
    act(() => { (original![0] as () => void)(); });
    expect(within(dialog).getByText(/約 11 分鐘冷卻/)).toBeTruthy();
    expect(retry.hasAttribute('disabled')).toBe(true);
    const rearmed = timerSpy.mock.calls.filter(([, delay]) => delay === 625_000).at(-1);
    expect(rearmed).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Expiry should unlock on the rearmed callback without a visibility
    // event or the browser's potentially throttled 60-second interval.
    clock += 625_001;
    act(() => { (rearmed![0] as () => void)(); });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it('retries Providence building data after a temporary outage without closing the tour', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const outline = [
    { lat: 24.22624, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58131 },
  ];
  const buildings = parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry: outline, tags: { building: 'yes' } }],
  });
  // A generic 500 without a rate-limit hint remains manually retryable.
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 500 })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
    }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(scene.create.mock.calls[1][2].footprints).toEqual(buildings);
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '重新讀取建築輪廓' })).toBeNull();
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('does not retain an expired OSM volume when a paused clock timer misses the hard deadline', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  const fetchedAt = new Date(clock - 2 * day).toISOString();
  let rejectRefresh!: (error: Error) => void;
  const pendingRefresh = new Promise<unknown>((_resolve, reject) => { rejectRefresh = reject; });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: true }),
    })
    .mockReturnValueOnce(pendingRefresh);
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/正在檢查更新/)).toBeTruthy();

    // Mobile browser timers can be suspended for days: the seven-day hard
    // limit must also be checked when a pending request settles. Do not
    // require visibilitychange, pageshow or the deadline timer to have fired.
    clock += 6 * day;
    await act(async () => { rejectRefresh(new Error('offline after seven-day deadline')); });
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前/)).toBeNull();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    clockSpy.mockRestore();
  }
});

it('retains a newly stale outline throughout its first 24-hour refresh and an offline failure', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  const fetchedAt = new Date(clock - day + 60_000).toISOString();
  let rejectRefresh!: (reason: Error) => void;
  const pendingRefresh = new Promise<unknown>((_resolve, reject) => { rejectRefresh = reject; });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false }),
    })
    .mockReturnValueOnce(pendingRefresh);
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    const previousSceneCount = scene.create.mock.calls.length;

    // The map was fresh when fetched, but becomes stale while the modal
    // stays mounted. The first automatic revalidation is not a new map load:
    // do not blank still-retainable geometry or reconstruct WebGL.
    clock += 2 * 60_000;
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/正在檢查更新，暫時保留舊輪廓/)).toBeTruthy();
    expect(scene.create).toHaveBeenCalledTimes(previousSceneCount);

    await act(async () => { rejectRefresh(new TypeError('Failed to fetch')); });
    expect(within(dialog).getByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(`資料讀取：${fetchedAt.slice(0, 10)}（暫用舊快照）`)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }).hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create).toHaveBeenCalledTimes(previousSceneCount);
  } finally {
    clockSpy.mockRestore();
  }
});

it.each(['automatic', 'manual'] as const)(
  'evicts an expired snapshot on tab resume, then installs fresh geometry after %s startup', async (startup) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  const fetchedAt = new Date(clock - day + 60_000).toISOString();
  let resolveRefresh!: (value: unknown) => void;
  const pendingRefresh = new Promise((resolve) => { resolveRefresh = resolve; });
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false }),
  }).mockReturnValueOnce(pendingRefresh);
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    if (startup === 'manual') {
      vi.stubGlobal('IntersectionObserver', class {
        observe() {}
        disconnect() {}
      });
    }
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    if (startup === 'manual') {
      fireEvent.click(within(dialog).getByRole('button', { name: '手動開啟立體畫面' }));
    }
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();

    // Crossing the freshness boundary on tab resume must mark the saved
    // geometry stale AND start exactly one bounded revalidation, rather than
    // leaving the map stale until the user finds the manual retry action.
    clock += 2 * 60_000;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    // Do not spend public OSM quota refreshing an unseen, still-retainable map.
    // The visible resume must do exactly one revalidation instead.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    // Hidden soft expiry has already advanced the timer to seven-day hard
    // expiry. Visibility and pageshow must still revalidate exactly once.
    fireEvent(window, new Event('pageshow'));
    expect(await within(dialog).findByText(/暫用舊快照/)).toBeTruthy();
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/正在檢查更新，暫時保留舊輪廓/)).toBeTruthy();
    // A second resume event while the refresh is pending must not issue an
    // extra request or recreate WebGL geometry.
    const sceneCountWhileStale = scene.create.mock.calls.length;
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scene.create).toHaveBeenCalledTimes(sceneCountWhileStale);

    // A suspended device can pass the seven-day deadline before timers fire.
    clock += 6 * day;
    fireEvent(window, new Event('pageshow'));
    // Expired geometry is not rendered while a replacement request is pending.
    expect(await within(dialog).findByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(within(dialog).queryByText(new RegExp(`資料讀取：${fetchedAt.slice(0, 10)}`))).toBeNull();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    const previousSceneCount = scene.create.mock.calls.length;
    fireEvent(document, new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const updatedBuildings = buildings.map((building) => ({ ...building, heightMeters: building.heightMeters + 1, heightBasis: 'osm-tag' as const }));
    await act(async () => resolveRefresh({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings: updatedBuildings,
        fetchedAt: new Date(clock).toISOString(), stale: false,
      }),
    }));
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(updatedBuildings));
    expect(scene.create).toHaveBeenCalledTimes(previousSceneCount + 1);
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();
    expect(within(dialog).getByText(`資料讀取：${new Date(clock).toISOString().slice(0, 10)}`)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    clockSpy.mockRestore();
  }
});

it('bounds the first hard-expiry timer for an already-stale OSM snapshot', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  // A valid two-day-old snapshot has five days until hard expiry.
  // Recheck its absolute deadline in daily steps instead of waiting five days.
  const fetchedAt = new Date(now - 2 * day).toISOString();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === day)).toBe(true);
    expect(timerSpy.mock.calls.some(([, delay]) =>
      typeof delay === 'number' && delay > day)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it('keeps the hard-expiry eviction armed after a hidden soft-deadline timer', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  const fetchedAt = new Date(clock - day + 60_000).toISOString();
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false }),
  }).mockReturnValueOnce(new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();

    // Simulate the real timeout callback while the browser is backgrounded.
    // No visibilitychange event should be needed to enforce hard retention.
    const softTimer = timerSpy.mock.calls.find(([, delay]) => delay === 60_000);
    expect(softTimer).toBeTruthy();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const originalClock = clock;
    // An extreme wall-clock correction must not schedule a timeout larger
    // than a day (which could overflow the browser's 32-bit timer).
    clock -= 30 * day;
    act(() => { (softTimer![0] as () => void)(); });
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();
    const boundedTimer = timerSpy.mock.calls.filter(([, delay]) => delay === day).at(-1);
    expect(boundedTimer).toBeTruthy();
    // The next timer may also fire early after the clock is corrected again.
    clock = originalClock - 120_000;
    act(() => { (boundedTimer![0] as () => void)(); });
    const rearmedSoft = timerSpy.mock.calls.find(([, delay]) => delay === 180_000);
    expect(rearmedSoft).toBeTruthy();
    clock = originalClock + 90_000;
    act(() => { (rearmedSoft![0] as () => void)(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();

    // The soft timeout must schedule a *new* seven-day expiry timeout.
    const deadline = Date.parse(fetchedAt) + 7 * day;
    // The initial hard-expiry timer must be bounded too; its callback will
    // re-arm as the seven-day absolute deadline approaches.
    const hardTimer = timerSpy.mock.calls.filter(([, delay]) => delay === day).at(-1);
    expect(hardTimer).toBeTruthy();
    // An early hard-expiry callback (after time sync) must re-arm eviction,
    // rather than leaving old source geometry visible past seven days.
    clock = deadline - 120_000;
    act(() => { (hardTimer![0] as () => void)(); });
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rearmedHard = timerSpy.mock.calls.filter(([, delay]) => delay === 120_000).at(-1);
    expect(rearmedHard).toBeTruthy();
    const sceneCountBeforeExpiry = scene.create.mock.calls.length;
    clock = deadline + 1_000;
    act(() => { (rearmedHard![0] as () => void)(); });
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    // Hard expiry clears the old geometry, but the hidden-tab WebGL fix
    // must not recreate a graphics context until the tab is visible again.
    expect(scene.create).toHaveBeenCalledTimes(sceneCountBeforeExpiry);
    expect(scene.dispose).toHaveBeenCalled();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    // Expiry must not wake the public OSM origin while in the background.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // On resume, WebGL must finally receive the now-empty geometry, not
    // resurrect the expired building that was visible before backgrounding.
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(scene.create).toHaveBeenCalledTimes(sceneCountBeforeExpiry + 1);
    expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
    // pageshow can follow visibilitychange on mobile; only one request is valid.
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it.each(['visibilitychange', 'timer'])('drops geometry at the earlier OSM replication deadline via %s when the response is expired', async (trigger) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  // Valid metadata: HTTP fetch is less than 48 hours after Overpass sync.
  const fetchedAt = new Date(clock - 5 * day + 60_000).toISOString();
  const osmBaseAt = new Date(Math.floor((clock - 7 * day + 120_000) / 1000) * 1000)
    .toISOString().replace('.000Z', 'Z');
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, osmBaseAt, stale: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    clock += 3 * 60_000;
    if (trigger === 'timer') {
      const expiryTimer = timerSpy.mock.calls.find(([, delay]) =>
        typeof delay === 'number' && delay > 119_000 && delay <= 120_000);
      expect(expiryTimer).toBeTruthy();
      act(() => { (expiryTimer![0] as () => void)(); });
    } else {
      fireEvent(document, new Event('visibilitychange'));
    }
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).queryByText(new RegExp(`資料讀取：${fetchedAt.slice(0, 10)}`))).toBeNull();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it.each(['failure', 'timeout'])('does not resurrect a seven-day-old outline after refresh %s', async (outcome) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  let rejectRefresh!: (reason: Error) => void;
  const pendingRefresh = new Promise<unknown>((_resolve, reject) => { rejectRefresh = reject; });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date(clock - 7 * day + 60_000).toISOString(), stale: true,
      }),
    })
    .mockReturnValueOnce(pendingRefresh);
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/正在檢查更新/)).toBeTruthy();

    clock += 2 * 60_000;
    fireEvent(window, new Event('pageshow'));
    // React removes the expired volume immediately, but SpatialCanvas creates
    // its replacement Three.js scene after an asynchronous dynamic import.
    // Await that new scene rather than inspecting the disposed previous scene.
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (outcome === 'timeout') {
      const requestTimer = timerSpy.mock.calls.filter(([, delay]) => delay === 15_000).at(-1);
      expect(requestTimer).toBeTruthy();
      act(() => { (requestTimer![0] as () => void)(); });
    }
    await act(async () => { rejectRefresh(new Error('offline after snapshot expiry')); });
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前/)).toBeNull();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it('rejects an expired OSM API snapshot while keeping the known place and walking directions', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const outline = [
    { lat: 24.22624, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58131 },
  ];
  const buildings = parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry: outline, tags: { building: 'yes' } }],
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      stale: false,
    }),
  }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});


it('uses current official Providence Hall floor unit names without inventing classroom coordinates', async () => {
  const zhugu = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  // Official floor labels must remain usable when live Overpass data fails:
  // they are not inferred from 3D building heights or fabricated floor plans.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 503, headers: { get: () => null }, body: null,
  }));
  render(<CampusSpatialExplorer school="pu" locations={[zhugu]} selected={zhugu} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(within(dialog).getByRole('heading', { name: '主顧樓' })).toBeTruthy();
  // Every floor must stay individually scannable on narrow screens, even if
  // Overpass is unavailable. These are official *unit locations*, not rooms.
  expect(within(dialog).getByText('4 樓：資訊管理學系、人工智慧應用學系。')).toBeTruthy();
  expect(within(dialog).getByText('5 樓：資訊工程學系。')).toBeTruthy();
  expect(within(dialog).getByText('6 樓：資訊學院、台灣文學系、管理碩士在職專班（EMBA）。')).toBeTruthy();
  expect(within(dialog).getByText('7 樓：會計室、校友聯絡暨就業輔導室、國際暨兩岸事務處。')).toBeTruthy();
  expect(within(dialog).getByText('8 樓：校長室、副校長室、秘書室、研發處、人事室。')).toBeTruthy();
  const officialUnits = within(dialog).getByRole('link', { name: '查看校史資料室主顧樓單位清單' });
  expect(officialUnits.getAttribute('href')).toBe('https://c067.pu.edu.tw/p/412-1121-4218.php');
  expect(officialUnits.getAttribute('target')).toBe('_blank');
  expect(officialUnits.getAttribute('rel')).toBe('noopener noreferrer');
  expect(within(dialog).queryByText(/資訊傳播工程學系/)).toBeNull();
  expect(within(dialog).getByText(/依校方校史資料室公開的主顧樓樓層單位資訊/).textContent)
    .toContain('這不是教室座標');
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// A colliding Firestore POI ID is not proof that the selected map marker is
// the audited campus building. Do not label a different position as the
// university's official floor units, even when the OSM service is unavailable.
it.each([
  { mismatch: 'displaced coordinates', displaced: true },
  { mismatch: 'different name', displaced: false },
])('does not attach official Zhugu floor units to a $mismatch POI', async ({ displaced }) => {
  const zhugu = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  const unverified: MapLocation = displaced
    ? { ...zhugu, lat: zhugu.lat + 0.004 }
    : { ...zhugu, name: '主顧樓（位置待查）' };
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[unverified]} selected={unverified} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(within(dialog).getByRole('heading', { name: unverified.name })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/目前篩選的地點沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(within(dialog).queryByText('主顧樓 · 校方公開樓層資訊')).toBeNull();
  expect(within(dialog).queryByText(/4 樓：資訊管理學系/)).toBeNull();
  expect(within(dialog).queryByRole('link', { name: '查看校史資料室主顧樓單位清單' })).toBeNull();
  const notice = within(dialog).getByText(/尚未與校園已核對資料對上.*暫不顯示校方樓層單位/);
  expect(notice.getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(within(dialog).queryByRole('link', { name: '查看地點資料來源 ↗' })).toBeNull();
});

it('withdraws filtered-out Providence volumes and counts only buildings in the current map', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const zhugu = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes', height: '100 m' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({
    schoolId: 'pu', source: 'OpenStreetMap', buildings,
    fetchedAt: new Date().toISOString(), stale: false,
  }) });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const view = render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={onSelect} />);
  const dialog = await open();
  await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings));
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  // A sourced numerical height must be distinguishable from a 12m illustrative volume.
  expect(within(dialog).getByText(/高度：100 公尺.*OSM 使用者標註.*非校方實測/)).toBeTruthy();
  expect(within(dialog).queryByText(/高度：12 公尺示意/)).toBeNull();
  const beforeFilter = scene.create.mock.calls.length;

  // Offer the exact, audited way rather than only a generic OSM copyright
  // link. A field visitor can inspect the original outline without confusing
  // it with a validated entrance, room, or campus route.
  const sourceLink = within(dialog).getByRole('link', {
    name: '查看此棟建築的 OpenStreetMap 原始輪廓',
  });
  expect(sourceLink.getAttribute('href')).toBe('https://www.openstreetmap.org/way/255784049');
  expect(sourceLink.getAttribute('href')).toBe(buildings[0].sourceUrl);
  expect(sourceLink.getAttribute('target')).toBe('_blank');
  expect(sourceLink.getAttribute('rel')).toBe('noopener noreferrer');

  // A same-school map filter does not unmount the spatial dialog or refetch
  // Overpass. The previous library way is no longer part of this view.
  view.rerender(<CampusSpatialExplorer school="pu" locations={[zhugu]} selected={zhugu} onSelect={onSelect} />);
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: zhugu.id } });
  await waitFor(() => expect(scene.create.mock.calls.length).toBeGreaterThan(beforeFilter));
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByText(/0 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).getByText(/此地點沒有可用的已核對 OSM 建築外框.*不代表已驗證入口/)).toBeTruthy();
  expect(within(dialog).queryByText(/高度：100 公尺/)).toBeNull();
  // A source from a filtered-out POI must never appear under a different
  // building's details, even while the old network snapshot remains cached.
  expect(within(dialog).queryByRole('link', {
    name: '查看此棟建築的 OpenStreetMap 原始輪廓',
  })).toBeNull();
  expect(within(dialog).getByRole('heading', { name: zhugu.name })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


// The filtered spatial overlay cannot display a sourced 3D volume if its
// entire view is transit stops. Do not spend OSM/Overpass bandwidth on it.
it('skips public footprint fetch for a bus-stop-only Providence tour, then loads when a building enters the view', async () => {
  const stop = PROVIDENCE_BUS_STOPS.find((place) => place.id === 'pu-bus-main-a')!;
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503, headers: { get: () => null }, body: null,
  });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const view = render(<CampusSpatialExplorer school="pu" locations={[stop]} selected={stop} onSelect={onSelect} />);
  const dialog = await open();
  expect(within(dialog).getByText(/目前篩選的地點沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(within(dialog).queryByRole('button', { name: '重新讀取建築輪廓' })).toBeNull();
  expect(within(dialog).getByRole('heading', { name: stop.name })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' })).toBeTruthy();

  // The same open dialog receives a new map filter. Only now is requesting
  // building outlines useful; a 503 still retains the normal marker fallback.
  view.rerender(<CampusSpatialExplorer school="pu" locations={[stop, library]} selected={library} onSelect={onSelect} />);
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: library.id } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(within(dialog).queryByText(/沒有已核對的 OSM 建築輪廓候選來源/)).toBeNull();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('aborts an in-flight OSM download when a Providence filter changes to transit stops only', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const stop = PROVIDENCE_BUS_STOPS.find((place) => place.id === 'pu-bus-main-a')!;
  let requestSignal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url: string, options: { signal: AbortSignal }) => {
    requestSignal = options.signal;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const view = render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={onSelect} />);
  const dialog = await open();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(requestSignal?.aborted).toBe(false);

  // A mobile map filter may be changed before the public API replies. The
  // no-candidate path must cancel that request and never show old geometry.
  view.rerender(<CampusSpatialExplorer school="pu" locations={[stop]} selected={stop} onSelect={onSelect} />);
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: stop.id } });
  await waitFor(() => expect(requestSignal?.aborted).toBe(true));
  expect(within(dialog).getByText(/沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps relation-only Providence POIs navigable without requesting unsupported way-only outlines', async () => {
  const relationPlace = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-xijia')!;
  // Relations have an audited map source but are not rendered by the current
  // way-only footprint parser. Never pay for an unusable Overpass download.
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[relationPlace]}
    selected={relationPlace} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/沒有已核對的 OSM 建築輪廓候選來源/)).toBeTruthy();
  expect(within(dialog).getByRole('heading', { name: relationPlace.name })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '查看地點資料來源 ↗' }).getAttribute('href'))
    .toBe('https://www.openstreetmap.org/relation/9246899');
});

it('discloses missing audited way outlines without treating a partial OSM reply as complete coverage', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const zhugu = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  // Synthetic partial source: one of two audited ways has a displayable outline.
  // The absent way is not proof that its physical building or entrance vanished.
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library, zhugu]}
    selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).getByText(/另有 1 筆清單中的 OSM 建築 way 未取得可顯示的有效外框/))
    .toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


it('does not crash or eagerly start WebGL when a WebView VisualViewport getter throws, then recovers', async () => {
  // Some embedded browsers expose a VisualViewport property that throws
  // during restoration. This is not equivalent to an API being unsupported.
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  let throwOnRead = true;
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    get() {
      if (throwOnRead) throw new Error('visual viewport temporarily unavailable');
      return viewport;
    },
  });
  try {
    render(<CampusSpatialExplorer school="other-school" locations={places}
      selected={places[0]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = screen.getByRole('dialog', { name: '校園空間導覽' });
    const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
    const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
      width: 320, height: 180, toJSON: () => ({}),
    } as DOMRect);
    try {
      expect(scene.create).not.toHaveBeenCalled();
      expect(graphics.parentElement?.getAttribute('data-spatial-state')).toBe('deferred');
      expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
      // No second observer result: window.resize is enough to recover an
      // already confirmed intersection once the getter and geometry work.
      throwOnRead = false;
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
      expect(scene.setActive).toHaveBeenLastCalledWith(true);
      // The recovered viewport now receives its own resize listener.
      viewport.height = 10;
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(scene.setActive).toHaveBeenLastCalledWith(false);
      viewport.height = window.innerHeight;
      act(() => viewport.dispatchEvent(new Event('scroll')));
      expect(scene.setActive).toHaveBeenLastCalledWith(true);
      expect(scene.create).toHaveBeenCalledTimes(1);
      fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
      scene.setActive.mockClear();
      act(() => viewport.dispatchEvent(new Event('resize')));
      expect(scene.setActive).not.toHaveBeenCalled();
    } finally {
      bounds.mockRestore();
    }
  } finally {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else Reflect.deleteProperty(window, 'visualViewport');
  }
});

it('rebinds viewport events after Safari page restoration replaces the VisualViewport instance', async () => {
  const first = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  const restored = Object.assign(new EventTarget(), {
    width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0,
  });
  vi.stubGlobal('visualViewport', first);
  render(<CampusSpatialExplorer school="other-school" locations={places}
    selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const graphics = within(dialog).getByRole('group', { name: '校園地點空間圖' });
  const bounds = vi.spyOn(graphics, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 40, left: 0, top: 40, right: 320, bottom: 220,
    width: 320, height: 180, toJSON: () => ({}),
  } as DOMRect);
  try {
    vi.stubGlobal('visualViewport', restored);
    fireEvent(window, new Event('pageshow'));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    const callsAfterRebind = scene.setActive.mock.calls.length;
    first.height = 10;
    act(() => first.dispatchEvent(new Event('resize')));
    expect(scene.setActive.mock.calls.length).toBe(callsAfterRebind);
    // Only the new, actually visible viewport may control the live scene.
    restored.height = 10;
    act(() => restored.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).toHaveBeenLastCalledWith(false);
    restored.height = window.innerHeight;
    act(() => restored.dispatchEvent(new Event('resize')));
    expect(scene.setActive).toHaveBeenLastCalledWith(true);
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
    scene.setActive.mockClear();
    act(() => restored.dispatchEvent(new Event('scroll')));
    expect(scene.setActive).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore();
  }
});
