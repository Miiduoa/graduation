import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  EMPTY_COMPOSER_DRAFT, chooseComposerSuggestion, editComposerDraft,
  restoreComposerDraft, sendComposerDraft,
} from './composerDraft';

it('does not save blank input or an untouched suggestion', () => {
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '  ', '建議一');
  const second = chooseComposerSuggestion(first.draft, first.question, '建議二');
  assert.equal(second.draft.saved, null);
  assert.equal(second.question, '建議二');
});

it('preserves the original across consecutive suggestion choices', () => {
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '我的原稿', '建議一');
  const second = chooseComposerSuggestion(first.draft, first.question, '建議二');
  assert.equal(second.draft.saved, '我的原稿');
  assert.equal(second.question, '建議二');
});

it('restores an original and discards only an unchanged suggestion', () => {
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '我的原稿', '建議一');
  const result = restoreComposerDraft(first.draft, first.question);
  assert.equal(result.question, '我的原稿');
  assert.equal(result.draft.saved, null);
});

it('swaps two edited versions without trimming or losing either', () => {
  const original = '  原稿\n第二行  ';
  const edited = ' 新寫的內容\n還沒寫完 ';
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, original, '建議一');
  const restored = restoreComposerDraft(editComposerDraft(first.draft), edited);
  assert.equal(restored.question, original);
  assert.equal(restored.draft.saved, edited);
  const back = restoreComposerDraft(restored.draft, restored.question);
  assert.equal(back.question, edited);
  assert.equal(back.draft.saved, original);
});

it('blocks a third suggestion instead of overwriting either edited version', () => {
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '原稿', '建議一');
  const result = chooseComposerSuggestion(editComposerDraft(first.draft), '後來的改稿', '建議二');
  assert.equal(result.question, '後來的改稿');
  assert.equal(result.draft.saved, '原稿');
  assert.ok(result.draft.notice.includes('兩份草稿都已保留'));
});

it('allows suggestions when a saved version already matches the visible text', () => {
  const result = chooseComposerSuggestion({ saved: '原稿', suggested: null, notice: '' }, '原稿', '建議');
  assert.equal(result.question, '建議');
  assert.equal(result.draft.saved, '原稿');
});

it('keeps a saved version when sending a different visible question', () => {
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '還未送出的原稿', '建議');
  const result = sendComposerDraft(first.draft, first.question);
  assert.equal(result.saved, '還未送出的原稿');
  assert.equal(result.suggested, null);
});

it('removes only the saved duplicate of the question being sent', () => {
  const result = sendComposerDraft({ saved: '同一份', suggested: null, notice: '提示' }, '同一份');
  assert.deepEqual(result, EMPTY_COMPOSER_DRAFT);
});

it('does not treat matching a suggestion as permission to discard hand-written text', () => {
  const same = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '建議一', '建議一');
  assert.equal(same.draft.suggested, null);
  const next = chooseComposerSuggestion(same.draft, same.question, '建議二');
  assert.equal(next.draft.saved, '建議一');
});

it('keeps a manually edited suggestion even when it returns to its original spelling', () => {
  const first = chooseComposerSuggestion(EMPTY_COMPOSER_DRAFT, '原稿', '建議一');
  const result = restoreComposerDraft(editComposerDraft(first.draft), '建議一');
  assert.equal(result.question, '原稿');
  assert.equal(result.draft.saved, '建議一');
});

it('restores a saved version into a cleared composer without storing whitespace', () => {
  const result = restoreComposerDraft({ saved: '原稿', suggested: null, notice: '' }, '\n  ');
  assert.equal(result.question, '原稿');
  assert.equal(result.draft.saved, null);
});

it('does not change input when there is no saved version', () => {
  const result = restoreComposerDraft(EMPTY_COMPOSER_DRAFT, '現有內容');
  assert.equal(result.question, '現有內容');
  assert.equal(result.draft, EMPTY_COMPOSER_DRAFT);
});

it('edits clear obsolete notices but retain the saved version', () => {
  const result = editComposerDraft({ saved: '原稿', suggested: '建議', notice: '提示' });
  assert.deepEqual(result, { saved: '原稿', suggested: null, notice: '' });
});

it('does not mutate a previous state object', () => {
  const before = Object.freeze({ saved: '原稿', suggested: '建議', notice: '' });
  restoreComposerDraft(before, '改稿');
  sendComposerDraft(before, '建議');
  editComposerDraft(before);
  chooseComposerSuggestion(before, '改稿', '另一建議');
  assert.deepEqual(before, { saved: '原稿', suggested: '建議', notice: '' });
});
