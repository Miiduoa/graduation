/** Approval-isolated; intentionally absent from navigation. */
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
import { View, Text, Pressable, TextInput, Linking } from 'react-native';
const OperationFeedback = React.createContext<{
  error: string;
  target: string;
  notice: string;
  select: (target: string) => void;
}>({
  error: '',
  target: '',
  notice: '',
  select: () => {},
});
// Keep the triggering control stable across list polls and record revision updates.
const OperationScope = React.createContext('page');
type Children = { children: React.ReactNode };
function Box({ children }: Children) {
  return <View style={{ gap: 12 }}>{children}</View>;
}
function Card({ children, testID }: Children & { testID?: string }) {
  return (
    <View
      testID={testID}
      style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12 }}
    >
      {children}
    </View>
  );
}
function Heading({ children }: Children) {
  return (
    <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', color: '#172554' }}>
      {children}
    </Text>
  );
}
function Body({ children }: Children) {
  return <Text style={{ fontSize: 16, lineHeight: 25, color: '#172554' }}>{children}</Text>;
}
function AlertText({ children }: Children) {
  return <Text accessibilityRole="alert">{children}</Text>;
}
function Button({
  label,
  actionId,
  onPress,
  disabled,
}: {
  label: string;
  actionId?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const feedback = React.useContext(OperationFeedback);
  const scope = React.useContext(OperationScope);
  const id = `${scope}:${actionId || label}`;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => {
          feedback.select(id);
          onPress();
        }}
        style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
      >
        <Text style={{ color: '#2453a6', fontSize: 16 }}>{label}</Text>
      </Pressable>
      {feedback.target === id && feedback.error && <AlertText>{feedback.error}</AlertText>}
    </>
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
    <View>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        style={{ borderWidth: 1, borderColor: '#94a3b8', padding: 10, color: '#172554' }}
      />
    </View>
  );
}
function External({ label, url }: { label: string; url: string }) {
  const [error, setError] = useState('');
  return (
    <View>
      <Pressable
        accessibilityRole="link"
        onPress={() =>
          void Linking.openURL(url).catch(() => setError('無法開啟連結，請稍後重試。'))
        }
      >
        <Text style={{ color: '#2453a6' }}>{label} ↗</Text>
      </Pressable>
      {!!error && <AlertText>{error}</AlertText>}
    </View>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="實習時數進度"
      accessibilityValue={{ min: 0, max: 100, now: value }}
      style={{ height: 8, backgroundColor: '#e2e8f0' }}
    >
      <View style={{ height: 8, width: `${value}%`, backgroundColor: '#2453a6' }} />
    </View>
  );
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
function needsReview(record: InternshipRecord) {
  if (record.confirmed) return false;
  const progress = internshipProgress(record);
  return (
    record.documents.some((d) => d.submitted && !d.verified) ||
    record.hours.some((h) => !h.verified) ||
    (progress.next < 0 && progress.verified >= progress.required)
  );
}
export function CareerInternship(props: Props) {
  return <Content key={`${props.schoolId}:${props.ownerKey}:${props.audience}`} {...props} />;
}
function Content({ schoolId, uid, audience, service, onLogin, onAddCalendar }: Props) {
  const official = resolveSchoolPublicServices(schoolId)?.services.career;
  const [snapshot, setSnapshot] = useState<InternshipSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [errorTarget, setErrorTarget] = useState('');
  const pendingTarget = useRef('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const writing = useRef(false);
  const createId = useRef(newId());
  const [organization, setOrganization] = useState('');
  const [teacher, setTeacher] = useState('');
  const [teacherUid, setTeacherUid] = useState('');
  const [advisorKeyword, setAdvisorKeyword] = useState('');
  const [advisors, setAdvisors] = useState<NonNullable<InternshipSnapshot['advisors']>>([]);
  const [advisorSearched, setAdvisorSearched] = useState(false);
  const advisorSearchStarted = useRef(false);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
    let controller: AbortController | null = null;
    let readTimeout: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (controller) return;
      const current = new AbortController();
      controller = current;
      const timeout = (readTimeout = setTimeout(() => {
        current.abort();
        if (live) {
          setLoadError('讀取實習進度逾時，請重新整理。');
          controller = null;
        }
      }, 15000));
      try {
        const result = await service.load(audience, { signal: current.signal });
        if (live && !current.signal.aborted) {
          setSnapshot(result);
          if (audience === 'student' && !advisorSearchStarted.current && result.advisors?.length)
            setAdvisors((current) => (current.length ? current : result.advisors!));
          setLoadError('');
        }
      } catch (e) {
        if (live && !current.signal.aborted) {
          setLoadError(e instanceof Error ? e.message : '暫時讀不到實習進度，請重試。');
        }
      } finally {
        clearTimeout(timeout);
        if (controller === current) controller = null;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => {
      live = false;
      controller?.abort();
      clearTimeout(readTimeout);
      clearInterval(timer);
    };
  }, [service, uid, audience, retry]);
  async function run(action: () => Promise<unknown>, success = '已儲存，正在更新進度。') {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setErrorTarget(pendingTarget.current);
    setError('');
    setNotice('');
    try {
      await action();
      if (active.current) {
        setNotice(success);
        setRetry((v) => v + 1);
      }
      return true;
    } catch (e) {
      if (active.current) {
        setError(e instanceof Error ? e.message : '操作未完成，請重試。');
        const conflict = e as { code?: string; status?: number; message?: string } | null;
        if (
          conflict?.code === 'aborted' ||
          conflict?.code === 'functions/aborted' ||
          conflict?.status === 409 ||
          conflict?.message === '另一個視窗已更新這筆紀錄，已為你重新整理。'
        )
          setRetry((v) => v + 1);
      }
      return false;
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function searchAdvisors() {
    const keyword = advisorKeyword.trim();
    if (!keyword) {
      setAdvisorSearched(false);
      setAdvisors([]);
      setFieldErrors((previous) => ({
        ...previous,
        teacherUid: '請輸入指導老師姓名、學號或學校信箱。',
      }));
      return;
    }
    if (writing.current) return;
    writing.current = true;
    advisorSearchStarted.current = true;
    setAdvisors([]);
    setAdvisorSearched(false);
    setBusy(true);
    setErrorTarget(pendingTarget.current);
    setError('');
    setNotice('');
    try {
      const reply = await service.execute({ action: 'advisorSearch', keyword, limit: 20 });
      if (active.current) {
        setAdvisors(reply.snapshot?.advisors || []);
        setAdvisorSearched(true);
        setNotice('已更新指導老師名單。');
      }
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : '搜尋未完成，請重試。');
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function submitCreate(rule: InternshipRule | null) {
    const errors: Record<string, string> = {};
    if (!organization.trim()) errors.organization = '請填寫實習機構';
    if (!teacherUid.trim()) errors.teacherUid = '尚未選擇指導老師';
    if (!rule) errors.ruleId = '請先選擇系所規則';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    await run(async () => {
      await service.execute({
        action: 'create',
        id: createId.current,
        ruleId: rule!.id,
        ruleRevision: rule!.revision,
        organization: organization.trim(),
        teacher: teacher.trim(),
        teacherUid: teacherUid.trim(),
      });
      createId.current = newId();
    });
  }
  const execute = (command: Exclude<InternshipCommand, { action: 'list' }>) =>
    run(async () => {
      await service.execute(command);
      // Keep saved document values if the following refresh fails.
      if (active.current && command.action === 'document') {
        setSnapshot(
          (previous) =>
            previous && {
              ...previous,
              records: previous.records.map((record) =>
                record.id === command.id
                  ? {
                      ...record,
                      documents: record.documents.map((document, index) =>
                        index === command.index
                          ? { ...document, url: command.url, submitted: command.submitted }
                          : document,
                      ),
                    }
                  : record,
              ),
            },
        );
      }
    });
  function addRecordCalendar(record: InternshipRecord, index: number) {
    void run(
      () => onAddCalendar(internshipCalendarItem(record, index)),
      '已加入個人行事曆。這是期限快照；請至行事曆查看，不會自動發送推播。',
    );
  }
  if (!uid)
    return (
      <Card>
        <Heading>我的實習</Heading>
        <Body>登入後查看實習學分與文件進度。</Body>
        <Button label="登入查看實習" onPress={onLogin} />
      </Card>
    );
  const studentUI =
    audience === 'student' &&
    !!snapshot &&
    (snapshot.viewerRole !== 'teacher' || snapshot.records.some((r) => r.uid === uid)) &&
    (!snapshot?.records.some((r) => r.teacherUid === uid && r.uid !== uid) ||
      snapshot.records.some((r) => r.uid === uid));
  return (
    <OperationFeedback.Provider
      value={{
        error,
        notice,
        target: errorTarget,
        select: (target) => {
          pendingTarget.current = target;
        },
      }}
    >
      <Box>
        <Heading>
          {audience === 'student'
            ? snapshot?.viewerRole === 'teacher' ||
              snapshot?.records.some((r) => r.teacherUid === uid && r.uid !== uid)
              ? '實習紀錄確認'
              : '我的實習'
            : audience === 'ops'
              ? '實習規則與操作紀錄'
              : '實習紀錄確認'}
        </Heading>
        {studentUI && <Body>實習申請目前在產業實習網，這裡只幫你記進度。</Body>}
        {studentUI && official && <External label="前往校方實習服務入口" url={official.url} />}
        <Body>
          每 1 學分至少 60 小時，依系所公布規則計算；自行登錄不代表已取得學分。每 10 秒更新一次。
        </Body>
        {loadError && <AlertText>{loadError}</AlertText>}
        {notice && errorTarget.startsWith('page:') && <Body>{notice}</Body>}
        <Button
          label={loadError ? '重試讀取實習進度' : '重新整理實習進度'}
          disabled={busy}
          onPress={() => setRetry((v) => v + 1)}
        />
        {!snapshot ? (
          !loadError && <Body>正在讀取實習進度…</Body>
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
                {studentUI && <External label="前往產業實習網申請" url={rule.applicationUrl} />}
                {audience === 'staff' && (
                  <Button
                    label={`編輯${rule.department}規則`}
                    onPress={() => setRuleDraft(JSON.parse(JSON.stringify(rule)) as InternshipRule)}
                  />
                )}
                {studentUI && (
                  <Button
                    label={
                      selectedRuleId === rule.id
                        ? `已選擇${rule.department}規則`
                        : `選擇${rule.department}規則`
                    }
                    disabled={busy}
                    onPress={() => {
                      setSelectedRuleId(rule.id);
                      setFieldErrors((previous) => {
                        const next = { ...previous };
                        delete next.ruleId;
                        return next;
                      });
                    }}
                  />
                )}
              </Card>
            ))}
            {studentUI && (
              <Card>
                <Heading>建立實習紀錄</Heading>
                <Field
                  label="系所規則"
                  value={
                    snapshot.rules.find((rule) => rule.id === selectedRuleId)
                      ? `${snapshot.rules.find((rule) => rule.id === selectedRuleId)!.department} · ${snapshot.rules.find((rule) => rule.id === selectedRuleId)!.term}`
                      : ''
                  }
                  onChange={() => {}}
                />
                {!selectedRuleId && <Body>請先在上方選擇系所規則，再填寫以下資料。</Body>}
                {fieldErrors.ruleId && <AlertText>{fieldErrors.ruleId}</AlertText>}
                <Field label="實習機構" value={organization} onChange={setOrganization} />
                {fieldErrors.organization && <AlertText>{fieldErrors.organization}</AlertText>}
                <Field
                  label="搜尋本校指導老師（姓名、學號或學校信箱）"
                  value={advisorKeyword}
                  onChange={setAdvisorKeyword}
                />
                <Button
                  label="搜尋指導老師"
                  disabled={busy}
                  onPress={() => void searchAdvisors()}
                />
                {!advisorSearched && !advisors.length && (
                  <Body>請輸入姓名、學號或學校信箱搜尋後，從名單選擇指導老師。</Body>
                )}
                {advisorSearched && !advisors.length && (
                  <Body>找不到符合條件的指導老師，請試試姓名、學號或學校信箱。</Body>
                )}
                {!!advisors.length && (
                  <Box>
                    {advisors.map((advisor) => (
                      <Button
                        key={advisor.uid}
                        label={`${advisor.name}｜${advisor.email}${advisor.department ? `｜${advisor.department}` : ''}`}
                        disabled={busy}
                        onPress={() => {
                          setTeacher(advisor.name);
                          setTeacherUid(advisor.uid);
                          setFieldErrors((previous) => {
                            const next = { ...previous };
                            delete next.teacherUid;
                            delete next.teacher;
                            return next;
                          });
                        }}
                      />
                    ))}
                  </Box>
                )}
                <Body>
                  已選擇指導老師：
                  {teacherUid
                    ? advisors.find((advisor) => advisor.uid === teacherUid)?.name ||
                      teacher ||
                      '已選擇'
                    : '尚未選擇'}
                </Body>
                {fieldErrors.teacherUid && <AlertText>{fieldErrors.teacherUid}</AlertText>}
                <Body>填好後，按下方按鈕建立實習紀錄。</Body>
                <Button
                  label="建立實習紀錄"
                  disabled={busy}
                  onPress={() =>
                    void submitCreate(
                      snapshot.rules.find((rule) => rule.id === selectedRuleId) || null,
                    )
                  }
                />
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
              [
                { title: '我的實習', rows: snapshot.records.filter((r) => r.uid === uid) },
                {
                  title: '待我確認',
                  rows: snapshot.records.filter((r) => r.uid !== uid && needsReview(r)),
                },
                {
                  title: '其他實習紀錄',
                  rows: snapshot.records.filter((r) => r.uid !== uid && !needsReview(r)),
                },
              ]
                .filter((section) => section.rows.length)
                .flatMap((section) =>
                  section.rows.map((record, index) => (
                    <React.Fragment key={record.id}>
                      {index === 0 &&
                        (section.title !== '我的實習' ||
                          audience !== 'student' ||
                          snapshot.viewerRole === 'teacher' ||
                          snapshot.records.some((r) => r.uid !== uid)) && (
                          <Heading>{section.title}</Heading>
                        )}
                      <RecordCard
                        key={record.id}
                        record={record}
                        uid={uid}
                        busy={busy}
                        execute={execute}
                        addCalendar={addRecordCalendar}
                      />
                    </React.Fragment>
                  )),
                )}
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
    </OperationFeedback.Provider>
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
  execute: (c: Exclude<InternshipCommand, { action: 'list' }>) => Promise<boolean>;
  addCalendar: (record: InternshipRecord, i: number) => void;
}) {
  const feedback = React.useContext(OperationFeedback);
  const [confirming, setConfirming] = useState(false);
  const p = internshipProgress(r);
  const missing = r.rule.documents.flatMap((d, i) =>
    r.documents[i].verified
      ? []
      : [`${d.title}${r.documents[i].submitted ? '尚未確認' : '尚未繳交'}`],
  );
  if (p.verified < p.required) missing.push(`已確認時數 ${p.verified}／需要 ${p.required} 小時`);
  const owner = uid === r.uid;
  const [entry, setEntry] = useState({ id: newId(), date: '', hours: '', note: '' });
  // Only edited fields override refreshed server values.
  type Draft = { value: string; revision: number };
  const [urlDrafts, setUrlDrafts] = useState<Record<number, Draft>>({});
  const [messageDrafts, setMessageDrafts] = useState<Record<number, Draft>>({});
  const [entryRevision, setEntryRevision] = useState<number | null>(null);
  const draftChanged =
    (entryRevision !== null && entryRevision !== r.revision) ||
    [...Object.values(urlDrafts), ...Object.values(messageDrafts)].some(
      (d) => d.revision !== r.revision,
    );
  const urls = r.documents.map((d, i) => urlDrafts[i]?.value ?? d.url);
  const messages = r.documents.map((d, i) => messageDrafts[i]?.value ?? d.message);
  const clearDraft = (drafts: Record<number, Draft>, index: number) => {
    const next = { ...drafts };
    delete next[index];
    return next;
  };
  const base = { id: r.id, revision: r.revision };
  const recordTarget = feedback.target.startsWith(`${r.id}:`)
    ? feedback.target.slice(r.id.length + 1)
    : '';
  const [action, item, intent] = recordTarget.split(':');
  const document = r.documents[Number(item)];
  const hour = r.hours.find((h) => h.id === item);
  const feedbackControlVisible =
    (action === 'calendar' && !!document && !document.verified) ||
    (!r.confirmed &&
      ((action === 'confirm' && uid === r.teacherUid) ||
        (action === 'hours' && owner) ||
        (action === 'verifyHours' && !owner && !!hour) ||
        (action === 'removeHours' && owner && !!hour && !hour.verified) ||
        (action === 'document' &&
          owner &&
          !!document &&
          !document.verified &&
          (intent !== 'withdraw' || document.submitted)) ||
        (['verifyDocument', 'rejectDocument'].includes(action) &&
          !owner &&
          !!document &&
          document.submitted &&
          !document.verified)));
  return (
    <OperationScope.Provider value={r.id}>
      <Card testID={`internship-${r.id}`}>
        {draftChanged && (
          <Body>這筆實習紀錄已更新，尚未送出的草稿已保留；送出前請先確認最新內容。</Body>
        )}
        {!owner && (
          <Body>
            學生：{r.studentName || '姓名待確認'} · 學號：{r.studentId || '學號未提供'}
          </Body>
        )}
        <Heading>
          {r.organization} · {r.rule.term}
        </Heading>
        <Body>
          指導老師：{r.teacher} · {r.rule.department} · 規則第 {r.rule.revision} 版
        </Body>
        <Body>
          已登錄 {p.logged}／需要 {p.required} 小時 · 指導老師已確認 {p.verified} 小時 ·{' '}
          {r.rule.credits} 學分
        </Body>
        <Progress value={p.percent} />
        <Body>
          {r.confirmed
            ? '已結案。指導老師已確認；學分仍以教務認定為準。'
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
              {new Date(d.deadline).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
              （臺灣時間） ·{' '}
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
                actionId={`calendar:${i}`}
                disabled={busy}
                onPress={() => addCalendar(r, i)}
              />
            )}
            {!r.confirmed &&
              (owner
                ? !r.documents[i].verified && (
                    <>
                      <Field
                        label={`${d.title}文件連結`}
                        value={urls[i]}
                        onChange={(v) => {
                          setUrlDrafts({
                            ...urlDrafts,
                            [i]: { value: v, revision: urlDrafts[i]?.revision ?? r.revision },
                          });
                        }}
                      />
                      <Button
                        label={`登錄已繳交${d.title}`}
                        actionId={`document:${i}:submit`}
                        disabled={busy}
                        onPress={() =>
                          void execute({
                            ...base,
                            action: 'document',
                            index: i,
                            url: urls[i],
                            submitted: true,
                          }).then((saved) => {
                            if (saved) setUrlDrafts((drafts) => clearDraft(drafts, i));
                          })
                        }
                      />
                      {r.documents[i].submitted && (
                        <Button
                          label={`撤回${d.title}繳交登錄`}
                          actionId={`document:${i}:withdraw`}
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
                : r.documents[i].submitted &&
                  !r.documents[i].verified && (
                    <>
                      <Field
                        label={`${d.title}退回原因`}
                        value={messages[i]}
                        onChange={(v) => {
                          setMessageDrafts({
                            ...messageDrafts,
                            [i]: { value: v, revision: messageDrafts[i]?.revision ?? r.revision },
                          });
                        }}
                      />
                      <Button
                        label={`確認${d.title}`}
                        actionId={`verifyDocument:${i}`}
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
                        actionId={`rejectDocument:${i}`}
                        disabled={busy}
                        onPress={() =>
                          void execute({
                            ...base,
                            action: 'verifyDocument',
                            index: i,
                            verified: false,
                            message: messages[i],
                          }).then((saved) => {
                            if (saved) setMessageDrafts((drafts) => clearDraft(drafts, i));
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
                      actionId={`removeHours:${h.id}`}
                      disabled={busy}
                      onPress={() =>
                        void execute({ ...base, action: 'removeHours', entryId: h.id })
                      }
                    />
                    <Button
                      label={`更正${h.date}時數`}
                      actionId={`editHours:${h.id}`}
                      onPress={() => {
                        setEntryRevision((revision) => revision ?? r.revision);
                        setEntry({ ...h, hours: String(h.hours) });
                      }}
                    />
                  </Box>
                )
              ) : (
                <Button
                  label={`${h.verified ? '撤銷確認' : '確認'}${h.date}時數`}
                  actionId={`verifyHours:${h.id}`}
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
                onChange={(v) => {
                  setEntryRevision((revision) => revision ?? r.revision);
                  setEntry({ ...entry, [k]: v });
                }}
              />
            ))}
            <Button
              label="儲存實習時數"
              actionId="hours"
              disabled={busy}
              onPress={() =>
                void execute({
                  ...base,
                  action: 'hours',
                  entry: { ...entry, hours: Number(entry.hours) },
                }).then((saved) => {
                  if (saved) {
                    setEntry({ id: newId(), date: '', hours: '', note: '' });
                    setEntryRevision(null);
                  }
                })
              }
            />
          </Box>
        )}
        {!r.confirmed && uid === r.teacherUid && (
          <>
            {missing.length > 0 && <Body>還不能結案：{missing.join('、')}</Body>}
            {!confirming && (
              <Button
                label="指導老師確認結案"
                actionId="confirm"
                disabled={busy || missing.length > 0}
                onPress={() => setConfirming(true)}
              />
            )}
            {confirming && (
              <Box>
                <Body>確定要為這筆實習結案？結案後就不能再從這裡撤回。</Body>
                <Button
                  label="取消"
                  actionId="cancelConfirm"
                  disabled={busy}
                  onPress={() => setConfirming(false)}
                />
                <Button
                  label="確定結案"
                  actionId="confirm"
                  disabled={busy || missing.length > 0}
                  onPress={() => void execute({ ...base, action: 'confirm' })}
                />
              </Box>
            )}
          </>
        )}
        {recordTarget && !feedbackControlVisible && feedback.error && (
          <AlertText>{feedback.error}</AlertText>
        )}
        {recordTarget && feedback.notice && <Body>{feedback.notice}</Body>}
      </Card>
    </OperationScope.Provider>
  );
}
