import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import { AssistantWorkspaceProvider } from './AssistantWorkspaceProvider';
import {
  ASSISTANT_WORKSPACE_ID,
  useOptionalAssistantWorkspace,
  type AssistantWorkspace,
} from './AssistantWorkspaceContext';

const state = vi.hoisted(() => ({
  uid: 'school-user' as string | null,
  accountId: 'platform-user',
  context: 'context-a' as string | null,
  authLoading: false,
  authError: false,
  nuniLoading: false,
  nuniError: false,
  pendingLogout: false,
  schoolId: 'pu' as string | null,
  campusStatus: 'ready',
  enabled: true,
  pathname: '/',
  search: 'campus=pu',
  mounts: 0,
  unmounts: 0,
  pageMounts: 0,
  pageUnmounts: 0,
  voiceStops: 0,
  playbackStops: 0,
  resolveReplies: [] as ((reply: string) => void)[],
  draftSetters: [] as Dispatch<SetStateAction<string>>[],
  workspace: null as AssistantWorkspace | null,
}));

vi.mock('./AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: state.authLoading,
    error: state.authError ? new Error('identity unavailable') : null,
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: state.context ? { context: state.context, platformAccountId: state.accountId } : null,
    loading: state.nuniLoading,
    error: state.nuniError ? 'SESSION_UNAVAILABLE' : '',
    pendingLogout: state.pendingLogout,
  }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: state.campusStatus,
    schoolId: state.schoolId,
    schoolName: state.schoolId === 'pu' ? '靜宜大學' : '其他校園',
    schoolSearch: '?campus=' + state.schoolId,
  }),
}));
vi.mock('./AssistantEnabledProvider', () => ({ useAssistantEnabled: () => state.enabled }));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('./TodayCampusEntry', async () => {
  const React = await import('react');
  return {
    TodayCampusEntry: ({
      active,
      paused,
      focusRequest,
      inlineDraft,
      preferredWorkContext,
      onNavigate,
    }: {
      active: boolean;
      paused: boolean;
      focusRequest: number;
      inlineDraft: { text: string; setText: Dispatch<SetStateAction<string>> };
      preferredWorkContext?: AssistantWorkContext;
      onNavigate: (href: string) => void;
    }) => {
      const [reply, setReply] = React.useState('');
      const [listening, setListening] = React.useState(false);
      const [speaking, setSpeaking] = React.useState(false);
      const field = React.useRef<HTMLInputElement>(null);
      React.useEffect(() => {
        state.mounts++;
        return () => {
          state.unmounts++;
        };
      }, []);
      React.useEffect(() => {
        state.draftSetters.push(inlineDraft.setText);
      }, [inlineDraft.setText]);
      React.useEffect(() => {
        if (active && focusRequest) field.current?.focus();
      }, [active, focusRequest]);
      return (
        <div>
          <input
            ref={field}
            aria-label="助理輸入"
            disabled={paused}
            value={inlineDraft.text}
            onChange={(event) => inlineDraft.setText(event.target.value)}
          />
          <p>{preferredWorkContext || 'student'}</p>
          <p>{reply}</p>
          <button
            type="button"
            onClick={() => {
              setReply('查詢中');
              void new Promise<string>((resolve) => state.resolveReplies.push(resolve)).then(
                setReply,
              );
            }}
          >
            開始模擬查詢
          </button>
          <button type="button" onClick={() => onNavigate('/map?campus=pu')}>
            前往地圖
          </button>
          <button
            type="button"
            data-voice-input
            aria-pressed={listening}
            onClick={() => {
              if (listening) state.voiceStops++;
              setListening(!listening);
            }}
          >
            語音聽寫
          </button>
          <button
            type="button"
            data-voice-playback
            aria-pressed={speaking}
            onClick={() => {
              if (speaking) state.playbackStops++;
              setSpeaking(!speaking);
            }}
          >
            朗讀回覆
          </button>
        </div>
      );
    },
  };
});

function Page({ showOriginal = true }: { showOriginal?: boolean }) {
  const workspace = useOptionalAssistantWorkspace();
  useLayoutEffect(() => {
    state.workspace = workspace;
  }, [workspace]);
  const [edited, setEdited] = useState('');
  useEffect(() => {
    state.pageMounts++;
    return () => {
      state.pageUnmounts++;
    };
  }, []);
  if (!workspace) return <p>沒有工作區</p>;
  return (
    <>
      {showOriginal && (
        <button type="button" onClick={() => workspace.openWorkspace()}>
          開啟助理
        </button>
      )}
      <button
        type="button"
        data-assistant-workspace-trigger
        onClick={() => workspace.openWorkspace()}
      >
        頁首助理
      </button>
      <button type="button" onClick={() => workspace.openWorkspace({ workContext: 'teacher' })}>
        授課助理
      </button>
      <input
        aria-label="入口草稿"
        disabled={workspace.paused}
        value={workspace.draft}
        onChange={(event) => workspace.setDraft(event.target.value)}
      />
      <input
        aria-label="頁面編輯"
        value={edited}
        onChange={(event) => setEdited(event.target.value)}
      />
    </>
  );
}

function tree(showOriginal = true) {
  return (
    <AssistantWorkspaceProvider>
      <Page showOriginal={showOriginal} />
    </AssistantWorkspaceProvider>
  );
}

// Next commits navigation with History during the layout phase. It does not
// emit hashchange before parent passive effects inspect the new pathname.
function NextLocationCommit({ href }: { href: string }) {
  useLayoutEffect(() => {
    window.history.replaceState({}, '', href);
  }, [href]);
  return <Page />;
}

function nextTree(href: string) {
  return (
    <AssistantWorkspaceProvider>
      <NextLocationCommit href={href} />
    </AssistantWorkspaceProvider>
  );
}

async function openWorkspace(label = '開啟助理') {
  const trigger = screen.getByRole('button', { name: label });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole('textbox', { name: '助理輸入' });
}

beforeEach(() => {
  Object.assign(state, {
    uid: 'school-user',
    accountId: 'platform-user',
    context: 'context-a',
    authLoading: false,
    authError: false,
    nuniLoading: false,
    nuniError: false,
    pendingLogout: false,
    schoolId: 'pu',
    campusStatus: 'ready',
    enabled: true,
    pathname: '/',
    search: 'campus=pu',
    mounts: 0,
    unmounts: 0,
    pageMounts: 0,
    pageUnmounts: 0,
    voiceStops: 0,
    playbackStops: 0,
    resolveReplies: [],
    draftSetters: [],
    workspace: null,
  });
  window.history.replaceState({}, '', '/?campus=pu');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('can be read outside the app provider without creating a second conversation', () => {
  render(<Page />);
  expect(screen.getByText('沒有工作區')).toBeTruthy();
  expect(state.mounts).toBe(0);
});

it('loads one nonmodal workspace on demand and shares the entry draft without submitting it', async () => {
  render(tree());
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '入口草稿' }), {
    target: { value: '明天的課在哪？' },
  });
  const field = await openWorkspace();
  expect((field as HTMLInputElement).value).toBe('明天的課在哪？');
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(screen.getByRole('region', { name: '校園助理' }).getAttribute('aria-modal')).toBeNull();
  expect(state.resolveReplies).toHaveLength(0);
  expect(state.mounts).toBe(1);
  fireEvent.change(field, { target: { value: '幫我找圖書館' } });
  expect((screen.getByRole('textbox', { name: '入口草稿' }) as HTMLInputElement).value).toBe(
    '幫我找圖書館',
  );
});

it('keeps the running conversation and draft across route and filter changes', async () => {
  const view = render(tree());
  const field = await openWorkspace();
  fireEvent.change(field, { target: { value: '查詢後接著安排時間' } });
  fireEvent.click(screen.getByRole('button', { name: '開始模擬查詢' }));
  state.pathname = '/map';
  view.rerender(tree());
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(true);
  expect(state.unmounts).toBe(0);
  await act(async () => state.resolveReplies[0]('已核對課程位置'));
  await openWorkspace('接續任務');
  expect(screen.getByText('已核對課程位置')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: '助理輸入' }) as HTMLInputElement).value).toBe(
    '查詢後接著安排時間',
  );
  state.search = 'campus=pu&query=圖書館';
  view.rerender(tree());
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(true);
  await openWorkspace('接續任務');
  expect(screen.getByText('已核對課程位置')).toBeTruthy();
  expect(state.mounts).toBe(1);
  expect(state.unmounts).toBe(0);
});

it('collapses and resumes without losing the selected work context or in-flight result', async () => {
  render(tree());
  await openWorkspace('授課助理');
  expect(screen.getByText('teacher')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '開始模擬查詢' }));
  fireEvent.click(screen.getByRole('button', { name: '收合' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '授課助理' }));
  await act(async () => state.resolveReplies[0]('授課概況已讀取'));
  await openWorkspace('接續任務');
  expect(screen.getByText('授課概況已讀取')).toBeTruthy();
  expect(screen.getByText('teacher')).toBeTruthy();
  expect(state.mounts).toBe(1);
});

describe('identity and authorization boundaries', () => {
  it.each([
    [
      'Firebase account',
      () => {
        state.uid = 'different-user';
      },
    ],
    [
      'platform account',
      () => {
        state.accountId = 'different-platform-user';
      },
    ],
    [
      'session context',
      () => {
        state.context = 'context-b';
      },
    ],
    [
      'campus',
      () => {
        state.schoolId = 'another-campus';
      },
    ],
    [
      'auth error',
      () => {
        state.authError = true;
      },
    ],
    [
      'platform error',
      () => {
        state.nuniError = true;
      },
    ],
    [
      'pending logout',
      () => {
        state.pendingLogout = true;
      },
    ],
    [
      'campus error',
      () => {
        state.campusStatus = 'error';
      },
    ],
    [
      'assistant capability',
      () => {
        state.enabled = false;
      },
    ],
    [
      'logout',
      () => {
        state.uid = null;
        state.context = null;
      },
    ],
  ])(
    'discards old drafts and replies on %s without remounting page editors',
    async (_, changeScope) => {
      const view = render(tree());
      fireEvent.change(screen.getByRole('textbox', { name: '頁面編輯' }), {
        target: { value: '頁面尚未儲存的內容' },
      });
      const field = await openWorkspace();
      fireEvent.change(field, { target: { value: '私人任務草稿' } });
      fireEvent.click(screen.getByRole('button', { name: '開始模擬查詢' }));
      const oldDraftSetter = state.draftSetters.at(-1)!;
      changeScope();
      view.rerender(tree());
      expect(document.getElementById(ASSISTANT_WORKSPACE_ID)).toBeNull();
      expect((screen.getByRole('textbox', { name: '入口草稿' }) as HTMLInputElement).value).toBe(
        '',
      );
      await openWorkspace();
      await act(async () => {
        oldDraftSetter('遲來的私人草稿');
        state.resolveReplies[0]('遲來的私人回覆');
      });
      expect((screen.getByRole('textbox', { name: '助理輸入' }) as HTMLInputElement).value).toBe(
        '',
      );
      expect(screen.queryByText('遲來的私人回覆')).toBeNull();
      expect((screen.getByRole('textbox', { name: '頁面編輯' }) as HTMLInputElement).value).toBe(
        '頁面尚未儲存的內容',
      );
      expect(state.mounts).toBe(2);
      expect(state.unmounts).toBe(1);
      expect(state.pageMounts).toBe(1);
      expect(state.pageUnmounts).toBe(0);
    },
  );
});

it.each(['auth', 'platform', 'campus'])(
  'pauses a same-identity %s refresh without discarding the draft or conversation',
  async (source) => {
    const view = render(tree());
    const field = await openWorkspace();
    fireEvent.change(field, { target: { value: '查核前尚未送出的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '開始模擬查詢' }));
    await act(async () => state.resolveReplies[0]('已經完成的任務結果'));
    const oldSetter = state.draftSetters.at(-1)!;
    const scope = state.workspace!.scopeKey;
    state.authLoading = source === 'auth';
    state.nuniLoading = source === 'platform';
    state.campusStatus = 'loading';
    state.schoolId = null;
    view.rerender(tree());
    expect(state.workspace!.scopeKey).toBe(scope);
    expect(state.workspace!.paused).toBe(true);
    expect(state.workspace!.draft).toBe('');
    expect(screen.queryByRole('textbox', { name: '助理輸入' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('正在確認登入與校園狀態');
    expect((screen.getByRole('textbox', { name: '入口草稿' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    act(() => oldSetter('查核中的遲來修改'));
    expect(state.unmounts).toBe(0);
    const otherField = screen.getByRole('textbox', { name: '頁面編輯' });
    otherField.focus();
    state.authLoading = false;
    state.nuniLoading = false;
    state.campusStatus = 'ready';
    state.schoolId = 'pu';
    view.rerender(tree());
    expect(state.workspace!.scopeKey).toBe(scope);
    expect(state.workspace!.paused).toBe(false);
    expect((screen.getByRole('textbox', { name: '助理輸入' }) as HTMLInputElement).value).toBe(
      '查核前尚未送出的草稿',
    );
    expect(screen.getByText('已經完成的任務結果')).toBeTruthy();
    expect(document.activeElement).toBe(otherField);
    expect(state.mounts).toBe(1);
    expect(state.unmounts).toBe(0);
  },
);

it('discards a paused workspace when refresh confirms a different campus', async () => {
  const view = render(tree());
  const field = await openWorkspace();
  fireEvent.change(field, { target: { value: '原校園的任務草稿' } });
  const scope = state.workspace!.scopeKey;
  state.campusStatus = 'loading';
  state.schoolId = null;
  view.rerender(tree());
  expect(state.workspace!.scopeKey).toBe(scope);
  state.campusStatus = 'ready';
  state.schoolId = 'another-campus';
  view.rerender(tree());
  expect(state.workspace!.scopeKey).not.toBe(scope);
  expect(state.workspace!.draft).toBe('');
  expect(state.unmounts).toBe(1);
});

it('does not open or edit a workspace while identity checking is paused', () => {
  state.nuniLoading = true;
  const view = render(tree());
  fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
  act(() => state.workspace!.setDraft('尚未確認的內容'));
  expect(state.workspace!.hasStarted).toBe(false);
  expect(state.workspace!.draft).toBe('');
  expect(state.mounts).toBe(0);
  state.nuniLoading = false;
  view.rerender(tree());
  expect(state.workspace!.draft).toBe('');
  expect(state.workspace!.hasStarted).toBe(false);
});

it('preserves a conversation when session objects refresh with the same identity values', async () => {
  const view = render(tree());
  const field = await openWorkspace();
  fireEvent.change(field, { target: { value: '同一個帳號的草稿' } });
  view.rerender(tree());
  expect((screen.getByRole('textbox', { name: '助理輸入' }) as HTMLInputElement).value).toBe(
    '同一個帳號的草稿',
  );
  expect(state.mounts).toBe(1);
  expect(state.unmounts).toBe(0);
});

it('does not revive an old request after switching away and back to the same account', async () => {
  const view = render(tree());
  await openWorkspace();
  fireEvent.click(screen.getByRole('button', { name: '開始模擬查詢' }));
  const oldDraftSetter = state.draftSetters.at(-1)!;
  const oldOpen = state.workspace!.openWorkspace;
  const oldScope = state.workspace!.scopeKey;
  state.accountId = 'another-account';
  view.rerender(tree());
  expect(state.workspace!.scopeKey).not.toBe(oldScope);
  act(() => oldOpen());
  expect(state.workspace!.open).toBe(false);
  state.accountId = 'platform-user';
  view.rerender(tree());
  expect(state.workspace!.scopeKey).not.toBe(oldScope);
  act(() => oldOpen());
  expect(state.workspace!.open).toBe(false);
  const field = await openWorkspace();
  fireEvent.change(field, { target: { value: '回來後新建的草稿' } });
  await act(async () => {
    oldDraftSetter('第一次登入留下的回覆');
    state.resolveReplies[0]('第一次登入留下的回覆');
  });
  expect((screen.getByRole('textbox', { name: '助理輸入' }) as HTMLInputElement).value).toBe(
    '回來後新建的草稿',
  );
  expect(screen.queryByText('第一次登入留下的回覆')).toBeNull();
});

it('uses Escape to collapse, but does not interrupt IME composition', async () => {
  render(tree());
  const field = await openWorkspace();
  fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(false);
  fireEvent.keyDown(field, { key: 'Escape', keyCode: 229 });
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(false);
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '開啟助理' }));
});

it('restores focus to a current page trigger when the original one has unmounted', async () => {
  const view = render(tree());
  await openWorkspace();
  view.rerender(tree(false));
  fireEvent.click(screen.getByRole('button', { name: '收合' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '頁首助理' }));
});

it('stops active dictation and playback on collapse while retaining the conversation', async () => {
  render(tree());
  await openWorkspace();
  fireEvent.click(screen.getByRole('button', { name: '語音聽寫' }));
  fireEvent.click(screen.getByRole('button', { name: '朗讀回覆' }));
  fireEvent.click(screen.getByRole('button', { name: '收合' }));
  expect(state.voiceStops).toBe(1);
  expect(state.playbackStops).toBe(1);
  expect(state.unmounts).toBe(0);
});

it('stops voice controls when a retained conversation becomes paused', async () => {
  const view = render(tree());
  await openWorkspace();
  fireEvent.click(screen.getByRole('button', { name: '語音聽寫' }));
  fireEvent.click(screen.getByRole('button', { name: '朗讀回覆' }));
  state.nuniLoading = true;
  view.rerender(tree());
  expect(state.voiceStops).toBe(1);
  expect(state.playbackStops).toBe(1);
  expect(state.unmounts).toBe(0);
});

it('minimizes result navigation without restoring focus to a previous page control', async () => {
  render(tree());
  await openWorkspace();
  const destination = screen.getByRole('button', { name: '前往地圖' });
  destination.focus();
  fireEvent.click(destination);
  expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(true);
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '開啟助理' }));
  expect(state.unmounts).toBe(0);
});

it.each(['#campus-assistant-entry', '#today-voice-entry'])(
  'opens a login return at %s without submitting',
  async (hash) => {
    window.history.replaceState({}, '', '/?campus=pu' + hash);
    render(tree());
    await screen.findByRole('textbox', { name: '助理輸入' });
    expect(state.resolveReplies).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '收合' }));
    expect(window.location.hash).toBe('');
    expect(document.getElementById(ASSISTANT_WORKSPACE_ID)?.hidden).toBe(true);
  },
);

it('waits for identity checking before opening a login-return fragment', async () => {
  state.nuniLoading = true;
  window.history.replaceState({}, '', '/?campus=pu#campus-assistant-entry');
  const view = render(tree());
  expect(state.mounts).toBe(0);
  expect(state.workspace!.open).toBe(false);
  state.nuniLoading = false;
  view.rerender(tree());
  await screen.findByRole('textbox', { name: '助理輸入' });
  expect(state.resolveReplies).toHaveLength(0);
});

it.each([
  ['#campus-assistant-entry', false],
  ['#today-voice-entry', false],
  ['#campus-assistant-entry', true],
  ['#today-voice-entry', true],
] as const)(
  'preserves the committed Next login-return anchor %s while checking=%s',
  async (anchor, checking) => {
    state.pathname = '/login';
    state.search = '';
    state.context = null;
    state.uid = null;
    window.history.replaceState({}, '', '/login');
    const view = render(nextTree('/login'));
    expect(state.mounts).toBe(0);

    state.pathname = '/life';
    state.search = 'campus=pu';
    state.context = 'returned-session';
    state.nuniLoading = checking;
    state.campusStatus = checking ? 'loading' : 'ready';
    state.schoolId = checking ? null : 'pu';
    const destination = '/life?campus=pu' + anchor;
    view.rerender(nextTree(destination));
    // No hashchange event is dispatched: this reproduces the committed URL
    // arriving after Provider rendered with the previous empty hash snapshot.
    expect(window.location.hash).toBe(anchor);
    if (checking) {
      expect(state.workspace!.open).toBe(false);
      expect(state.mounts).toBe(0);
      state.nuniLoading = false;
      state.campusStatus = 'ready';
      state.schoolId = 'pu';
      view.rerender(nextTree(destination));
    }
    await screen.findByRole('textbox', { name: '助理輸入' });
    expect(state.workspace!.open).toBe(true);
    expect(state.mounts).toBe(1);
    expect(state.resolveReplies).toHaveLength(0);
  },
);

it('does not refocus a retained login-return workspace after a same-user refresh', async () => {
  window.history.replaceState({}, '', '/?campus=pu#campus-assistant-entry');
  const view = render(tree());
  await screen.findByRole('textbox', { name: '助理輸入' });
  state.nuniLoading = true;
  view.rerender(tree());
  const otherField = screen.getByRole('textbox', { name: '頁面編輯' });
  otherField.focus();
  state.nuniLoading = false;
  view.rerender(tree());
  expect(document.activeElement).toBe(otherField);
  expect(state.mounts).toBe(1);
});

it('does not treat an unrelated hash change as an identity change or a new task', async () => {
  render(tree());
  const field = await openWorkspace();
  fireEvent.change(field, { target: { value: '持續編輯中' } });
  act(() => {
    window.history.replaceState({}, '', '/?campus=pu#details');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect((screen.getByRole('textbox', { name: '助理輸入' }) as HTMLInputElement).value).toBe(
    '持續編輯中',
  );
  expect(state.mounts).toBe(1);
});

it('keeps drafts in memory without writing localStorage or sessionStorage', async () => {
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
  render(tree());
  const field = await openWorkspace();
  fireEvent.change(field, { target: { value: '不儲存到瀏覽器資料庫' } });
  fireEvent.click(screen.getByRole('button', { name: '收合' }));
  await openWorkspace('接續任務');
  expect(storageWrite).not.toHaveBeenCalled();
});
