import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentDraftProvider, useAgentDraft } from './AgentDraftProvider';

type DraftOptions = Parameters<typeof useAgentDraft>[1];
type Slot = Parameters<typeof useAgentDraft>[0];
type DraftApi = ReturnType<typeof useAgentDraft>;

let current: DraftApi;
let composerCommitCount = 0;

function Composer({ slot = 'search', options }: { slot?: Slot; options?: DraftOptions }) {
  const draft = useAgentDraft(slot, options);
  useEffect(() => {
    current = draft;
    composerCommitCount += 1;
  }, [draft]);
  return (
    <>
      <output aria-label="草稿">{draft.draft.text}</output>
      <output aria-label="分類">{draft.draft.category ?? ''}</output>
      <output aria-label="可執行">{String(draft.ready)}</output>
      <output aria-label="可編輯">{String(draft.editable)}</output>
    </>
  );
}

function SlotCapture({ slot, onChange }: { slot: Slot; onChange: (api: DraftApi) => void }) {
  const api = useAgentDraft(slot);
  useEffect(() => {
    onChange(api);
  }, [api, onChange]);
  return <output aria-label={`${slot} 草稿`}>{api.draft.text}</output>;
}

function View({
  owner = 'firebase:alice|platform:one',
  school = 'school-a',
  ready = true,
  editable,
  visible = true,
  slot = 'search',
  options,
  onActivityChange,
}: {
  owner?: string | null;
  school?: string | null;
  ready?: boolean;
  editable?: boolean;
  visible?: boolean;
  slot?: Slot;
  options?: DraftOptions;
  onActivityChange?: (activity: { hasActivity: boolean }) => void;
}) {
  return (
    <AgentDraftProvider ownerKey={owner} schoolId={school} ready={ready} editable={editable} onActivityChange={onActivityChange}>
      {visible ? <Composer slot={slot} options={options} /> : <p>其他頁面</p>}
    </AgentDraftProvider>
  );
}

beforeEach(() => {
  composerCommitCount = 0;
  window.history.replaceState({ __NA: true, tree: ['root'] }, '', '/search');
});

describe('Agent draft ownership', () => {
  it('retains unsent text, category and the quota deadline when the composer leaves and returns', () => {
    const view = render(<View />);
    const deadline = Date.now() + 30_000;
    act(() => {
      current.setDraft({ text: '幫我找明天的教室', category: 'campus' });
      current.retainQuotaUntil(deadline);
    });
    const scope = current.scopeKey;
    const epoch = current.scopeEpoch;

    view.rerender(<View visible={false} />);
    view.rerender(<View />);

    expect(screen.getByLabelText('草稿').textContent).toBe('幫我找明天的教室');
    expect(screen.getByLabelText('分類').textContent).toBe('campus');
    expect(current.scopeKey).toBe(scope);
    expect(current.scopeEpoch).toBe(epoch);
    expect(current.quotaUntil).toBe(deadline);
  });

  it('keeps separate composer text without shortening the same-scope quota deadline', () => {
    const view = render(<View slot="search" />);
    const deadline = Date.now() + 30_000;
    act(() => {
      current.setDraft({ text: '找教材', category: 'courses' });
      current.retainQuotaUntil(deadline);
    });
    view.rerender(<View slot="navigation" />);
    expect(current.draft.text).toBe('');
    expect(current.quotaUntil).toBe(deadline);
    act(() => {
      current.setDraft({ text: '帶我到圖書館' });
      current.retainQuotaUntil(deadline - 10_000);
    });
    expect(current.quotaUntil).toBe(deadline);

    view.rerender(<View slot="search" />);
    expect(current.draft).toEqual({ text: '找教材', category: 'courses' });
  });

  it('does not let callbacks from an unmounted composer overwrite edits made after returning', () => {
    const view = render(<View />);
    act(() => current.setDraft({ text: '離頁前的草稿' }));
    const previous = current;
    view.rerender(<View visible={false} />);
    view.rerender(<View />);
    act(() => current.setDraft({ text: '返回後修改的草稿' }));
    act(() => {
      previous.setDraft({ text: '離頁前的晚到轉錄' });
      previous.handoff('search', { text: '離頁前的晚到交接' });
      previous.retainQuotaUntil(Date.now() + 60_000);
    });
    expect(current.draft.text).toBe('返回後修改的草稿');
    expect(current.quotaUntil).toBeNull();
  });

  it.each(['account', 'school'] as const)('clears %s-owned drafts and refuses old callbacks after A→B→A', (kind) => {
    const view = render(<View />);
    act(() => current.setDraft({ text: '甲身分私人草稿', category: 'courses' }));
    const previous = current;
    const oldEpoch = current.scopeEpoch;
    view.rerender(kind === 'account' ? <View owner="firebase:bob|platform:two" /> : <View school="school-b" />);
    expect(current.draft.text).toBe('');
    view.rerender(<View />);
    expect(current.draft.text).toBe('');
    expect(current.scopeEpoch).not.toBe(oldEpoch);

    act(() => {
      previous.setDraft({ text: '晚到舊草稿' });
      previous.retainQuotaUntil(Date.now() + 60_000);
      previous.setPending(true);
    });
    expect(current.draft.text).toBe('');
    expect(current.quotaUntil).toBeNull();
  });

  it('invalidates private text when only the native platform account changes', () => {
    const view = render(<View />);
    act(() => current.setDraft({ text: '第一個平台帳號的資料' }));
    view.rerender(<View owner="firebase:alice|platform:two" />);
    expect(current.draft.text).toBe('');
  });

  it('preserves same-owner text during readiness checks but rejects callbacks captured before suspension', () => {
    const view = render(<View />);
    const deadline = Date.now() + 30_000;
    act(() => {
      current.setDraft({ text: '還沒送出的提問', category: 'campus' });
      current.retainQuotaUntil(deadline);
    });
    const previous = current;
    const scopeEpoch = current.scopeEpoch;
    const activityEpoch = current.activityEpoch;
    view.rerender(<View ready={false} />);
    expect(current.draft.text).toBe('還沒送出的提問');
    expect(current.ready).toBe(false);
    expect(current.scopeEpoch).toBe(scopeEpoch);
    expect(current.activityEpoch).not.toBe(activityEpoch);

    act(() => {
      previous.setDraft({ text: '舊轉錄晚到' });
      previous.retainQuotaUntil(deadline + 60_000);
    });
    expect(current.draft.text).toBe('還沒送出的提問');
    expect(current.quotaUntil).toBe(deadline);
    view.rerender(<View />);
    expect(current.ready).toBe(true);
    expect(current.draft.text).toBe('還沒送出的提問');
    act(() => previous.setDraft({ text: '回到頁面後才抵達的舊結果' }));
    expect(current.draft.text).toBe('還沒送出的提問');
  });

  it('does not replace a newer manual draft when a component remounts with an old initial query', () => {
    const initial = { text: '從首頁帶來的原始問題', category: 'all' };
    const view = render(<View options={{ initialDraft: initial }} />);
    expect(current.draft.text).toBe(initial.text);
    act(() => current.setDraft({ text: '已修改的問題', category: 'campus' }));
    view.rerender(<View visible={false} />);
    view.rerender(<View options={{ initialDraft: initial }} />);
    expect(current.draft).toEqual({ text: '已修改的問題', category: 'campus' });
  });

  it('replaces target text only through an explicit handoff in the current scope', () => {
    const view = render(<View slot="navigation" />);
    act(() => current.setDraft({ text: '上次未送出的導航問題' }));
    view.rerender(<View slot="quick" />);
    act(() => current.handoff('navigation', { text: '這次要去體育館' }));
    view.rerender(<View slot="navigation" />);
    expect(current.draft.text).toBe('這次要去體育館');

    const oldHandoff = current.handoff;
    view.rerender(<View owner="firebase:bob|platform:two" slot="navigation" />);
    act(() => oldHandoff('navigation', { text: '甲帳號晚到交接' }));
    expect(current.draft.text).toBe('');
  });

  it('invalidates an already mounted handoff target without clearing its quota or suspending the source', () => {
    let quick!: DraftApi;
    let navigation!: DraftApi;
    const activity = vi.fn();
    const captureQuick = (api: DraftApi) => { quick = api; };
    const captureNavigation = (api: DraftApi) => { navigation = api; };
    render(
      <AgentDraftProvider ownerKey="alice" schoolId="school-a" ready onActivityChange={activity}>
        <SlotCapture slot="quick" onChange={captureQuick} />
        <SlotCapture slot="navigation" onChange={captureNavigation} />
      </AgentDraftProvider>,
    );
    const deadline = Date.now() + 30_000;
    act(() => {
      navigation.setPending(true);
      navigation.retainQuotaUntil(deadline);
    });
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: true });
    const previousTarget = navigation;
    const sourceEpoch = quick.activityEpoch;

    act(() => quick.handoff('navigation', { text: '改去體育館' }));
    expect(navigation.draft.text).toBe('改去體育館');
    expect(navigation.activityEpoch).not.toBe(previousTarget.activityEpoch);
    expect(quick.activityEpoch).toBe(sourceEpoch);
    expect(navigation.quotaUntil).toBe(deadline);
    act(() => {
      previousTarget.setDraft({ text: '舊導航結果覆寫' });
      previousTarget.retainQuotaUntil(deadline + 60_000);
      previousTarget.setPending(true);
    });
    expect(navigation.draft.text).toBe('改去體育館');
    expect(navigation.quotaUntil).toBe(deadline);

    act(() => navigation.setDraft({ text: '' }));
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: false });
    act(() => previousTarget.setPending(true));
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: false });
  });

  it('does not restore private drafts after the whole provider has unmounted', () => {
    const view = render(<View />);
    act(() => current.setDraft({ text: '僅存在這次頁面中的私人問題' }));
    view.unmount();
    render(<View />);
    expect(current.draft.text).toBe('');
  });

  it('also fences isolated consumers using their explicit owner, school and readiness', () => {
    const view = render(<Composer options={{ uid: 'alice', schoolId: 'school-a', ready: true }} />);
    act(() => current.setDraft({ text: '獨立元件草稿' }));
    const previous = current;
    view.rerender(<Composer options={{ uid: 'bob', schoolId: 'school-a', ready: true }} />);
    expect(current.draft.text).toBe('');
    view.rerender(<Composer options={{ uid: 'alice', schoolId: 'school-a', ready: true }} />);
    act(() => previous.setDraft({ text: '晚到的舊身分草稿' }));
    expect(current.draft.text).toBe('');
  });

  it('counts a pending action as activity even when its draft is empty, and releases it on unmount', () => {
    const activity = vi.fn();
    const view = render(
      <AgentDraftProvider ownerKey="alice" schoolId="school-a" ready onActivityChange={activity}>
        <Composer />
      </AgentDraftProvider>,
    );
    act(() => current.setPending(true));
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: true });
    view.rerender(
      <AgentDraftProvider ownerKey="alice" schoolId="school-a" ready onActivityChange={activity}>
        <p>其他頁面</p>
      </AgentDraftProvider>,
    );
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: false });
  });

  it('keeps action references stable while editing within the same active scope', () => {
    render(<View />);
    const previous = current;
    act(() => current.setDraft({ text: '更新問題內容' }));
    expect(current.setDraft).toBe(previous.setDraft);
    expect(current.setPending).toBe(previous.setPending);
    expect(current.retainQuotaUntil).toBe(previous.retainQuotaUntil);
    expect(current.handoff).toBe(previous.handoff);
    expect(current.readUrlDraft).toBe(previous.readUrlDraft);
    expect(current.writeUrlDraft).toBe(previous.writeUrlDraft);
  });

  it('does not commit another render for an unchanged pending state', () => {
    render(<View />);
    act(() => current.setPending(true));
    const whilePending = composerCommitCount;
    act(() => {
      current.setPending(true);
      current.setPending(true);
    });
    expect(composerCommitCount).toBe(whilePending);
    act(() => current.setPending(false));
    const afterPending = composerCommitCount;
    act(() => current.setPending(false));
    expect(composerCommitCount).toBe(afterPending);
  });
});

describe('Agent draft editing before execution is available', () => {
  it('allows local editing, handoff and scoped history while refusing execution state', () => {
    const activity = vi.fn();
    const view = render(<View ready={false} editable onActivityChange={activity} />);
    expect(current.ready).toBe(false);
    expect(current.editable).toBe(true);
    act(() => {
      current.setPending(true);
      current.retainQuotaUntil(Date.now() + 30_000);
    });
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: false });
    expect(current.quotaUntil).toBeNull();
    act(() => {
      current.setDraft({ text: '目錄載入時先寫下的問題', category: 'campus' });
      current.handoff('navigation', { text: '先記下要去的圖書館' });
      current.writeUrlDraft('/search?q=目錄載入時先寫下的問題&category=campus');
    });
    expect(current.draft).toEqual({ text: '目錄載入時先寫下的問題', category: 'campus' });
    expect(new URLSearchParams(window.location.search).get('q')).toBe('目錄載入時先寫下的問題');
    expect(window.history.state.tree).toEqual(['root']);
    view.rerender(<View ready={false} editable slot="navigation" onActivityChange={activity} />);
    expect(current.draft.text).toBe('先記下要去的圖書館');
    expect(current.ready).toBe(false);
  });

  it('retains text entered before the initial school catalog resolves', () => {
    const view = render(<View school={null} ready={false} editable />);
    act(() => current.setDraft({ text: '等目錄時已經打好的問題', category: 'courses' }));
    const previous = current;
    view.rerender(<View />);
    expect(current.ready).toBe(true);
    expect(current.draft).toEqual({ text: '等目錄時已經打好的問題', category: 'courses' });
    expect(current.scopeEpoch).toBe(previous.scopeEpoch);
    expect(current.activityEpoch).not.toBe(previous.activityEpoch);
    act(() => previous.setDraft({ text: '目錄更新前的舊回呼' }));
    expect(current.draft.text).toBe('等目錄時已經打好的問題');
  });

  it('keeps text during a same-owner identity check but blocks edits until the check finishes', () => {
    const view = render(<View />);
    act(() => current.setDraft({ text: '身分重新確認前的草稿' }));
    const previous = current;
    view.rerender(<View ready={false} editable={false} />);
    const suspended = current;
    expect(current.draft.text).toBe('身分重新確認前的草稿');
    expect(current.editable).toBe(false);
    act(() => {
      previous.setDraft({ text: '確認開始前的舊回呼' });
      current.setDraft({ text: '確認中不接受修改' });
      current.handoff('search', { text: '確認中不接受交接' });
      current.writeUrlDraft('/search?q=確認中不接受網址更新');
    });
    expect(current.draft.text).toBe('身分重新確認前的草稿');
    expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
    view.rerender(<View ready={false} editable />);
    act(() => suspended.setDraft({ text: '上一次確認中的舊回呼' }));
    expect(current.draft.text).toBe('身分重新確認前的草稿');
    act(() => current.setDraft({ text: '確認身分後繼續編輯' }));
    expect(current.draft.text).toBe('確認身分後繼續編輯');
    expect(current.ready).toBe(false);
  });

  it('clears a known owner draft on an account change even while the school is unresolved', () => {
    const view = render(<View school={null} ready={false} editable />);
    act(() => current.setDraft({ text: '甲帳號等待校園時的私人問題' }));
    const previous = current;
    view.rerender(<View owner="firebase:bob|platform:two" school={null} ready={false} editable />);
    expect(current.draft.text).toBe('');
    view.rerender(<View school={null} ready={false} editable />);
    act(() => previous.handoff('search', { text: '甲帳號的晚到交接' }));
    expect(current.draft.text).toBe('');
    expect(current.scopeEpoch).not.toBe(previous.scopeEpoch);
  });

  it('accepts a first public query after the initial unknown identity becomes known, but never for the next account', () => {
    const initialDraft = { text: '公開詢問圖書館開放時間', category: 'campus' };
    window.history.replaceState({ __NA: true, tree: ['root'] }, '', '/search?q=公開詢問圖書館開放時間&category=campus');
    const view = render(<View owner={null} school={null} ready={false} editable={false} options={{ initialDraft }} />);
    expect(current.draft.text).toBe('');
    expect(current.editable).toBe(false);
    view.rerender(<View school={null} ready={false} editable options={{ initialDraft }} />);
    expect(current.draft).toEqual(initialDraft);
    expect(current.editable).toBe(true);
    const firstEpoch = current.scopeEpoch;
    view.rerender(<View owner="firebase:bob|platform:two" school={null} ready={false} editable options={{ initialDraft }} />);
    expect(current.draft.text).toBe('');
    expect(current.scopeEpoch).not.toBe(firstEpoch);
    expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
  });

  it('honors a suspended consumer inside a ready provider without disabling its local editor', () => {
    const activity = vi.fn();
    render(<View options={{ ready: false, editable: true }} onActivityChange={activity} />);
    expect(current.ready).toBe(false);
    expect(current.editable).toBe(true);
    act(() => {
      current.setPending(true);
      current.retainQuotaUntil(Date.now() + 30_000);
    });
    expect(activity).toHaveBeenLastCalledWith({ hasActivity: false });
    expect(current.quotaUntil).toBeNull();
    act(() => current.setDraft({ text: '只能編輯的草稿' }));
    expect(current.draft.text).toBe('只能編輯的草稿');
  });

  it('rejects callbacks captured before the consumer alone becomes suspended', () => {
    const view = render(<View options={{ ready: true, editable: true }} />);
    act(() => current.setDraft({ text: '頁面身分檢查前的草稿' }));
    const previous = current;
    view.rerender(<View options={{ ready: false, editable: false }} />);
    expect(current.ready).toBe(false);
    expect(current.editable).toBe(false);
    act(() => {
      previous.setDraft({ text: '頁面檢查前的晚到結果' });
      previous.retainQuotaUntil(Date.now() + 60_000);
      previous.handoff('search', { text: '頁面檢查前的晚到交接' });
    });
    expect(current.draft.text).toBe('頁面身分檢查前的草稿');
    expect(current.quotaUntil).toBeNull();
    view.rerender(<View options={{ ready: true, editable: true }} />);
    act(() => previous.setDraft({ text: '頁面恢復後的晚到結果' }));
    expect(current.draft.text).toBe('頁面身分檢查前的草稿');
  });
});

describe('Agent draft revisions', () => {
  it('increments only for real text or category edits without changing the activity epoch', () => {
    render(<View />);
    const activityEpoch = current.activityEpoch;
    expect(current.draftRevision).toBe(0);
    act(() => current.setDraft({ text: '查詢明天的課程' }));
    expect(current.draftRevision).toBe(1);
    expect(current.activityEpoch).toBe(activityEpoch);
    act(() => current.setDraft({ text: '查詢明天的課程', category: 'courses' }));
    expect(current.draftRevision).toBe(2);
    expect(current.activityEpoch).toBe(activityEpoch);
    act(() => current.setDraft({ text: '查詢明天的課程', category: 'courses' }));
    expect(current.draftRevision).toBe(2);
    act(() => current.setDraft((previous) => ({ ...previous, text: '查詢後天的課程' })));
    expect(current.draftRevision).toBe(3);
    expect(current.activityEpoch).toBe(activityEpoch);
  });

  it('increments the target revision for a handoff and starts a new revision sequence after a scope change', () => {
    const view = render(<View slot="navigation" />);
    expect(current.draftRevision).toBe(0);
    act(() => current.setDraft({ text: '原本要去圖書館' }));
    expect(current.draftRevision).toBe(1);
    view.rerender(<View slot="quick" />);
    act(() => current.handoff('navigation', { text: '改去體育館' }));
    view.rerender(<View slot="navigation" />);
    expect(current.draftRevision).toBe(2);
    const scopeEpoch = current.scopeEpoch;
    view.rerender(<View owner="firebase:bob|platform:two" slot="navigation" />);
    expect(current.draftRevision).toBe(0);
    expect(current.scopeEpoch).not.toBe(scopeEpoch);
    expect(current.draft.text).toBe('');
  });

  it('shares one slot revision across mounted consumers while leaving other slots unchanged', () => {
    let first!: DraftApi;
    let second!: DraftApi;
    let quick!: DraftApi;
    const captureFirst = (api: DraftApi) => { first = api; };
    const captureSecond = (api: DraftApi) => { second = api; };
    const captureQuick = (api: DraftApi) => { quick = api; };
    render(
      <AgentDraftProvider ownerKey="alice" schoolId="school-a" ready>
        <SlotCapture slot="search" onChange={captureFirst} />
        <SlotCapture slot="search" onChange={captureSecond} />
        <SlotCapture slot="quick" onChange={captureQuick} />
      </AgentDraftProvider>,
    );
    expect(first.draftRevision).toBe(0);
    expect(second.draftRevision).toBe(0);
    act(() => first.setDraft({ text: '兩個入口共用的問題', category: 'campus' }));
    expect(first.draftRevision).toBe(1);
    expect(second.draftRevision).toBe(1);
    expect(second.draft).toEqual(first.draft);
    expect(quick.draftRevision).toBe(0);
    act(() => second.setDraft({ text: '另一個入口修改的問題', category: 'campus' }));
    expect(first.draftRevision).toBe(2);
    expect(second.draftRevision).toBe(2);
    expect(first.draft.text).toBe('另一個入口修改的問題');
  });
});

describe('Agent draft history', () => {
  it('accepts an initial public query and category without requiring an existing history marker', () => {
    window.history.replaceState({ __NA: true, tree: ['root'] }, '', '/search?q=圖書館在哪裡&category=campus');
    render(<View />);
    expect(current.readUrlDraft(new URLSearchParams(window.location.search))).toEqual({
      text: '圖書館在哪裡',
      category: 'campus',
    });
  });

  it('waits for the initial school to resolve before consuming a public deep-link draft', () => {
    const initialDraft = { text: '圖書館在哪裡', category: 'campus' };
    window.history.replaceState({ __NA: true, tree: ['root'] }, '', '/search?q=圖書館在哪裡&category=campus');
    const view = render(<View school={null} ready={false} options={{ initialDraft }} />);
    expect(current.ready).toBe(false);
    expect(current.draft.text).toBe('');
    view.rerender(<View options={{ initialDraft }} />);
    expect(current.ready).toBe(true);
    expect(current.draft).toEqual(initialDraft);
  });

  it('writes a scoped query without erasing Next history state', () => {
    render(<View />);
    act(() => current.writeUrlDraft('/search?q=下一節課&category=campus'));
    expect(window.location.pathname).toBe('/search');
    expect(new URLSearchParams(window.location.search).get('q')).toBe('下一節課');
    expect(window.history.state.__NA).toBe(true);
    expect(window.history.state.tree).toEqual(['root']);
  });

  it('refuses an old owner history entry after changing accounts and returning', () => {
    const view = render(<View />);
    act(() => current.writeUrlDraft('/search?q=甲帳號的問題&category=campus'));
    const oldState = window.history.state;
    const oldUrl = window.location.href;
    view.rerender(<View owner="firebase:bob|platform:two" />);
    view.rerender(<View />);
    window.history.replaceState(oldState, '', oldUrl);
    expect(current.readUrlDraft(new URLSearchParams(window.location.search))).toBeNull();
    expect(current.draft.text).toBe('');
  });
});
