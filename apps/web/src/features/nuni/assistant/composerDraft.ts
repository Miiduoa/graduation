export type ComposerDraft = Readonly<{
  saved: string | null;
  suggested: string | null;
  notice: string;
}>;

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = Object.freeze({
  saved: null,
  suggested: null,
  notice: '',
});

export type ComposerDraftChange = {
  draft: ComposerDraft;
  question: string;
};

/** A suggestion is replaceable; either hand-written version is not. No persistence or network. */
export function chooseComposerSuggestion(
  draft: ComposerDraft,
  question: string,
  suggestion: string,
): ComposerDraftChange {
  if (question === suggestion) return { draft, question };
  const hasEditedText = !!question.trim() && question !== draft.suggested;
  if (hasEditedText && draft.saved !== null && draft.saved !== question) {
    return {
      draft: {
        ...draft,
        notice: '兩份草稿都已保留，請先切換草稿或送出目前內容，再選其他建議。',
      },
      question,
    };
  }
  return {
    draft: {
      saved: hasEditedText ? question : draft.saved,
      suggested: suggestion,
      notice: '',
    },
    question: suggestion,
  };
}

export function restoreComposerDraft(draft: ComposerDraft, question: string): ComposerDraftChange {
  if (draft.saved === null) return { draft, question };
  const keepCurrent = !!question.trim() && question !== draft.suggested && question !== draft.saved;
  return {
    draft: { saved: keepCurrent ? question : null, suggested: null, notice: '' },
    question: draft.saved,
  };
}

export function editComposerDraft(draft: ComposerDraft): ComposerDraft {
  return { ...draft, suggested: null, notice: '' };
}

export function sendComposerDraft(draft: ComposerDraft, question: string): ComposerDraft {
  // Sending the visible question must not delete an unrelated saved question.
  return { saved: draft.saved === question ? null : draft.saved, suggested: null, notice: '' };
}
