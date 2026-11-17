'use client';
/** Unmounted until the new data access is approved. */
import React, { useEffect, useRef, useState } from 'react';
import styles from './CareerWorkstudy.module.css';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
type Children = { children: React.ReactNode };
function Box({ children }: Children) {
  return <div className={styles.stack}>{children}</div>;
}
function Card({ children }: Children) {
  return <section className={styles.card}>{children}</section>;
}
function Row({ children }: Children) {
  return <div className={styles.row}>{children}</div>;
}
function Body({ children }: Children) {
  return <p>{children}</p>;
}
function Muted({ children }: Children) {
  return <p className={styles.muted}>{children}</p>;
}
function Heading({ children }: Children) {
  return <h2>{children}</h2>;
}
function AlertText({ children }: Children) {
  return <p role="alert">{children}</p>;
}
function StatusText({ children }: Children) {
  return <p role="status">{children}</p>;
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onPress} disabled={disabled}>
      {label}
    </button>
  );
}
function External({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}
function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className={styles.field}>
      {label}
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
import {
  APPLICATION_LABELS,
  APPLICATION_STATES,
  careerAuditLabel,
  emptyOpportunity,
  slotLabel,
  transitionAllowed,
  workstudyConflicts,
  type CareerOpportunity,
  type CareerCommand,
  type WorkstudyService,
  type WorkstudySnapshot,
  type CareerWorkbenchEvent,
} from '@campus/shared/src/careerWorkstudy';
import type { PersonalCourse } from '@campus/shared/src/timetable/course';

export type CareerWorkstudyProps = {
  schoolId: string;
  /** Identity key must change on sign-out/account change. No auth/session code lives here. */
  ownerKey: string | null;
  service: WorkstudyService;
  loadCourses: () => Promise<PersonalCourse[] | null>;
  onLogin: () => void;
  audience?: 'student' | 'staff' | 'ops';
  onCareerEvents: (filter: { category: 'career'; event?: CareerWorkbenchEvent }) => void;
};
export function CareerWorkstudy(props: CareerWorkstudyProps) {
  return (
    <Workspace
      key={`${props.schoolId}:${props.ownerKey}:${props.audience ?? 'student'}`}
      {...props}
    />
  );
}
function Workspace({
  schoolId,
  ownerKey,
  service,
  loadCourses,
  onLogin,
  onCareerEvents,
  audience = 'student',
}: CareerWorkstudyProps) {
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState<WorkstudySnapshot | null>(null);
  const [courses, setCourses] = useState<PersonalCourse[] | null>(null);
  const [selected, setSelected] = useState<CareerOpportunity | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [contact, setContact] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [draft, setDraft] = useState<CareerOpportunity | null>(null);
  const [slotsText, setSlotsText] = useState('');
  const [deadline, setDeadline] = useState('');
  const [message, setMessage] = useState<Record<string, { value: string; revision: number }>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);
  const [tab, setTab] = useState('機會');
  const [typeFilter, setTypeFilter] = useState<'all' | CareerOpportunity['type']>('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [slotFilter, setSlotFilter] = useState('all');
  const [creditFilter, setCreditFilter] = useState<'all' | 'credit' | 'non-credit'>('all');
  const alive = useRef(true);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const readTask = useRef<Promise<void> | null>(null);
  const readController = useRef<AbortController | null>(null);
  const pendingRefresh = useRef(false);
  const session = useRef(0);
  function refresh(): Promise<void> {
    if (!alive.current) return Promise.resolve();
    if (readTask.current) {
      // Queue one follow-up; triggers alone must not starve the active read.
      pendingRefresh.current = true;
      return readTask.current;
    }
    const epoch = session.current;
    const task = (async () => {
      do {
        pendingRefresh.current = false;
        const controller = new AbortController();
        readController.current = controller;
        const current = ++generation.current;
        try {
          const data = await service.load(audience, { signal: controller.signal });
          if (alive.current && !controller.signal.aborted && current === generation.current) {
            setSnapshot(data);
            setCheckedAt(Date.now());
            setError('');
          }
        } catch (e) {
          if (alive.current && !controller.signal.aborted && current === generation.current) {
            setSnapshot(null);
            setError(e instanceof Error ? e.message : '暫時讀不到工讀資料，請重新整理。');
          }
        }
      } while (alive.current && epoch === session.current && pendingRefresh.current);
    })();
    readTask.current = task;
    void task.finally(() => {
      if (readTask.current === task) {
        readTask.current = null;
        readController.current = null;
        // A write can request a refresh after the loop exits but before this cleanup.
        if (alive.current && pendingRefresh.current) void refresh();
      }
    });
    return task;
  }
  useEffect(() => {
    alive.current = true;
    const epoch = session.current;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void refresh();
    });
    void loadCourses()
      .then((value) => {
        if (!cancelled && alive.current) setCourses(value);
      })
      .catch(() => {
        if (!cancelled && alive.current) setCourses(null);
      });
    const unsubscribe = service.subscribe?.(
      audience,
      () => {
        if (!inFlight.current) void refresh();
      },
      () => {
        if (alive.current) setError('即時更新暫時中斷，仍會定時重新整理。');
      },
    );
    const timer = setInterval(() => {
      if (!inFlight.current) void refresh();
    }, 10000);
    return () => {
      cancelled = true;
      alive.current = false;
      session.current = epoch + 1;
      pendingRefresh.current = false;
      readController.current?.abort();
      readTask.current = null;
      readController.current = null;
      clearInterval(timer);
      unsubscribe?.();
    };
    // The wrapper remounts on school, account or audience change; service/loadCourses are stable ports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, loadCourses]);
  async function execute(command: Exclude<CareerCommand, { action: 'list' }>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    generation.current++;
    pendingRefresh.current = false;
    readController.current?.abort();
    try {
      await service.execute(command);
      if (!alive.current) return;
      if (command.action === 'review') {
        setMessage((previous) => {
          const next = { ...previous };
          delete next[command.applicationId];
          return next;
        });
      }
      setSelected(null);
      setConfirmed(false);
      setDraft(null);
      setNotice(
        command.action === 'apply'
          ? '已送出申請，可在「我的申請」查看進度。'
          : command.action === 'withdraw'
            ? '已撤回申請。'
            : '已儲存。',
      );
      setConfirmWithdraw(null);
      await refresh();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '這次沒有完成，請重試。');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const displayedOpportunities =
    snapshot?.opportunities.filter((o) => audience === 'staff' || o.published) ?? [];
  const unitOptions = [...new Set(displayedOpportunities.map((opportunity) => opportunity.unit))];
  const slotOptions = [
    ...new Set(
      displayedOpportunities.flatMap((opportunity) =>
        opportunity.slots.map((slot) => slotLabel(slot)),
      ),
    ),
  ];
  const filteredOpportunities = displayedOpportunities.filter((opportunity) => {
    if (typeFilter !== 'all' && opportunity.type !== typeFilter) return false;
    if (unitFilter !== 'all' && opportunity.unit !== unitFilter) return false;
    if (
      slotFilter !== 'all' &&
      !opportunity.slots.map((slot) => slotLabel(slot)).includes(slotFilter)
    )
      return false;
    if (creditFilter === 'credit' && !opportunity.credit) return false;
    if (creditFilter === 'non-credit' && opportunity.credit) return false;
    return true;
  });
  const official = resolveSchoolPublicServices(schoolId)?.services.career;
  function edit(opportunity: CareerOpportunity) {
    setDraft({ ...opportunity });
    setSlotsText(opportunity.slots.map((s) => `${s.day} ${s.start} ${s.end}`).join('\n'));
    setDeadline(
      opportunity.deadline
        ? new Date(Date.parse(opportunity.deadline) + 8 * 3600000)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ')
        : '',
    );
  }
  function save() {
    if (!draft) return;
    if (
      !/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(deadline) ||
      !Number.isFinite(Date.parse(deadline.replace(' ', 'T') + ':00+08:00'))
    ) {
      setError('截止時間請填 YYYY-MM-DD HH:mm（臺灣時間）。');
      return;
    }
    const slots = slotsText
      .trim()
      .split('\n')
      .map((row) => {
        const [day, start, end] = row.trim().split(/\s+/);
        return { day: Number(day), start, end };
      });
    void execute({
      action: 'save',
      opportunity: {
        ...draft,
        slots,
        deadline: new Date(deadline.replace(' ', 'T') + ':00+08:00').toISOString(),
      },
    });
  }
  if (selected)
    return (
      <Box>
        {error && <AlertText>{error}</AlertText>}
        <Card>
          <Heading>工讀權益</Heading>
          <Body>{selected.rightsTitle}</Body>
          <Body>{selected.rightsText}</Body>
          <External label="閱讀校方權益公告 ↗" url={selected.rightsUrl} />
          <Body>這份說明隨申請保留。勾選僅確認已閱讀，不代替勞動契約，也不影響你的權益。</Body>
          <Toggle label="我看過了" checked={confirmed} onChange={setConfirmed} />
          <Field label="聯絡方式" value={contact} onChange={setContact} />
          <Field
            label="想讓單位知道的事（選填）"
            value={introduction}
            onChange={setIntroduction}
            multiline
          />
          <Button
            label="送出申請"
            disabled={!confirmed || !contact.trim() || busy}
            onPress={() =>
              void execute({
                action: 'apply',
                opportunityId: selected.id,
                revision: selected.revision,
                confirmed,
                contact,
                introduction,
              })
            }
          />
          <Button label="返回機會" disabled={busy} onPress={() => setSelected(null)} />
        </Card>
      </Box>
    );
  if (audience === 'student' && snapshot?.viewerRole === 'teacher' && !snapshot.applications.length)
    return null;
  return (
    <Box>
      <Heading>
        {audience === 'student'
          ? '校內工讀、實習與校徵'
          : audience === 'staff'
            ? '職涯工作台'
            : '職涯來源與操作紀錄'}
      </Heading>
      {error && <AlertText>{error}</AlertText>}
      {notice && <StatusText>{notice}</StatusText>}
      <Button
        label="重新整理職涯機會"
        disabled={busy}
        onPress={() => {
          void refresh();
          void loadCourses()
            .then((value) => {
              if (alive.current) setCourses(value);
            })
            .catch(() => {
              if (alive.current) setCourses(null);
            });
        }}
      />
      {!snapshot && !error && <Body>正在讀取職涯機會…</Body>}
      {audience === 'staff' && (
        <Box>
          <Body>工作台 › 職涯</Body>
          <Row>
            {['機會', '申請', '活動'].map((t) => (
              <Button key={t} label={t} onPress={() => setTab(t)} />
            ))}
          </Row>
        </Box>
      )}
      {audience === 'staff' && snapshot && !snapshot.canReview && (
        <Body>目前沒有這所學校的職涯承辦權限。</Body>
      )}
      {audience === 'student' || (audience === 'staff' && snapshot?.canReview && tab === '機會') ? (
        <Box>
          {audience === 'staff' && (
            <Button label="新增機會" onPress={() => edit(emptyOpportunity())} />
          )}
          {snapshot && (
            <Row>
              <label>
                類型
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
                >
                  <option value="all">全部</option>
                  <option value="workstudy">工讀</option>
                  <option value="internship">實習</option>
                  <option value="fair">校徵</option>
                </select>
              </label>
              <label>
                單位
                <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
                  <option value="all">全部</option>
                  {unitOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                時段
                <select value={slotFilter} onChange={(event) => setSlotFilter(event.target.value)}>
                  <option value="all">全部</option>
                  {slotOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                學分
                <select
                  value={creditFilter}
                  onChange={(event) =>
                    setCreditFilter(event.target.value as 'all' | 'credit' | 'non-credit')
                  }
                >
                  <option value="all">全部</option>
                  <option value="credit">可抵學分</option>
                  <option value="non-credit">不抵學分</option>
                </select>
              </label>
            </Row>
          )}
          {snapshot && !displayedOpportunities.length && (
            <Box>
              <Body>目前沒有已上架的工讀、實習或校徵機會。</Body>
              {official && <External label="前往職產處官網 ↗" url={official.url} />}
            </Box>
          )}
          {snapshot && !!displayedOpportunities.length && !filteredOpportunities.length && (
            <Body>沒有符合目前篩選條件的職涯機會。</Body>
          )}
          {filteredOpportunities.map((o) => {
            const conflicts = workstudyConflicts(schoolId, o.slots, courses);
            const application = snapshot?.applications.find(
              (a) => a.opportunityId === o.id && a.state !== 'withdrawn',
            );
            const closed = Date.parse(o.deadline) <= checkedAt || !o.published;
            return (
              <Card key={o.id}>
                <Heading>{o.title}</Heading>
                <Body>類型：{{ workstudy: '工讀', internship: '實習', fair: '校徵' }[o.type]}</Body>
                <Body>
                  {o.unit} · {o.pay} · {o.places} 名
                </Body>
                <Body>{o.slots.map(slotLabel).join('、')}</Body>
                <Body>
                  截止：
                  {new Date(o.deadline).toLocaleString('zh-TW', {
                    timeZone: 'Asia/Taipei',
                    hour12: false,
                  })}
                  （臺灣時間）
                </Body>
                <Body>
                  {o.credit ? '可抵學分，認定請洽承辦' : '不抵學分'}
                  {o.courseCode ? ` · 課號 ${o.courseCode}` : ''}
                </Body>
                {!!conflicts.names.length && (
                  <Muted>與你的課衝堂：{conflicts.names.join('、')}</Muted>
                )}
                {!conflicts.known && <Muted>課表資料不完整，請自行確認時段。</Muted>}
                {conflicts.known && !conflicts.names.length && (
                  <Muted>與目前課表沒有衝堂，排班仍請與單位確認。</Muted>
                )}
                {o.sourceUrl && <External label="校方原始公告 ↗" url={o.sourceUrl} />}
                {audience === 'staff' ? (
                  <Button label={`編輯${o.title}`} onPress={() => edit(o)} />
                ) : o.type !== 'workstudy' ? (
                  <Body>此類機會請依校方公告方式報名</Body>
                ) : application ? (
                  <Body>{APPLICATION_LABELS[application.state]}</Body>
                ) : closed ? (
                  <Body>已截止或下架</Body>
                ) : (
                  <Button
                    label={`應徵${o.title}`}
                    onPress={() => {
                      if (!ownerKey) {
                        onLogin();
                        return;
                      }
                      setSelected(o);
                      setConfirmed(false);
                      setContact('');
                      setIntroduction('');
                      setError('');
                    }}
                  />
                )}
              </Card>
            );
          })}
        </Box>
      ) : null}
      {draft && (
        <Card>
          <Heading>編輯機會</Heading>
          <Row>
            {(['workstudy', 'internship', 'fair'] as const).map((type, i) => (
              <Button
                key={type}
                label={`${draft.type === type ? '已選：' : ''}${['工讀', '實習', '校徵'][i]}`}
                onPress={() => setDraft({ ...draft, type })}
              />
            ))}
          </Row>
          {(
            [
              ['title', '標題'],
              ['unit', '單位'],
              ['pay', '時薪或待遇'],
              ['courseCode', '對應課號（選填）'],
              ['sourceUrl', '校方公告網址'],
              ['rightsTitle', '權益公告標題'],
              ['rightsUrl', '權益公告網址'],
              ['rightsText', '權益公告內容'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={draft[key]}
              onChange={(value) => setDraft({ ...draft, [key]: value })}
              multiline={key === 'rightsText'}
            />
          ))}
          <Field
            label="名額"
            value={String(draft.places)}
            onChange={(value) => setDraft({ ...draft, places: Number(value) })}
          />
          <Field
            label="每週時段（一列一段：星期數 HH:mm HH:mm，週一為 1、週日為 7）"
            value={slotsText}
            onChange={setSlotsText}
            multiline
          />
          <Field
            label="截止時間（YYYY-MM-DD HH:mm，臺灣時間）"
            value={deadline}
            onChange={setDeadline}
          />
          <Toggle
            label="可抵學分"
            checked={draft.credit}
            onChange={(credit) => setDraft({ ...draft, credit })}
          />
          <Toggle
            label="上架"
            checked={draft.published}
            onChange={(published) => setDraft({ ...draft, published })}
          />
          <Button label="儲存機會" disabled={busy} onPress={save} />
          <Button label="取消編輯" disabled={busy} onPress={() => setDraft(null)} />
        </Card>
      )}
      {(audience === 'student' ||
        (audience === 'staff' && snapshot?.canReview && tab === '申請')) && (
        <Box>
          <Heading>{audience === 'student' ? '我的申請' : '申請名單'}</Heading>
          <Body>
            已送出 → 單位已讀 → 約面談 → 錄取／未錄取。開啟期間會更新進度，也可手動重新整理。
          </Body>
          {!ownerKey && <Button label="登入查看我的申請" onPress={onLogin} />}
          {ownerKey && snapshot && !snapshot.applications.length && <Body>目前沒有申請紀錄。</Body>}
          {snapshot?.applications.map((a) => (
            <Card key={a.id}>
              <Heading>{a.opportunityTitle}</Heading>
              <Body>
                {a.unit} · {APPLICATION_LABELS[a.state]}
              </Body>
              <Body>
                送出：{new Date(a.submittedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
              </Body>
              <Body>
                更新：{new Date(a.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
              </Body>
              {!!a.message && <Body>單位回覆：{a.message}</Body>}
              <Body>
                權益確認：{a.rights.title} · 第 {a.rights.revision} 版 ·{' '}
                {new Date(a.rights.confirmedAt).toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei',
                })}
              </Body>
              <Body>{a.rights.text}</Body>
              <External label="申請時的權益公告 ↗" url={a.rights.url} />
              {audience === 'student' && ['submitted', 'read'].includes(a.state) && (
                <Box>
                  <Button
                    label="撤回申請"
                    disabled={busy}
                    onPress={() => setConfirmWithdraw(a.id)}
                  />
                  {confirmWithdraw === a.id && (
                    <Box>
                      <Body>確定要撤回這筆工讀申請嗎？</Body>
                      <Button
                        label="確認撤回申請"
                        disabled={busy}
                        onPress={() =>
                          void execute({
                            action: 'withdraw',
                            applicationId: a.id,
                            revision: a.revision,
                          })
                        }
                      />
                      <Button
                        label="取消"
                        disabled={busy}
                        onPress={() => setConfirmWithdraw(null)}
                      />
                    </Box>
                  )}
                </Box>
              )}
              {audience === 'staff' && a.state !== 'withdrawn' && (
                <Box>
                  <Body>聯絡方式：{a.contact}</Body>
                  <Body>{a.introduction || '未填補充說明'}</Body>
                  {message[a.id] !== undefined && message[a.id].revision !== a.revision && (
                    <Box>
                      <Body>這筆申請已由其他承辦更新，請捨棄草稿並確認最新回覆後再操作。</Body>
                      <Button
                        label="捨棄草稿，使用最新回覆"
                        disabled={busy}
                        onPress={() =>
                          setMessage((previous) => {
                            const next = { ...previous };
                            delete next[a.id];
                            return next;
                          })
                        }
                      />
                    </Box>
                  )}
                  <Field
                    label={`給${a.opportunityTitle}申請人的回覆（面談請填時間、地點與聯絡人）`}
                    value={message[a.id]?.value ?? a.message}
                    onChange={(value) =>
                      setMessage({
                        ...message,
                        [a.id]: { value, revision: message[a.id]?.revision ?? a.revision },
                      })
                    }
                    multiline
                  />
                  <Button
                    label="清除回覆（隨狀態更新儲存）"
                    disabled={busy || !(message[a.id]?.value ?? a.message)}
                    onPress={() =>
                      setMessage({
                        ...message,
                        [a.id]: { value: '', revision: message[a.id]?.revision ?? a.revision },
                      })
                    }
                  />
                  <Row>
                    {APPLICATION_STATES.filter((s) => transitionAllowed(a.state, s)).map(
                      (state) => (
                        <Button
                          key={state}
                          label={`改為${APPLICATION_LABELS[state]}`}
                          disabled={
                            busy ||
                            (message[a.id] !== undefined &&
                              message[a.id].revision !== a.revision) ||
                            (state === 'interview' && !(message[a.id]?.value ?? a.message).trim())
                          }
                          onPress={() =>
                            void execute({
                              action: 'review',
                              applicationId: a.id,
                              revision: a.revision,
                              state,
                              ...(message[a.id] !== undefined
                                ? { message: message[a.id].value }
                                : {}),
                            })
                          }
                        />
                      ),
                    )}
                  </Row>
                </Box>
              )}
            </Card>
          ))}
        </Box>
      )}
      {audience === 'staff' && snapshot?.canReview && tab === '活動' && (
        <Card>
          <Heading>校徵與講座</Heading>
          <Body>沿用校園活動的報名與名額，請選擇職涯類別。</Body>
          {!snapshot.events.length && <Body>目前沒有職涯類別的校園活動。</Body>}
          {snapshot.events.map((event) => (
            <Box key={`${event.source}:${event.id}`}>
              <Body>
                {event.title} ·{' '}
                {event.startsAt
                  ? new Date(event.startsAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
                  : '時間待公告'}
              </Body>
              <Button
                label={`查看${event.title}與報名`}
                onPress={() => onCareerEvents({ category: 'career', event })}
              />
            </Box>
          ))}
          <Button label="查看職涯活動" onPress={() => onCareerEvents({ category: 'career' })} />
        </Card>
      )}
      {audience === 'ops' && snapshot?.canOperate && snapshot.sources && (
        <Card>
          <Heading>資料來源</Heading>
          <Body>
            調整來源會留下操作紀錄；重新整理公開職涯頁後套用，快取最多延遲 30
            秒。官方網站連結仍會保留。
          </Body>
          {(
            [
              ['office', '職產處'],
              ['departments', '系所'],
              ['taiwanjobs', '台灣就業通'],
            ] as const
          ).map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={snapshot.sources![key]}
              onChange={(value) => {
                if (!busy)
                  void execute({
                    action: 'sources',
                    sources: { ...snapshot.sources!, [key]: value },
                  });
              }}
            />
          ))}
          <Heading>近期操作紀錄</Heading>
          {!snapshot.audit.length && <Body>目前沒有職涯操作紀錄。</Body>}
          {snapshot.audit.map((a) => (
            <Body key={a.id}>
              {new Date(a.at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} · 操作人：
              {a.actorUid} · {careerAuditLabel(a.action)} · {a.targetId}
            </Body>
          ))}
        </Card>
      )}
    </Box>
  );
}
