import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TronClassHomeworkComposer } from './TronClassHomeworkComposer';
import { submitTronClassHomework } from '@/lib/tronClassLms';

vi.mock('@/lib/tronClassLms', () => ({ submitTronClassHomework: vi.fn() }));

const props = {
  uid: 'pu-student',
  courseId: 10001,
  homeworkId: 20001,
  href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(submitTronClassHomework).mockReset();
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
  expect(screen.getByText('我的作業內容')).toBeTruthy();
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
