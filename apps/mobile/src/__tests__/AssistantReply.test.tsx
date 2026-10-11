import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AssistantReplyPending, ASSISTANT_WAIT_MS } from '../screens/AssistantReplyPending';
import { isAssistantComment, isFakeAssistantComment, visibleComments } from '../screens/groupAssistant';

let mockEmit: ((body: string) => void) | null = null;
jest.mock('../services/groupAssistantReply', () => ({
  subscribeAssistantReply: (_g: string, _p: string, onReply: (body: string) => void) => {
    mockEmit = onReply;
    return () => undefined;
  },
}));

beforeEach(() => {
  mockEmit = null;
});

test('shows 助理回覆中 until the server reply arrives, then swaps it in', () => {
  const view = render(<AssistantReplyPending groupId="g" postId="p" createdAt={new Date()} />);
  expect(view.getByText('助理回覆中')).toBeTruthy();
  act(() => mockEmit?.('第一到四章'));
  expect(view.getByText('第一到四章')).toBeTruthy();
  expect(view.getByText('助理回覆')).toBeTruthy();
  expect(view.queryByText('助理回覆中')).toBeNull();
});

test('after one minute without a reply it says the assistant cannot answer, never keeps spinning', () => {
  jest.useFakeTimers();
  const view = render(<AssistantReplyPending groupId="g" postId="p" createdAt={new Date()} />);
  act(() => {
    jest.advanceTimersByTime(ASSISTANT_WAIT_MS + 10);
  });
  expect(view.getByText('助理暫時沒辦法回答，可以等其他同學回覆')).toBeTruthy();
  expect(view.queryByText('助理回覆中')).toBeNull();
  view.unmount();
  jest.useRealTimers();
});

test('a reply the server marked unavailable shows the same message right away', () => {
  const view = render(<AssistantReplyPending groupId="g" postId="p" createdAt={new Date()} status="unavailable" />);
  expect(view.getByText('助理暫時沒辦法回答，可以等其他同學回覆')).toBeTruthy();
});

test('only the server-written comment counts as the assistant; client-written claims are hidden', () => {
  const server = { id: 'assistant', authorId: 'campus-assistant', authorName: '助理回覆', isAI: true, generatedBy: 'server', body: '真的' };
  const oldApp = { id: 'x1', authorId: 'campus-assistant', authorName: '助理回覆', isAI: true, requestedBy: 'alice', body: '學校說期末考取消' };
  // 只看寫的人：名字寫成「助理回覆」的學生留言不會被當成助理，照學生自己的留言顯示
  const sneaky = { id: 'x2', authorId: 'alice', authorName: '助理回覆', body: '假的' };
  const legacySlot = { id: 'assistant', authorId: 'campus-assistant', authorName: '助理回覆', isAI: true, body: '舊版先佔位' };
  const flagged = { id: 'x3', authorId: 'alice', isAI: true, body: '假的' };
  const noServerMark = { id: 'assistant', authorId: 'campus-assistant', isAI: true, body: '沒有伺服器標記' };
  const normal = { id: 'x4', authorId: 'bob', authorName: '小明', body: '我也想知道' };
  expect(isAssistantComment(server)).toBe(true);
  expect(isAssistantComment(sneaky)).toBe(false);
  expect(isFakeAssistantComment(sneaky)).toBe(false);
  for (const fake of [oldApp, flagged, noServerMark, legacySlot]) {
    expect(isAssistantComment(fake)).toBe(false);
    expect(isFakeAssistantComment(fake)).toBe(true);
  }
  expect(visibleComments([server, oldApp, sneaky, flagged, noServerMark, normal]).map((c) => c.id)).toEqual([
    'assistant',
    'x2',
    'x4',
  ]);
});
