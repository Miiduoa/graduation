'use client';

import { useEffect, useId, useImperativeHandle, useRef, type Ref } from 'react';
import {
  getAssistantRoleWorkflow,
  type AssistantWorkContext,
} from '@campus/shared/src/assistantRoleWorkflows';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useNuniSession } from '@/features/nuni/Session';
import { useAuth } from './AuthGuard';
import { CampusIcon } from './CampusIcon';
import type { AssistantWorkspace } from './AssistantWorkspaceContext';
import type { TodayAssistantHandle } from './TodayCampusEntry';
import styles from './AssistantWorkspaceEntry.module.css';

/** The home composer is the same draft as the persistent workspace, never a second conversation. */
export function AssistantWorkspaceEntry({
  workspace,
  preferredWorkContext,
  ref,
  onOpenChange,
}: {
  workspace: AssistantWorkspace;
  preferredWorkContext?: AssistantWorkContext;
  ref?: Ref<TodayAssistantHandle>;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const campus = useCampusBrowseContext();
  const auth = useAuth();
  const nuni = useNuniSession();
  const personal = Boolean(auth.user || nuni.session) && campus.status === 'ready';
  const workflow = getAssistantRoleWorkflow(preferredWorkContext);
  const suggestions = personal
    ? workflow.suggestions.slice(0, 3)
    : ['找圖書館', '查公車', '找校園活動'];
  const open = () => {
    if (!workspace.paused) workspace.openWorkspace({ workContext: preferredWorkContext });
  };
  useImperativeHandle(ref, () => ({ openAssistant: open }));
  useEffect(() => {
    onOpenChange?.(workspace.open);
  }, [onOpenChange, workspace.open]);

  return (
    <section className={styles.entry} aria-labelledby={`${id}-title`}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>nuni 助理</p>
          <h2 id={`${id}-title`}>今天想完成什麼？</h2>
        </div>
        <span className={styles.context}>
          <CampusIcon name={personal ? 'course' : 'search'} size={15} />
          {campus.status === 'ready' ? campus.schoolName : '先找校園服務'}
        </span>
      </div>
      <p className={styles.description}>
        {personal
          ? '查課表、整理待辦，或把想做的事說出來。'
          : '先找需要的服務，登入後再接上你的課表與待辦。'}
      </p>
      <form
        className={styles.composer}
        aria-label="開始校園任務"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing.current) open();
        }}
      >
        <label className={styles.srOnly} htmlFor={`${id}-draft`}>
          想完成的事
        </label>
        <textarea
          ref={field}
          id={`${id}-draft`}
          rows={2}
          maxLength={1000}
          disabled={workspace.paused}
          value={workspace.draft}
          placeholder={
            personal
              ? preferredWorkContext === 'teacher'
                ? '查我的授課概況，安排明天的備課時間'
                : '例如：這週有哪些作業？幫我安排今晚的準備時間'
              : '例如：圖書館在哪裡？'
          }
          onChange={(event) => workspace.setDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            open();
          }}
        />
        <div className={styles.composerFooter}>
          <span>
            {workspace.paused
              ? '正在確認登入與校園…'
              : workspace.hasStarted
                ? '目前對話與草稿會在這個分頁接續'
                : '帶入助理後，確認內容再送出'}
          </span>
          <button
            type="submit"
            disabled={workspace.paused}
            data-assistant-workspace-trigger="true"
            aria-controls="campus-assistant-workspace"
            aria-expanded={workspace.open}
          >
            {workspace.hasStarted ? '接續任務' : '開啟任務'}
            <CampusIcon name="arrow" size={17} />
          </button>
        </div>
      </form>
      {!workspace.paused && !workspace.draft && (
        <div className={styles.suggestions} role="group" aria-label="可以從這些事情開始">
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => {
                workspace.setDraft(text);
                field.current?.focus({ preventScroll: true });
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
