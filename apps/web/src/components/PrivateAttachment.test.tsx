import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPrivateFileObjectPath } from '@campus/shared/src/privateFileMedia';
import { PrivateAttachment } from './PrivateAttachment';

const state = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/lib/privateFiles', () => ({
  isPrivateFileObjectPath,
  resolvePrivateMedia: state.resolve,
}));
vi.mock('./PrivateImage', () => ({
  PrivateImage: ({ src, alt }: { src: string; alt: string }) => (
    <span data-testid="preview" data-src={src}>
      {alt}
    </span>
  ),
}));

const A = 'groups/g1/posts/p1/report-a.pdf';
const B = 'groups/g1/posts/p1/report-b.pdf';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const clicks: Array<{ href: string; download: string }> = [];
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  clicks.length = 0;
  createObjectURL.mockImplementation(() => 'blob:campus/1');
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  state.resolve.mockReset();
});

const downloadButton = (name: RegExp | string = /下載/) => screen.getByRole('button', { name });
async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

describe('private object downloads', () => {
  it('downloads only the resolved Blob, reports start, and revokes the object URL later', async () => {
    state.resolve.mockResolvedValue(new Blob(['x']));
    render(<PrivateAttachment path={A} />);
    expect(screen.getByText('report-a.pdf')).toBeTruthy();
    expect(downloadButton('下載 report-a.pdf').className).toContain('btn');

    await press(downloadButton());
    expect(state.resolve).toHaveBeenCalledWith(A);
    expect(clicks).toEqual([{ href: 'blob:campus/1', download: 'report-a.pdf' }]);
    expect(screen.getByRole('status').textContent).toBe('已開始下載，請查看瀏覽器的下載項目。');
    expect(screen.getByRole('status').textContent).not.toMatch(/完成/);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:campus/1');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('keeps focus on an in-place busy button and ignores repeat activation', async () => {
    const pending = deferred<Blob>();
    state.resolve.mockReturnValue(pending.promise);
    render(<PrivateAttachment path={A} />);
    const button = downloadButton();
    button.focus();
    await press(button);

    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toContain('準備中…');
    expect(screen.getByRole('status').textContent).toBe('正在準備下載…');
    await press(button);
    await press(button);
    expect(state.resolve).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(new Blob(['x'])));
    expect(clicks).toHaveLength(1);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('shows an in-place error, retries from the same focused control, then reports success', async () => {
    state.resolve.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'));
    render(<PrivateAttachment path={A} />);
    const button = downloadButton();
    button.focus();

    await press(button);
    expect(screen.getByRole('status').textContent).toContain('請重試');
    expect(button.textContent).toContain('重試');
    expect(document.activeElement).toBe(button);
    expect(clicks).toHaveLength(0);

    await press(button);
    expect(screen.getByRole('status').textContent).toContain('請重試');
    expect(state.resolve).toHaveBeenCalledTimes(2);

    state.resolve.mockResolvedValueOnce(new Blob(['x']));
    await press(button);
    expect(screen.getByRole('status').textContent).toContain('已開始下載');
    expect(button.textContent).toContain('下載');
    expect(clicks).toHaveLength(1);
    expect(document.activeElement).toBe(button);
  });

  it('never turns a non-Blob resolver result into a download', async () => {
    state.resolve.mockResolvedValue('https://example.test/leak.pdf');
    render(<PrivateAttachment path={A} />);
    await press(downloadButton());
    expect(clicks).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('請重試');
  });

  it('releases the object URL immediately if the browser refuses the click', async () => {
    state.resolve.mockResolvedValue(new Blob(['x']));
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<PrivateAttachment path={A} />);
    await press(downloadButton());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:campus/1');
    expect(screen.getByRole('status').textContent).toContain('請重試');
  });

  it('does not download or create an object URL after unmount', async () => {
    const pending = deferred<Blob>();
    state.resolve.mockReturnValue(pending.promise);
    const view = render(<PrivateAttachment path={A} />);
    await press(downloadButton());
    view.unmount();
    await act(async () => pending.resolve(new Blob(['x'])));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });

  it('ignores a request that fails after unmount', async () => {
    const pending = deferred<Blob>();
    state.resolve.mockReturnValue(pending.promise);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<PrivateAttachment path={A} />);
    await press(downloadButton());
    view.unmount();
    await act(async () => pending.reject(new Error('late')));
    expect(error).not.toHaveBeenCalled();
  });

  it('drops in-flight results across path changes, including A to B to A', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    state.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<PrivateAttachment path={A} />);
    await press(downloadButton());
    expect(screen.getByRole('status').textContent).toBe('正在準備下載…');

    view.rerender(<PrivateAttachment path={B} />);
    expect(screen.getByText('report-b.pdf')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(downloadButton().getAttribute('aria-disabled')).toBeNull();

    view.rerender(<PrivateAttachment path={A} />);
    // The returning row is a fresh one: no stale busy state and it may start its own request.
    expect(screen.getByRole('status').textContent).toBe('');
    await act(async () => first.resolve(new Blob(['old'])));
    expect(clicks).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('');

    await press(downloadButton());
    expect(state.resolve).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(new Blob(['new'])));
    expect(clicks).toEqual([{ href: 'blob:campus/1', download: 'report-a.pdf' }]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not show a previous path\'s error on the next path', async () => {
    state.resolve.mockResolvedValueOnce(null);
    const view = render(<PrivateAttachment path={A} />);
    await press(downloadButton());
    expect(screen.getByRole('status').textContent).toContain('請重試');
    view.rerender(<PrivateAttachment path={B} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(downloadButton().textContent).toContain('下載');
  });

  it('identifies a long filename and its action by the full name', () => {
    render(<PrivateAttachment path={`groups/g1/posts/p1/${'a'.repeat(100)}.pdf`} />);
    expect(screen.getByTitle(`${'a'.repeat(100)}.pdf`)).toBeTruthy();
    expect(downloadButton(`下載 ${'a'.repeat(100)}.pdf`)).toBeTruthy();
  });
});

describe('legacy HTTP(S) links', () => {
  const firebase =
    'https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/groups%2Fg1%2Fposts%2Fp1%2F%E4%BD%9C%E6%A5%AD%20%E4%B8%80.pdf?alt=media&token=SECRET';

  it.each([
    [firebase, '作業 一.pdf'],
    ['https://cdn.example.test/files/My%20Report.docx?X-Signature=SECRET#page=2', 'My Report.docx'],
    ['http://cdn.example.test/a/b/%E4%BD%A0%E5%A5%BD.txt', '你好.txt'],
    ['HTTPS://cdn.example.test/dir/', 'dir'],
    ['https://cdn.example.test/', '附件'],
    ['https://cdn.example.test/files/bad%E4%BD.pdf?token=SECRET', 'bad%E4%BD.pdf'],
    ['https://cdn.example.test/files/100%25%ZZ.pdf', '100%%ZZ.pdf'],
    ['https://cdn.example.test/files/%2e%2e', '附件'],
    ['https://cdn.example.test/files/a%0Ab%E2%80%AEc.txt', 'abc.txt'],
  ])('labels %s as %s without leaking the query', (url, label) => {
    render(<PrivateAttachment path={url} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(url);
    expect(screen.getByText(label, { selector: 'span[title]' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SECRET|token|alt=media|X-Signature/);
    expect(document.body.innerHTML.replace(/href="[^"]*"/, '')).not.toContain('SECRET');
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('opens in a new tab through a real noopener noreferrer anchor, with no download request', () => {
    render(<PrivateAttachment path={firebase} />);
    const link = screen.getByRole('link', { name: '開啟 作業 一.pdf（在新分頁開啟）' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toContain('btn');
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.click(link);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });
});

describe('unavailable paths', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://example.test/a.pdf',
    'blob:https://example.test/id',
    '//example.test/a.pdf',
    ' https://example.test/a.pdf',
    'https://',
    'folder/file.pdf',
    'groups/g1/posts/p1/../secret.pdf',
    'groups%2Fg1%2Fposts%2Fp1%2Fa.pdf',
    '',
  ])('shows %j as unavailable with no action', (path) => {
    render(<PrivateAttachment path={path} />);
    expect(screen.getByRole('status').textContent).toBe('附件無法使用');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('preview')).toBeNull();
    expect(state.resolve).not.toHaveBeenCalled();
  });
});

describe('image rows', () => {
  it('keeps the preview with a contextual alt text and a download action', () => {
    render(<PrivateAttachment path="groups/g1/posts/p1/photo.png" />);
    expect(screen.getByTestId('preview').textContent).toBe('附件圖片：photo.png');
    expect(screen.getByTestId('preview').getAttribute('data-src')).toBe('groups/g1/posts/p1/photo.png');
    expect(downloadButton('下載 photo.png')).toBeTruthy();
  });

  it('judges legacy images by the decoded file name, not by the signed query', () => {
    const { unmount } = render(
      <PrivateAttachment path="https://cdn.example.test/o/a%2Fphoto.JPG?alt=media&token=x.pdf" />,
    );
    expect(screen.getByTestId('preview').textContent).toBe('附件圖片：photo.JPG');
    unmount();
    render(<PrivateAttachment path="https://cdn.example.test/download?file=photo.png" />);
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('does not preview documents', () => {
    render(<PrivateAttachment path={A} />);
    expect(screen.queryByTestId('preview')).toBeNull();
  });
});
