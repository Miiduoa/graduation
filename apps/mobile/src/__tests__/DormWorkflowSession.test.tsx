import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { DormWorkflow } from '../components/dorm/DormWorkflow';

let mockFirebaseUid: string | null;
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({
    currentUser: mockFirebaseUid ? { uid: mockFirebaseUid, getIdToken: async () => mockFirebaseUid } : null,
  }),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../ui/aiFirst', () => ({ aiTokens: { border: '#ddd', text: '#111', ai: '#355e52' } }));

const notification = { notificationView: 'announcements', dormAnnouncementId: 'same-id' };
const detail = (uid: string) => <DormWorkflow schoolId="pu" uid={uid}
  residentSection="announcements" notificationParams={notification} />;
const result = (body: string) => ({
  result: { announcements: [{ id: 'same-id', building: 'A', title: '本棟公告', body }] },
});
const response = (json: () => Promise<unknown>) => ({ ok: true, json }) as Response;

const originalFetch = globalThis.fetch;
const fetch = jest.fn<ReturnType<typeof globalThis.fetch>, Parameters<typeof globalThis.fetch>>();
beforeEach(() => { globalThis.fetch = fetch; });
afterEach(() => { globalThis.fetch = originalFetch; fetch.mockReset(); });

test('a resident screen cannot borrow a different Firebase account for hosted dorm calls', async () => {
  mockFirebaseUid = 'resident-a';
  fetch.mockRejectedValue(new Error('unexpected request'));
  const view = render(detail('resident-b'));
  await view.findByText('宿舍服務暫時無法使用，請稍後再試。');
  expect(fetch).not.toHaveBeenCalled();
});

test.each([null, 'resident-b'])('a late bulletin stays hidden when Firebase changes to %s before its body finishes', async (nextUid) => {
  mockFirebaseUid = 'resident-a';
  let finish!: (body: unknown) => void;
  const delayed = jest.fn(() => new Promise<unknown>((resolve) => { finish = resolve; }));
  fetch.mockImplementation(async (_url, options) => {
    const { action } = JSON.parse(String(options?.body)).data;
    if (action === 'config') return response(async () => ({ result: { enabled: true } }));
    if (options?.headers && (options.headers as Record<string, string>).Authorization === 'Bearer resident-b') {
      return response(async () => result('乙住戶公告內容'));
    }
    return response(delayed);
  });
  const view = render(detail('resident-a'));
  await waitFor(() => expect(delayed).toHaveBeenCalledTimes(1));
  mockFirebaseUid = nextUid;
  await act(async () => { finish(result('甲住戶公告內容')); });
  expect(view.queryByText('甲住戶公告內容')).toBeNull();
  await view.findByText('無法讀取宿舍紀錄，請稍後再試。');
  expect(fetch).toHaveBeenCalledTimes(2);
  if (nextUid) {
    view.rerender(detail(nextUid));
    await view.findByText('乙住戶公告內容');
    expect(view.queryByText('甲住戶公告內容')).toBeNull();
  }
});
