/** Unmounted until the new data access is approved. */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { aiTokens } from '../../ui/aiFirst';
import { resolveSchoolPublicServices } from '../../../../../packages/shared/src/schoolPublicServices';
type Children = { children: React.ReactNode };
function Box({ children }: Children) {
  return <View style={styles.stack}>{children}</View>;
}
function Card({ children }: Children) {
  return <View style={styles.card}>{children}</View>;
}
function Row({ children }: Children) {
  return <View style={styles.row}>{children}</View>;
}
function Body({ children }: Children) {
  return <Text style={styles.body}>{children}</Text>;
}
function Muted({ children }: Children) {
  return <Text style={styles.muted}>{children}</Text>;
}
function Heading({ children }: Children) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}
function AlertText({ children }: Children) {
  return (
    <Text accessibilityRole="alert" style={styles.body}>
      {children}
    </Text>
  );
}
function StatusText({ children }: Children) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.body}>
      {children}
    </Text>
  );
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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && { opacity: 0.5 }]}
    >
      <Text style={styles.body}>{label}</Text>
    </Pressable>
  );
}
function External({ label, url }: { label: string; url: string }) {
  const [error, setError] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(url).catch(() => setError(true));
        }}
        style={styles.button}
      >
        <Text style={styles.body}>{label}</Text>
      </Pressable>
      {error && <AlertText>無法開啟連結，請稍後重試。</AlertText>}
    </View>
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
    <View style={styles.stack}>
      <Body>{label}</Body>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        style={styles.input}
      />
    </View>
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
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.button}
    >
      <Text style={styles.body}>
        {checked ? '☑' : '☐'} {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: { gap: 12, padding: 16, borderWidth: 1, borderColor: aiTokens.border, borderRadius: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  body: { fontSize: 16, lineHeight: 25, color: aiTokens.text },
  muted: { fontSize: 14, lineHeight: 22, color: aiTokens.muted },
  heading: { fontSize: 20, fontWeight: '700', color: aiTokens.text },
  input: {
    borderWidth: 1,
    borderColor: aiTokens.border,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    color: aiTokens.text,
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: aiTokens.border,
    borderRadius: 8,
  },
});
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
} from '../../../../../packages/shared/src/careerWorkstudy';
import type { PersonalCourse } from '../../../../../packages/shared/src/timetable/course';

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
  const [tab, setTab] = useState('機會');
  const alive = useRef(true);
  const inFlight = useRef(false);
  const generation = useRef(0);
  async function refresh() {
    const current = ++generation.current;
    try {
      const data = await service.load(audience);
      if (alive.current && current === generation.current) {
        setSnapshot(data);
        setCheckedAt(Date.now());
        setError('');
      }
    } catch (e) {
      if (alive.current && current === generation.current) {
        setSnapshot(null);
        setError(e instanceof Error ? e.message : '暫時讀不到工讀資料，請重新整理。');
      }
    }
  }
  useEffect(() => {
    alive.current = true;
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
      setNotice(command.action === 'apply' ? '已送出申請，可在「我的申請」查看進度。' : '已儲存。');
      await refresh();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '這次沒有完成，請重試。');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const displayedOpportunities =
    snapshot?.opportunities.filter((o) => audience === 'staff' || o.type === 'workstudy') ?? [];
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
  return (
    <Box>
      <Heading>
        {audience === 'student'
          ? '校內工讀'
          : audience === 'staff'
            ? '職涯工作台'
            : '職涯來源與操作紀錄'}
      </Heading>
      {error && <AlertText>{error}</AlertText>}
      {notice && <StatusText>{notice}</StatusText>}
      <Button
        label="重新整理工讀資料"
        disabled={busy}
        onPress={() => {
          void refresh();
          void loadCourses()
            .then(setCourses)
            .catch(() => setCourses(null));
        }}
      />
      {!snapshot && !error && <Body>正在讀取工讀資料…</Body>}
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
          {snapshot && !displayedOpportunities.length && (
            <Box>
              <Body>職產處還沒在這裡上架工讀或實習。</Body>
              {official && <External label="前往職產處官網 ↗" url={official.url} />}
            </Box>
          )}
          {displayedOpportunities.map((o) => {
            const conflicts = workstudyConflicts(schoolId, o.slots, courses);
            const application = snapshot?.applications.find((a) => a.opportunityId === o.id);
            const closed = Date.parse(o.deadline) <= checkedAt || !o.published;
            return (
              <Card key={o.id}>
                <Heading>{o.title}</Heading>
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
                <External label="校方原始公告 ↗" url={o.sourceUrl} />
                {audience === 'staff' ? (
                  <Button label={`編輯${o.title}`} onPress={() => edit(o)} />
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
              {audience === 'staff' && (
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
          <Body>調整來源會留下操作紀錄；公開職涯入口持續保留。</Body>
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
