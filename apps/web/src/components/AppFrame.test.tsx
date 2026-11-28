import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppFrame } from './AppFrame';

const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./AppHeader', () => ({ AppHeader: () => <header>nuni</header> }));

afterEach(() => {
  navigation.pathname = '/';
  vi.restoreAllMocks();
});

it('keeps the current task and the skip destination when connectivity changes', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  render(
    <AppFrame contentId="today-content" header={<header>今天</header>}>
      <input aria-label="尚未送出的內容" defaultValue="下週小組報告" />
    </AppFrame>,
  );
  const field = screen.getByRole('textbox', { name: '尚未送出的內容' });
  field.focus();
  fireEvent(window, new Event('offline'));
  expect(screen.getByRole('status').textContent).toContain('目前沒有網路連線');
  expect(document.activeElement).toBe(field);
  expect((field as HTMLInputElement).value).toBe('下週小組報告');
  expect(screen.getByRole('link', { name: '跳到主要內容' }).getAttribute('href')).toBe(
    '#today-content',
  );
  expect(screen.getByRole('main').id).toBe('today-content');
  fireEvent(window, new Event('online'));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('textbox')).toBe(field);
});

it('offers a waiting update without reloading or discarding the active task', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  const postMessage = vi.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue({ waiting: { postMessage } }) },
  });
  try {
    render(
      <AppFrame>
        <input aria-label="草稿" defaultValue="保留我的內容" />
      </AppFrame>,
    );
    expect(await screen.findByRole('region', { name: '版本更新' })).toBeTruthy();
    expect(screen.getByText('儲存正在編輯的內容後，再重新載入。')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '草稿' }) as HTMLInputElement).value).toBe(
      '保留我的內容',
    );
    expect(postMessage).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(navigator, 'serviceWorker', original);
    else Reflect.deleteProperty(navigator, 'serviceWorker');
  }
});

it('keeps installation unobtrusive during a task and dismissible on the life page', async () => {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  try {
    const content = () => (
      <AppFrame>
        <h1>今天的課程</h1>
        <input aria-label="尚未送出的內容" defaultValue="下週小組報告" />
      </AppFrame>
    );
    const page = render(content());
    const field = screen.getByRole('textbox', { name: '尚未送出的內容' });
    field.focus();
    const prompt = vi.fn();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe('下週小組報告');
    expect(prompt).not.toHaveBeenCalled();

    navigation.pathname = '/life';
    page.rerender(content());
    expect(screen.getByRole('region', { name: '加入主畫面' })).toBeTruthy();
    expect(document.activeElement).toBe(field);
    fireEvent.click(screen.getByRole('button', { name: '暫時不用' }));
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    expect(screen.getByRole('heading', { name: '今天的課程' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '尚未送出的內容' })).toBe(field);
    expect((field as HTMLInputElement).value).toBe('下週小組報告');
    expect(prompt).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window, 'matchMedia', original);
    else Reflect.deleteProperty(window, 'matchMedia');
  }
});
