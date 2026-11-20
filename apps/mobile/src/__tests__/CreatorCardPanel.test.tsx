import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CreatorCardPanel } from '../screens/social/CreatorCardPanel';
import { readCreatorCard, saveCreatorCard } from '../services/creatorCard';

jest.mock('../services/creatorCard', () => ({
  readCreatorCard: jest.fn(),
  saveCreatorCard: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readCreatorCard).mockResolvedValue(null);
  jest.mocked(saveCreatorCard).mockResolvedValue({
    headline: '校園攝影', bio: '分享校園生活', linkUrl: '',
  });
});

test('owner edits a public intro and success appears only after confirmation', async () => {
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), '校園攝影');
  fireEvent.changeText(view.getByLabelText('個人簡介'), '分享校園生活');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', {
    headline: '校園攝影', bio: '分享校園生活', linkUrl: '',
  });
  expect(await view.findByText('社群簡介已儲存。')).toBeTruthy();
  expect(view.queryByLabelText('個人簡介')).toBeNull();
});

test('a failed write retains editable content and gives a retryable error', async () => {
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '沒送出的草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(view.getByLabelText('個人簡介').props.value).toBe('沒送出的草稿');
  expect(view.getByText(/輸入內容已保留/)).toBeTruthy();
  expect(view.queryByText('社群簡介已儲存。')).toBeNull();
});

test('peer sees chosen published content but cannot edit', async () => {
  jest.mocked(readCreatorCard).mockResolvedValue({
    headline: '攝影', bio: '簡介', linkUrl: 'https://example.org',
  });
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="bob" own={false} />);
  expect(await view.findByText('攝影')).toBeTruthy();
  expect(view.getByText('簡介')).toBeTruthy();
  expect(view.queryByLabelText('編輯社群簡介')).toBeNull();
  expect(saveCreatorCard).not.toHaveBeenCalled();
});

test('read error is retryable and never shown as unpublished', async () => {
  jest.mocked(readCreatorCard).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(null);
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('重新讀取社群簡介'));
  expect(await view.findByLabelText('建立社群簡介')).toBeTruthy();
  expect(readCreatorCard).toHaveBeenCalledTimes(2);
});
