'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { asRecords, platformFetch, type PlatformResponse } from './platformFetch';
import { accountReturnHref, workspacePath } from './constants';
import { CLASSROOM_ACCESS_ERROR, classroomAccessDenied } from './classroomAccess';
import { useActiveRequest } from './useActiveRequest';
import styles from './Platform.module.css';

type SessionRow = {
  id: string;
  title: string;
  state: string;
  checkInCount?: number;
  unitId?: string | null;
  shortCode?: string;
  checkedInByMe: boolean;
  makeupRequestState?: string;
};
type RosterPerson = {
  platformAccountId: string;
  displayName: string;
  punctuality?: string;
  makeupRequestState?: string;
};
type Props = {
  workspaceId: string;
  context: string;
  isTeacher: boolean;
  readOnly?: boolean;
  units: Array<{ id: string; title: string }>;
  beginRequest?: () => () => void;
  refreshVersion?: number;
};
type RequestScope = { current: () => boolean; onDenied?: () => void };
type Send = (
  path: string,
  input?: Record<string, unknown>,
  method?: 'GET' | 'POST',
) => Promise<PlatformResponse | null>;
const rosterLabels: Record<string, string> = { present: '出席', absent: '缺席', late: '遲到' };

function sessionRows(value: unknown): SessionRow[] {
  return asRecords(value)
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      title: typeof row.title === 'string' ? row.title : '課堂',
      state: typeof row.state === 'string' ? row.state : '',
      checkInCount: typeof row.checkInCount === 'number' ? row.checkInCount : undefined,
      unitId: typeof row.unitId === 'string' ? row.unitId : null,
      shortCode: typeof row.shortCode === 'string' ? row.shortCode : undefined,
      checkedInByMe: row.checkedInByMe === true,
      makeupRequestState:
        typeof row.makeupRequestState === 'string' ? row.makeupRequestState : undefined,
    }))
    .filter((row) => row.id);
}

export function ClassroomSessions(props: Props) {
  // The parent also keys by account context. A course/role change must discard
  // this panel's private roster and any outstanding mutation callbacks.
  return (
    <ClassroomSessionScope
      key={`${props.context}:${props.workspaceId}:${props.isTeacher}:${props.readOnly}`}
      {...props}
    />
  );
}

function ClassroomSessionScope({
  workspaceId,
  context,
  isTeacher,
  readOnly = false,
  units,
  beginRequest,
  refreshVersion = 0,
}: Props) {
  const [title, setTitle] = useState('本堂課');
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [roster, setRoster] = useState<Record<string, RosterPerson[]> | null>(null);
  const [rosterVersion, setRosterVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const captureRequest = useActiveRequest();
  const blocked = useRef(false);
  const mutationPending = useRef(false);
  const listGeneration = useRef(0);
  const rosterGeneration = useRef(0);
  const base = `class-workspaces/${workspaceId}/classroom-sessions`;
  const live = sessions.find((row) => row.state === 'open') ?? null;
  // Both makeup endpoints require a closed classroom. Keep the last closed
  // classroom and its roster available after ending the live classroom.
  const reviewSession = live ?? sessions.find((row) => row.state === 'closed') ?? null;

  function requestScope(): RequestScope {
    const active = captureRequest();
    return { current: () => active() && !blocked.current, onDenied: beginRequest?.() };
  }
  function accept(result: PlatformResponse, scope: RequestScope, fallback: string): boolean {
    if (!scope.current()) return false;
    if (classroomAccessDenied(result)) {
      blocked.current = true;
      ++listGeneration.current;
      ++rosterGeneration.current;
      setSessions([]);
      setRoster(null);
      setCode('');
      setNotice('');
      setBusy(false);
      setLoading(false);
      setAccessDenied(true);
      setError(CLASSROOM_ACCESS_ERROR);
      scope.onDenied?.();
      if (result.status === 401)
        window.location.replace(accountReturnHref(workspacePath(workspaceId)));
      return false;
    }
    if (!result.ok) throw new Error(fallback);
    return true;
  }
  async function reload() {
    const scope = requestScope();
    if (!scope.current()) return;
    const run = ++listGeneration.current;
    setLoading(true);
    try {
      const result = await platformFetch(base, 'GET', undefined, context);
      if (!scope.current() || run !== listGeneration.current) return;
      if (!accept(result, scope, '目前讀不到課堂簽到。')) return;
      setSessions(sessionRows(result.body.sessions));
      setRosterVersion((value) => value + 1);
    } catch (failure) {
      if (scope.current() && run === listGeneration.current)
        setError(failure instanceof Error ? failure.message : '目前讀不到課堂簽到。');
    } finally {
      if (scope.current() && run === listGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // The keyed lifetime handles course/role/account changes and Strict Mode replays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshVersion, captureRequest]);

  useEffect(() => {
    setRoster(null);
    if (!reviewSession || !isTeacher || blocked.current) return;
    const request = requestScope();
    let active = true;
    const scope = { ...request, current: () => active && request.current() };
    const run = ++rosterGeneration.current;
    void platformFetch(
      `${base}/${encodeURIComponent(reviewSession.id)}/roster`,
      'GET',
      undefined,
      context,
    )
      .then((result) => {
        if (!scope.current() || run !== rosterGeneration.current) return;
        if (!accept(result, scope, '目前讀不到課堂名冊。')) return;
        const groups: Record<string, RosterPerson[]> = { present: [], absent: [], late: [] };
        for (const key of Object.keys(groups)) {
          groups[key] = asRecords(result.body[key]).map((row) => ({
            platformAccountId: String(row.platformAccountId || ''),
            displayName: String(row.displayName || '同學'),
            punctuality: typeof row.punctuality === 'string' ? row.punctuality : undefined,
            makeupRequestState:
              typeof row.makeupRequestState === 'string' ? row.makeupRequestState : undefined,
          }));
        }
        setRoster(groups);
      })
      .catch((failure) => {
        if (!scope.current() || run !== rosterGeneration.current) return;
        setRoster(null);
        setError(failure instanceof Error ? failure.message : '目前讀不到課堂名冊。');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewSession?.id, isTeacher, rosterVersion, captureRequest]);

  async function run(action: (send: Send) => Promise<void>, fallback: string) {
    const scope = requestScope();
    if (!scope.current() || mutationPending.current || loading || readOnly) return;
    mutationPending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const send: Send = async (path, input, method) => {
      if (!scope.current()) return null;
      const result = await platformFetch(path, method ?? (input ? 'POST' : 'GET'), input, context);
      return accept(result, scope, fallback) ? result : null;
    };
    try {
      await action(send);
    } catch (failure) {
      if (scope.current()) setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      if (scope.current()) {
        mutationPending.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="classroom-session-heading">
      <h2 id="classroom-session-heading">課堂簽到</h2>
      <p className={styles.muted}>簽到與補簽不會寫進學校正式出席系統。</p>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {accessDenied ? null : (
        <>
          <Button
            type="button"
            disabled={busy || loading}
            onClick={() => {
              setError('');
              void reload();
            }}
          >
            更新簽到
          </Button>
          {loading ? <p role="status">正在讀取課堂簽到…</p> : null}
          {readOnly ? <p className={styles.muted}>課程已封存，可以查看點名紀錄。</p> : null}
          {isTeacher && !readOnly ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void run(async (send) => {
                  if (
                    !(await send(base, {
                      title: title.trim(),
                      idempotencyKey: `web-classroom-${crypto.randomUUID()}`,
                      ...(unitId ? { unitId } : {}),
                    }))
                  )
                    return;
                  await reload();
                }, '課堂沒有開始成功，請稍後再試。');
              }}
            >
              <Input
                label="課堂名稱"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={160}
                disabled={busy || loading || !!live}
              />
              {units.length ? (
                <Select
                  label="掛在哪個章節"
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                  disabled={busy || loading || !!live}
                  options={[
                    { value: '', label: '不掛章節' },
                    ...units.map((unit) => ({ value: unit.id, label: unit.title })),
                  ]}
                />
              ) : null}
              <Button type="submit" disabled={busy || loading || !!live || title.trim().length < 1}>
                {busy && !live ? '開始中…' : '開始課堂'}
              </Button>
            </form>
          ) : null}
          {live ? (
            <div className={styles.stack}>
              <p role="status">
                進行中：<strong>{live.title}</strong>
                {typeof live.checkInCount === 'number' ? ` · 已簽到 ${live.checkInCount} 人` : ''}
              </p>
              {isTeacher && live.shortCode ? (
                <p className={styles.code} aria-label="課堂短碼">
                  {live.shortCode}
                </p>
              ) : null}
              {!isTeacher && !live.checkedInByMe && !readOnly ? (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async (send) => {
                      if (
                        !(await send(
                          `${base}/${encodeURIComponent(live.id)}/check-in`,
                          code.trim() ? { code: code.trim() } : undefined,
                          'POST',
                        ))
                      )
                        return;
                      setNotice('你已簽到。這不會寫進正式出席系統。');
                      setCode('');
                      await reload();
                    }, '簽到沒有成功，請稍後再試。');
                  }}
                >
                  <Input
                    label="簽到碼（若老師有提供）"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    maxLength={6}
                    autoCapitalize="characters"
                    disabled={busy || loading}
                  />
                  <Button type="submit" disabled={busy || loading}>
                    簽到
                  </Button>
                </form>
              ) : !isTeacher && live.checkedInByMe ? (
                <p>你已簽到。這不會寫進正式出席系統。</p>
              ) : isTeacher && !readOnly ? (
                <Button
                  type="button"
                  disabled={busy || loading}
                  onClick={() =>
                    void run(async (send) => {
                      if (
                        !(await send(
                          `${base}/${encodeURIComponent(live.id)}/end`,
                          undefined,
                          'POST',
                        ))
                      )
                        return;
                      setRoster(null);
                      await reload();
                    }, '課堂沒有結束成功，請稍後再試。')
                  }
                >
                  結束課堂
                </Button>
              ) : null}
            </div>
          ) : !loading ? (
            <p className={styles.muted}>目前沒有進行中的課堂。</p>
          ) : null}
          {!isTeacher &&
          !readOnly &&
          reviewSession?.state === 'closed' &&
          !reviewSession.checkedInByMe ? (
            <div className={styles.stack}>
              <p>課堂已結束：{reviewSession.title}</p>
              {reviewSession.makeupRequestState === 'pending' ? (
                <p>已請老師補簽，還在等處理。</p>
              ) : reviewSession.makeupRequestState === 'rejected' ? (
                <p>這次沒有補簽。</p>
              ) : (
                <Button
                  type="button"
                  disabled={busy || loading}
                  onClick={() =>
                    void run(async (send) => {
                      if (
                        !(await send(
                          `${base}/${encodeURIComponent(reviewSession.id)}/makeup-requests`,
                          undefined,
                          'POST',
                        ))
                      )
                        return;
                      setNotice('已請老師補簽，還在等處理。');
                      await reload();
                    }, '補簽沒有送出，請稍後再試。')
                  }
                >
                  請老師補簽
                </Button>
              )}
            </div>
          ) : null}
          {isTeacher && roster && reviewSession ? (
            <div className={styles.roster} aria-label="課堂名冊">
              {(['present', 'absent', 'late'] as const).map((group) => (
                <div key={group}>
                  <h3>
                    {rosterLabels[group]} {roster[group]?.length ?? 0}
                  </h3>
                  <ul className={styles.stack}>
                    {(roster[group] ?? []).length === 0 ? (
                      <li>現在沒有人</li>
                    ) : (
                      (roster[group] ?? []).map((person) => (
                        <li key={person.platformAccountId}>
                          <span>
                            {person.displayName}
                            {person.punctuality === 'makeup' ? ' · 補簽' : ''}
                          </span>
                          {!readOnly &&
                          group === 'absent' &&
                          reviewSession.state === 'closed' &&
                          person.makeupRequestState === 'pending' ? (
                            <div className={styles.actions}>
                              {(['accept', 'reject'] as const).map((decision) => (
                                <Button
                                  key={decision}
                                  size="sm"
                                  disabled={busy || loading}
                                  onClick={() =>
                                    void run(async (send) => {
                                      if (
                                        !(await send(
                                          `${base}/${encodeURIComponent(reviewSession.id)}/makeup`,
                                          {
                                            platformAccountId: person.platformAccountId,
                                            decision,
                                          },
                                        ))
                                      )
                                        return;
                                      if (decision === 'reject') setNotice('這次沒有補簽。');
                                      await reload();
                                    }, '補簽沒有完成，請稍後再試。')
                                  }
                                >
                                  {decision === 'accept' ? '接受補簽' : '拒絕補簽'}
                                </Button>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
