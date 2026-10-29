import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TronClassHomeworkComposer } from './TronClassHomeworkComposer';
import { checkTronClassHomework, submitTronClassHomework } from '@/lib/tronClassLms';

vi.mock('@/lib/tronClassLms', () => ({
  submitTronClassHomework: vi.fn(), checkTronClassHomework: vi.fn(),
}));

const props = {
  uid: 'pu-student',
  courseId: 10001,
  homeworkId: 20001,
  href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(submitTronClassHomework).mockReset();
  vi.mocked(checkTronClassHomework).mockReset();
});

it('requires text preview and a deliberate second confirmation', async () => {
  vi.mocked(submitTronClassHomework).mockResolvedValue({
    status: 'verified', receiptId: '123', submittedAt: null,
  });
  render(<TronClassHomeworkComposer {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: '繳交內容' }), {
    target: { value: '我的作業內容' },
  });
  expect(submitTronClassHomework).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '預覽並確認繳交' }));
  expect(screen.getByRole('region', { name: '繳交內容預覽' }).textContent).toContain('我的作業內容');
  expect(submitTronClassHomework).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認繳交至玩課雲' }));
  await screen.findByText('已確認繳交');
  expect(submitTronClassHomework).toHaveBeenCalledExactlyOnceWith(
    props.uid, props.courseId, props.homeworkId, '我的作業內容',
  );
  expect(window.sessionStorage.getItem(
    'tronclass-draft:pu-student:10001:20001',
  )).toBeNull();
});

it('keeps an uncertain submission from being sent a second time', async () => {
  vi.mocked(submitTronClassHomework).mockRejectedValue(new Error('尚未確認'));
  render(<TronClassHomeworkComposer {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: '繳交內容' }), {
    target: { value: '未完成回執' },
  });
  fireEvent.click(screen.getByRole('button', { name: '預覽並確認繳交' }));
  fireEvent.click(screen.getByRole('button', { name: '確認繳交至玩課雲' }));
  await screen.findByText('暫停再次送出，避免重複繳交');
  expect(screen.queryByRole('button', { name: '確認繳交至玩課雲' })).toBeNull();
  expect(submitTronClassHomework).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem(
    'tronclass-draft:pu-student:10001:20001',
  )).toBe('未完成回執');
});

it('never offers text POST when the assignment requires files', () => {
  render(<TronClassHomeworkComposer {...props} submissionType="file" />);
  expect(screen.getByText('這份作業需要上傳檔案')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('link', { name: '開啟玩課雲繳交' }).getAttribute('href'))
    .toBe(props.href);
});

it('keeps draft data isolated per account and assignment', async () => {
  window.sessionStorage.setItem('tronclass-draft:pu-student:10001:20001', '自己的草稿');
  const { rerender } = render(<TronClassHomeworkComposer {...props} />);
  await waitFor(() => {
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('自己的草稿');
  });
  rerender(<TronClassHomeworkComposer {...props} uid="pu-other" />);
  await waitFor(() => {
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });
});


it('verifies a pending school receipt without submitting the text again', async () => {
  vi.mocked(submitTronClassHomework).mockResolvedValue({
    status: 'pending', receiptId: '321', submittedAt: null,
  });
  vi.mocked(checkTronClassHomework).mockResolvedValue({
    status: 'verified', receiptId: '321', submittedAt: '2026-10-29T10:00:00Z',
    checkedAt: '2026-10-29T10:01:00Z',
  });
  render(<TronClassHomeworkComposer {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: '繳交內容' }), {
    target: { value: '寫好的報告' },
  });
  fireEvent.click(screen.getByRole('button', { name: '預覽並確認繳交' }));
  fireEvent.click(screen.getByRole('button', { name: '確認繳交至玩課雲' }));
  await screen.findByText('已送出，等待校方確認');
  fireEvent.click(screen.getByRole('button', { name: '重新查核校方回執' }));
  await screen.findByText('已確認繳交');
  expect(submitTronClassHomework).toHaveBeenCalledTimes(1);
  expect(checkTronClassHomework).toHaveBeenCalledExactlyOnceWith(
    props.uid, props.courseId, props.homeworkId,
  );
});

it('checks a previously submitted assignment without posting new content', async () => {
  vi.mocked(checkTronClassHomework).mockResolvedValue({
    status: 'verified', receiptId: '555', submittedAt: null,
    checkedAt: '2026-10-29T10:01:00Z',
  });
  render(<TronClassHomeworkComposer {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '查核校方繳交紀錄' }));
  await screen.findByText('已確認繳交');
  expect(submitTronClassHomework).not.toHaveBeenCalled();
});

it('keeps ambiguous writes locked in the UI if the school still has no receipt', async () => {
  vi.mocked(submitTronClassHomework).mockRejectedValueOnce(new Error('校方逾時'));
  vi.mocked(checkTronClassHomework).mockResolvedValue({
    status: 'not_submitted', receiptId: null, submittedAt: null,
    checkedAt: '2026-10-29T10:01:00Z',
  });
  render(<TronClassHomeworkComposer {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: '繳交內容' }), {
    target: { value: '保留草稿' },
  });
  fireEvent.click(screen.getByRole('button', { name: '預覽並確認繳交' }));
  fireEvent.click(screen.getByRole('button', { name: '確認繳交至玩課雲' }));
  await screen.findByText('暫停再次送出，避免重複繳交');
  fireEvent.click(screen.getByRole('button', { name: '查核校方繳交結果' }));
  await screen.findByText(/校方尚未回傳可確認的繳交紀錄/);
  expect(screen.queryByRole('button', { name: '確認繳交至玩課雲' })).toBeNull();
  expect(submitTronClassHomework).toHaveBeenCalledTimes(1);
});
