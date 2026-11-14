'use client';
/** Approval-isolated; host must supply authenticated service and existing calendar adapter. */
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import React, { useEffect, useRef, useState } from 'react';
import {
  INTERNSHIP_STEPS,
  internshipProgress,
  internshipCalendarItem,
  internshipDeadlineState,
  type InternshipAudience,
  type InternshipCalendarItem,
  type InternshipService,
  type InternshipSnapshot,
  type InternshipRule,
  type InternshipRecord,
  type InternshipCommand,
} from '@campus/shared/src/careerInternship';
import styles from './CareerWorkstudy.module.css';
type Children = { children: React.ReactNode };
function Box({ children }: Children) {
  return <div className={styles.stack}>{children}</div>;
}
function Card({ children }: Children) {
  return <section className={styles.card}>{children}</section>;
}
function Heading({ children }: Children) {
  return <h2>{children}</h2>;
}
function Body({ children }: Children) {
  return <p>{children}</p>;
}
function AlertText({ children }: Children) {
  return <p role="alert">{children}</p>;
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
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  );
}
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={styles.field}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function External({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  );
}
function Progress({ value }: { value: number }) {
  return <progress aria-label="實習時數進度" max={100} value={value} />;
}

type Props = {
  schoolId: string;
  ownerKey: string;
  uid: string | null;
  audience: InternshipAudience;
  service: InternshipService;
  onLogin: () => void;
  onAddCalendar: (item: InternshipCalendarItem) => Promise<unknown>;
};
const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
export function CareerInternship(props: Props) {
  return <Content key={`${props.schoolId}:${props.ownerKey}:${props.audience}`} {...props} />;
}
function Content({ schoolId, uid, audience, service, onLogin, onAddCalendar }: Props) {
  const official = resolveSchoolPublicServices(schoolId)?.services.career;
  const [snapshot, setSnapshot] = useState<InternshipSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const writing = useRef(false);
  const loadTicket = useRef(0);
  const createId = useRef(newId());
  const [organization, setOrganization] = useState('');
  const [teacher, setTeacher] = useState('');
  const [teacherUid, setTeacherUid] = useState('');
  const [ruleDraft, setRuleDraft] = useState<InternshipRule | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!uid) return;
    let live = true;
    const load = async () => {
      const ticket = ++loadTicket.current;
      try {
        const result = await service.load(audience);
        if (live && ticket === loadTicket.current) {
          setSnapshot(result);
          setError('');
        }
      } catch (e) {
        if (live) {
          setSnapshot(null);
          setError(e instanceof Error ? e.message : '暫時讀不到實習進度，請重試。');
        }
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [service, uid, audience, retry]);
  async function run(action: () => Promise<unknown>, success = '已儲存，正在更新進度。') {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (active.current) {
        setNotice(success);
        setRetry((v) => v + 1);
      }
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : '操作未完成，請重試。');
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  }
  const execute = (command: Exclude<InternshipCommand, { action: 'list' }>) =>
    run(() => service.execute(command));
  if (!uid)
    return (
      <Card>
        <Heading>我的實習</Heading>
        <Body>登入後查看實習學分與文件進度。</Body>
        <Button label="登入查看實習" onPress={onLogin} />
      </Card>
    );
  return (
    <Box>
      <Heading>
        {audience === 'student'
          ? '我的實習'
          : audience === 'ops'
            ? '實習規則與操作紀錄'
            : '實習紀錄確認'}
      </Heading>
      <Body>實習申請目前在產業實習網，這裡只幫你記進度。</Body>
      {official && <External label="前往校方實習服務入口" url={official.url} />}
      <Body>
        每 1 學分至少 60 小時，依系所公布規則計算；自行登錄不代表已取得學分。每 10 秒更新一次。
      </Body>
      {error && <AlertText>{error}</AlertText>}
      {notice && <Body>{notice}</Body>}
      <Button label="重新整理實習進度" disabled={busy} onPress={() => setRetry((v) => v + 1)} />
      {!snapshot ? (
        <Body>正在讀取實習進度…</Body>
      ) : (
        <>
          {!snapshot.rules.length && <Body>系所尚未設定實習學分規則，請洽系辦確認。</Body>}
          {snapshot.rules.map((rule) => (
            <Card key={rule.id}>
              <Heading>
                {rule.department} · {rule.term}
              </Heading>
              <Body>
                {rule.credits} 學分 · 每學分 {rule.hoursPerCredit} 小時 · 共{' '}
                {rule.credits * rule.hoursPerCredit} 小時
              </Body>
              <External label="查看系所規則" url={rule.sourceUrl} />
              <External label="前往產業實習網申請" url={rule.applicationUrl} />
              {audience === 'staff' && (
                <Button
                  label={`編輯${rule.department}規則`}
                  onPress={() => setRuleDraft(structuredClone(rule))}
                />
              )}
              {audience === 'student' && (
                <Button
                  label={`依${rule.department}規則建立實習`}
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await service.execute({
                        action: 'create',
                        id: createId.current,
                        ruleId: rule.id,
                        ruleRevision: rule.revision,
                        organization,
                        teacher,
                        teacherUid,
                      });
                      createId.current = newId();
                    })
                  }
                />
              )}
            </Card>
          ))}
          {audience === 'student' && (
            <Card>
              <Heading>建立實習紀錄</Heading>
              <Field label="實習機構" value={organization} onChange={setOrganization} />
              <Field label="指導老師姓名" value={teacher} onChange={setTeacher} />
              <Field
                label="指導老師帳號編號（請向系辦確認）"
                value={teacherUid}
                onChange={setTeacherUid}
              />
              <Body>填好後，選擇上方所屬系所與學期的規則建立紀錄。</Body>
            </Card>
          )}
          {audience === 'staff' && (
            <Button
              label="新增系所規則"
              onPress={() =>
                setRuleDraft({
                  id: newId(),
                  revision: 0,
                  department: '',
                  term: '',
                  credits: 1,
                  hoursPerCredit: 60,
                  sourceUrl: '',
                  applicationUrl: '',
                  documents: INTERNSHIP_STEPS.map((title) => ({
                    title,
                    recipient: '',
                    deadline: '',
                  })),
                })
              }
            />
          )}
          {ruleDraft && (
            <Card>
              <Heading>系所實習規則</Heading>
              <Body>
                期限請填含時區的日期時間，例如
                2026-12-01T17:00:00+08:00。既有紀錄保留建立時的規則版本。
              </Body>
              {(['department', 'term', 'sourceUrl', 'applicationUrl'] as const).map((key, i) => (
                <Field
                  key={key}
                  label={['系所', '學期', '校方規則網址', '產業實習網網址'][i]}
                  value={ruleDraft[key]}
                  onChange={(value) => setRuleDraft({ ...ruleDraft, [key]: value })}
                />
              ))}
              <Field
                label="所需學分"
                value={String(ruleDraft.credits)}
                onChange={(v) => setRuleDraft({ ...ruleDraft, credits: Number(v) })}
              />
              <Field
                label="每學分所需時數"
                value={String(ruleDraft.hoursPerCredit)}
                onChange={(v) => setRuleDraft({ ...ruleDraft, hoursPerCredit: Number(v) })}
              />
              {ruleDraft.documents.map((d, i) => (
                <Box key={i}>
                  <Body>{INTERNSHIP_STEPS[i]}</Body>
                  {(['title', 'recipient', 'deadline'] as const).map((key, j) => (
                    <Field
                      key={key}
                      label={`${i + 1} ${['文件名稱', '交給誰', '截止時間'][j]}`}
                      value={d[key]}
                      onChange={(value) =>
                        setRuleDraft({
                          ...ruleDraft,
                          documents: ruleDraft.documents.map((row, n) =>
                            n === i ? { ...row, [key]: value } : row,
                          ),
                        })
                      }
                    />
                  ))}
                </Box>
              ))}
              <Button
                label="儲存系所規則"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    if (ruleDraft.documents.some((d) => !Number.isFinite(Date.parse(d.deadline))))
                      throw new Error('請填寫有效的截止日期與時間。');
                    const rule = {
                      ...ruleDraft,
                      documents: ruleDraft.documents.map((d) => ({
                        ...d,
                        deadline: new Date(d.deadline).toISOString(),
                      })),
                    };
                    await service.execute({ action: 'rule', rule });
                    if (active.current) setRuleDraft(null);
                  })
                }
              />
              <Button label="取消編輯規則" onPress={() => setRuleDraft(null)} />
            </Card>
          )}
          {!snapshot.records.length && audience !== 'ops' && <Body>目前沒有實習紀錄。</Body>}
          {audience !== 'ops' &&
            snapshot.records.map((record) => (
              <RecordCard
                key={`${record.id}:${record.revision}`}
                record={record}
                uid={uid}
                busy={busy}
                execute={execute}
                addCalendar={(i) =>
                  void run(
                    () => onAddCalendar(internshipCalendarItem(record, i)),
                    '已加入個人行事曆。這是期限快照；請至行事曆查看，不會自動發送推播。',
                  )
                }
              />
            ))}
          {audience === 'ops' && (
            <>
              <Body>營運檢視不顯示學生名冊。以下為最近 100 筆校務操作中的實習紀錄。</Body>
              {snapshot.audit.map((a) => (
                <Body key={a.id}>
                  {a.at} · {auditLabel(a.action)} · {a.targetId}
                </Body>
              ))}
            </>
          )}
        </>
      )}
    </Box>
  );
}
function auditLabel(action: string) {
  return (
    (
      {
        internship_rule: '更新系所規則',
        internship_create: '建立實習',
        internship_hours: '登錄時數',
        internship_removeHours: '移除未確認時數',
        internship_document: '登錄文件',
        internship_verifyHours: '確認時數',
        internship_verifyDocument: '確認文件',
        internship_confirm: '老師確認結案',
      } as Record<string, string>
    )[action] || '實習操作'
  );
}
function RecordCard({
  record: r,
  uid,
  busy,
  execute,
  addCalendar,
}: {
  record: InternshipRecord;
  uid: string;
  busy: boolean;
  execute: (c: Exclude<InternshipCommand, { action: 'list' }>) => Promise<void>;
  addCalendar: (i: number) => void;
}) {
  const p = internshipProgress(r);
  const owner = uid === r.uid;
  const [entry, setEntry] = useState({ id: newId(), date: '', hours: '', note: '' });
  const [urls, setUrls] = useState(r.documents.map((d) => d.url));
  const [messages, setMessages] = useState(r.documents.map((d) => d.message));
  const base = { id: r.id, revision: r.revision };
  return (
    <Card>
      {!owner && (
        <Body>
          學生帳號：{r.uid} · 紀錄編號：{r.id}
        </Body>
      )}
      <Heading>
        {r.organization} · {r.rule.term}
      </Heading>
      <Body>
        指導老師：{r.teacher} · {r.rule.department} · 規則第 {r.rule.revision} 版
      </Body>
      <Body>
        已登錄 {p.logged}／需要 {p.required} 小時 · 校方已確認 {p.verified} 小時 · {r.rule.credits}{' '}
        學分
      </Body>
      <Progress value={p.percent} />
      <Body>
        {r.confirmed
          ? '指導老師已確認；學分仍以教務認定為準。'
          : `目前：${INTERNSHIP_STEPS[p.step]}`}
      </Body>
      {p.next >= 0 && (
        <Body>
          下一份：{r.rule.documents[p.next].title} · 交給{r.rule.documents[p.next].recipient} ·{' '}
          {new Date(r.rule.documents[p.next].deadline).toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
          })}
          （臺灣時間）
        </Body>
      )}
      <External label="查看這筆實習適用規則" url={r.rule.sourceUrl} />
      {r.rule.documents.map((d, i) => (
        <Box key={i}>
          <Body>
            {i + 1}. {INTERNSHIP_STEPS[i]}：{d.title} · 交給{d.recipient} ·{' '}
            {new Date(d.deadline).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}（臺灣時間）
            ·{' '}
            {r.documents[i].verified
              ? '已確認'
              : r.documents[i].submitted
                ? '已登錄繳交，待確認'
                : internshipDeadlineState(d.deadline)}
          </Body>
          {r.documents[i].message && <Body>承辦回覆：{r.documents[i].message}</Body>}
          {r.documents[i].url && <External label={`查看${d.title}`} url={r.documents[i].url} />}
          {!r.documents[i].verified && (
            <Button
              label={`將${d.title}加入行事曆`}
              disabled={busy}
              onPress={() => addCalendar(i)}
            />
          )}
          {!r.confirmed &&
            (owner
              ? !r.documents[i].verified && (
                  <>
                    <Field
                      label={`${d.title}文件連結`}
                      value={urls[i]}
                      onChange={(v) => setUrls(urls.map((x, n) => (n === i ? v : x)))}
                    />
                    <Button
                      label={`登錄已繳交${d.title}`}
                      disabled={busy}
                      onPress={() =>
                        void execute({
                          ...base,
                          action: 'document',
                          index: i,
                          url: urls[i],
                          submitted: true,
                        })
                      }
                    />
                    {r.documents[i].submitted && (
                      <Button
                        label={`撤回${d.title}繳交登錄`}
                        disabled={busy}
                        onPress={() =>
                          void execute({
                            ...base,
                            action: 'document',
                            index: i,
                            url: '',
                            submitted: false,
                          })
                        }
                      />
                    )}
                  </>
                )
              : r.documents[i].submitted && (
                  <>
                    <Field
                      label={`${d.title}退回原因`}
                      value={messages[i]}
                      onChange={(v) => setMessages(messages.map((x, n) => (n === i ? v : x)))}
                    />
                    <Button
                      label={`確認${d.title}`}
                      disabled={busy}
                      onPress={() =>
                        void execute({
                          ...base,
                          action: 'verifyDocument',
                          index: i,
                          verified: true,
                          message: '',
                        })
                      }
                    />
                    <Button
                      label={`退回${d.title}`}
                      disabled={busy}
                      onPress={() =>
                        void execute({
                          ...base,
                          action: 'verifyDocument',
                          index: i,
                          verified: false,
                          message: messages[i],
                        })
                      }
                    />
                  </>
                ))}
        </Box>
      ))}
      <Heading>時數明細</Heading>
      {r.hours.map((h) => (
        <Box key={h.id}>
          <Body>
            {h.date} · {h.hours} 小時 · {h.note} · {h.verified ? '已確認' : '待確認'}
          </Body>
          {!r.confirmed &&
            (owner ? (
              !h.verified && (
                <Box>
                  <Button
                    label={`移除${h.date}未確認時數`}
                    disabled={busy}
                    onPress={() => void execute({ ...base, action: 'removeHours', entryId: h.id })}
                  />
                  <Button
                    label={`更正${h.date}時數`}
                    onPress={() => setEntry({ ...h, hours: String(h.hours) })}
                  />
                </Box>
              )
            ) : (
              <Button
                label={`${h.verified ? '撤銷確認' : '確認'}${h.date}時數`}
                disabled={busy}
                onPress={() =>
                  void execute({
                    ...base,
                    action: 'verifyHours',
                    entryId: h.id,
                    verified: !h.verified,
                  })
                }
              />
            ))}
        </Box>
      ))}
      {owner && !r.confirmed && (
        <Box>
          {(['date', 'hours', 'note'] as const).map((k, i) => (
            <Field
              key={k}
              label={['實習日期（西元年-月-日）', '實習時數', '工作內容與佐證說明'][i]}
              value={entry[k]}
              onChange={(v) => setEntry({ ...entry, [k]: v })}
            />
          ))}
          <Button
            label="儲存實習時數"
            disabled={busy}
            onPress={() =>
              void execute({
                ...base,
                action: 'hours',
                entry: { ...entry, hours: Number(entry.hours) },
              })
            }
          />
        </Box>
      )}
      {!r.confirmed && uid === r.teacherUid && (
        <Button
          label="指導老師確認結案"
          disabled={busy}
          onPress={() => void execute({ ...base, action: 'confirm' })}
        />
      )}
    </Card>
  );
}
