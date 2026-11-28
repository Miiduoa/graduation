import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { answerPublicCourseQuestion } from '@campus/shared/src/publicCourseAssistantClient';
import { AssistantConversation } from './LegacyAssistant';

vi.mock('@campus/shared/src/publicCourseAssistantClient', async (original) => ({
  ...(await original<typeof import('@campus/shared/src/publicCourseAssistantClient')>()),
  answerPublicCourseQuestion: vi.fn(),
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => false,
}));
function Fixture() {
  const [text, setText] = useState('查清大資料庫課程');
  return (
    <>
      <label>
        首頁的新問題
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <AssistantConversation
        userId="alice"
        localOwner="school:alice"
        groupId=""
        schoolId="pu"
        initialDraft=""
        inline
        inlineDraft={{ text, setText }}
      />
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps a newer home draft when a pending public course lookup completes', async () => {
  let finish!: (value: Awaited<ReturnType<typeof answerPublicCourseQuestion>>) => void;
  vi.mocked(answerPublicCourseQuestion).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Fixture />);
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(answerPublicCourseQuestion).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('首頁的新問題'), {
    target: { value: '下一個要討論的問題' },
  });
  await act(async () => {
    finish({ content: '查課已回覆', read: undefined });
  });
  expect(screen.getByText('查課已回覆')).toBeTruthy();
  expect((screen.getByLabelText('首頁的新問題') as HTMLInputElement).value).toBe(
    '下一個要討論的問題',
  );
});

it('clears only the submitted public course draft when it was not edited', async () => {
  vi.mocked(answerPublicCourseQuestion).mockResolvedValue({
    content: '查課已回覆',
    read: undefined,
  });
  render(<Fixture />);
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  await screen.findByText('查課已回覆');
  expect((screen.getByLabelText('首頁的新問題') as HTMLInputElement).value).toBe('');
});
