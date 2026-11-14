'use client';
import { clubRosterCsv } from '@campus/shared/src/clubExport';
import { ClubCheckIn } from './ClubCheckIn';
import { useEffect, useRef, useState } from 'react';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';
import { clubProfileFields, clubEventFields, clubEventInput } from '@campus/shared/src/clubForms';
import { callClubPortal } from './clubPortalService';
import { leaveMemberGroup } from './groupService';

export function ClubPortal({
  uid,
  schoolId,
  groupId,
  onLeft,
  onChanged,
}: {
  uid: string;
  schoolId: string;
  groupId?: string;
  onLeft?: () => void;
  onChanged?: () => void;
}) {
  const [view, setView] = useState<ClubPortalView | null>(null),
    [selected, setSelected] = useState(groupId || ''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [manage, setManage] = useState(false),
    [office, setOffice] = useState(false),
    [confirmLeave, setConfirmLeave] = useState(false),
    [revision, setRevision] = useState(0);
  const generation = useRef(0),
    lock = useRef(false),
    operation = useRef<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setSelected(groupId || '');
  }, [groupId]);
  useEffect(() => {
    const current = ++generation.current;
    setView(null);
    setBusy(false);
    lock.current = false;
    setError('');
    setManage(false);
    setConfirmLeave(false);
    operation.current = null;
    callClubPortal(
      uid,
      schoolId,
      selected
        ? { action: 'read', groupId: selected }
        : { action: office ? 'office' : 'directory' },
    ).then(
      (data) => {
        if (generation.current === current) setView(data);
      },
      (err) => {
        if (generation.current === current) setError(err.message);
      },
    );
    return () => {
      generation.current++;
    };
  }, [uid, schoolId, selected, office, revision]);
  async function loadMore(kind: 'member' | 'event') {
    if (lock.current || !view) return;
    const cursor = kind === 'member' ? view.memberCursor : view.eventCursor;
    if (!cursor) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    try {
      const next = await callClubPortal(uid, schoolId, {
        action: 'read',
        groupId: selected,
        [`${kind}Cursor`]: cursor,
      });
      if (generation.current === current)
        setView(
          (previous) =>
            previous && {
              ...previous,
              ...(kind === 'member'
                ? {
                    members: [...(previous.members || []), ...(next.members || [])],
                    officialOfficers: [
                      ...(previous.officialOfficers || []),
                      ...(next.officialOfficers || []),
                    ],
                    memberCursor: next.memberCursor,
                  }
                : {
                    events: [...(previous.events || []), ...(next.events || [])],
                    eventCursor: next.eventCursor,
                  }),
            },
        );
    } catch (err) {
      if (generation.current === current)
        setError(err instanceof Error ? err.message : '讀取失敗，請重試');
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function act(input: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const current = generation.current;
    try {
      if (input.action === 'leave')
        await leaveMemberGroup(uid, schoolId, selected, () => generation.current === current);
      else await callClubPortal(uid, schoolId, { ...input, groupId: selected });
      if (generation.current !== current) return;
      operation.current = null;
      if (['join', 'leave', 'review', 'profile'].includes(String(input.action))) onChanged?.();
      if (input.action === 'leave') {
        setNotice('已退出社團');
        setSelected('');
        onLeft?.();
        return;
      }
      setNotice(
        input.action === 'join' && view?.club?.joinPolicy === 'review'
          ? '已送出申請，等幹部回覆'
          : '已由伺服器確認',
      );
      const next = await callClubPortal(uid, schoolId, { action: 'read', groupId: selected });
      if (generation.current === current) {
        setView(next);
        setConfirmLeave(false);
        if (input.action === 'leave') onLeft?.();
      }
    } catch (err) {
      if (generation.current === current)
        setError(err instanceof Error ? err.message : '伺服器尚未確認，請重新整理');
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const club = view?.club,
    officer = ['owner', 'admin'].includes(view?.role || '');
  const button = (label: string, input: Record<string, unknown>, disabled = false) => (
    <button
      className="btn"
      style={{ minHeight: 44 }}
      type="button"
      disabled={busy || disabled}
      onClick={() => void act(input)}
    >
      {label}
    </button>
  );
  function submit(event: React.FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<
      string,
      string
    >;
    if (['createEvent', 'announcement'].includes(action)) operation.current ??= crypto.randomUUID();
    void act({
      ...(action === 'createEvent' ? clubEventInput(values) : values),
      recruiting: values.recruiting === 'on',
      action,
      ...(operation.current ? { operationId: operation.current } : {}),
    });
  }
  return (
    <section aria-label="社團服務" style={{ display: 'grid', gap: 12 }}>
      <button className="btn" disabled={busy} onClick={() => setRevision((n) => n + 1)}>
        重新讀取社團資料
      </button>
      {view?.memberCursor && (
        <button className="btn" disabled={busy} onClick={() => void loadMore('member')}>
          載入更多社員
        </button>
      )}
      {view?.eventCursor && (
        <button className="btn" disabled={busy} onClick={() => void loadMore('event')}>
          載入更多活動
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!view && !error && <p role="status">正在讀取社團資料…</p>}
      {selected && !groupId && (
        <button
          className="btn"
          onClick={() => {
            setSelected('');
            setManage(false);
          }}
        >
          回找社團
        </button>
      )}
      {!selected && view && (
        <>
          {view.office && (
            <button className="btn" onClick={() => setOffice(!office)}>
              {office ? '回學生目錄' : '課外組／平台維運（依本校授權）'}
            </button>
          )}
          <label>
            搜尋學校社團
            <input
              aria-label="搜尋學校社團"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {!view.clubs?.length && <p>學校還沒提供社團名單。</p>}
          {view.clubs
            ?.filter((c) => `${c.name} ${c.category}`.includes(search))
            .sort((a, b) => a.category.localeCompare(b.category))
            .map((c) => (
              <article key={c.id} style={{ minHeight: 64 }}>
                <strong>{c.name}</strong>
                <p>
                  {c.category} · {c.meetingTime} · {c.recruiting ? '招新中' : ''}{' '}
                  {office && c.approval}
                </p>
                <button className="btn" onClick={() => setSelected(c.id)}>
                  查看社團：{c.name}
                </button>
              </article>
            ))}
          {office && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSelected(String(new FormData(e.currentTarget).get('groupId') || ''));
              }}
            >
              <label>
                待核可社團群組 ID
                <input name="groupId" required />
              </label>
              <button className="btn">查閱並核可</button>
            </form>
          )}
          {office && <p>場地借用請到 E 校園申請。經費與評鑑等第以課外組資料為準。</p>}
        </>
      )}
      {club && (
        <>
          <header>
            <h1 style={{ fontSize: 28 }}>{club.name}</h1>
            <p>
              {club.category} · {club.memberCount ?? '未提供'} 位社員 · {club.meetingTime}
            </p>
            {club.approval === 'approved' && <span>本校社團（課外組核可）</span>}
            {officer && (
              <button className="btn" onClick={() => setManage(!manage)}>
                管理
              </button>
            )}
          </header>
          {view.status === 'active' ? (
            <>
              <button className="btn" style={{ minHeight: 44 }} disabled>
                已加入
              </button>
              <details>
                <summary>⋯ 社團選單</summary>
                <button className="btn" onClick={() => setConfirmLeave(true)}>
                  退出社團
                </button>
                {confirmLeave && (
                  <>
                    {button('確認退出社團', { action: 'leave' })}
                    <button className="btn" onClick={() => setConfirmLeave(false)}>
                      取消
                    </button>
                  </>
                )}
              </details>
            </>
          ) : view.status === 'pending' ? (
            <p role="status">已送出申請，等幹部回覆</p>
          ) : (
            <>
              {view.status === 'declined' && <p>申請未通過：{view.reason || '請聯絡幹部'}</p>}
              {club.approval === 'approved' ? (
                button(club.joinPolicy === 'review' ? '申請加入' : '加入', { action: 'join' })
              ) : (
                <p>未經課外組核可；可使用原有邀請碼加入。</p>
              )}
            </>
          )}
          <section>
            <h2>近期活動</h2>
            {!view.events?.length && <p>目前沒有排定的活動。</p>}
            {view.events
              ?.filter((e) => manage || e.endsAt >= clock)
              .slice(0, manage ? undefined : 3)
              .map((e) => (
                <article key={e.id}>
                  <h3>{e.title}</h3>
                  <p>
                    {new Date(e.startsAt).toLocaleString('zh-TW')} · {e.location}
                  </p>
                  <p>
                    報名 {e.registered}／{e.capacity} · 簽到 {e.checkedIn}
                  </p>
                  <p>
                    {e.myCheckIn
                      ? '已簽到'
                      : e.mine
                        ? '已報名'
                        : e.registered >= e.capacity
                          ? '名額已滿'
                          : ''}
                  </p>
                  {button(
                    e.mine ? '取消報名' : e.registered >= e.capacity ? '名額已滿' : '報名',
                    { action: e.mine ? 'cancel' : 'register', eventId: e.id },
                    e.myCheckIn ||
                      clock >= (e.mine ? e.cancellationDeadline : e.registrationDeadline) ||
                      (!e.mine && e.registered >= e.capacity),
                  )}
                  {e.mine && clock >= e.cancellationDeadline && <p>已過取消時間，請聯絡幹部</p>}
                  {clock >= e.startsAt && clock <= e.endsAt && (
                    <ClubCheckIn
                      key={`${uid}:${schoolId}:${selected}:${e.id}`}
                      uid={uid}
                      schoolId={schoolId}
                      groupId={selected}
                      eventId={e.id}
                      myCode={e.myCheckInCode}
                      suffix={e.studentSuffix}
                      officer={officer && manage}
                      onConfirmed={() => void act({ action: 'read' })}
                    />
                  )}
                  {manage && (
                    <details>
                      <summary>現場加入名單</summary>
                      {view.members
                        ?.filter((m) => !e.registrations?.some((r) => r.uid === m.id))
                        .map((m) => (
                          <p key={m.id}>
                            {m.name} · 這位不在報名名單{' '}
                            {button(
                              '仍然簽到',
                              {
                                action: 'checkIn',
                                eventId: e.id,
                                targetUid: m.id,
                                allowWalkIn: true,
                              },
                              clock < e.startsAt || clock > e.endsAt,
                            )}
                          </p>
                        ))}
                    </details>
                  )}
                  {manage && (
                    <ul>
                      {e.registrations?.map((r) => (
                        <li key={r.uid}>
                          {r.name} ·{' '}
                          {r.checkedInAt
                            ? `已簽到 ${new Date(r.checkedInAt).toLocaleTimeString('zh-TW')}`
                            : button(
                                '確認簽到',
                                { action: 'checkIn', eventId: e.id, targetUid: r.uid },
                                clock < e.startsAt || clock > e.endsAt,
                              )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
          </section>
          <a
            href={`/groups/${encodeURIComponent(selected)}?schoolId=${encodeURIComponent(schoolId)}`}
          >
            查看社團討論與更多公告
          </a>
          <section>
            <h2>公告</h2>
            {view.announcements?.length ? (
              view.announcements.map((p) => (
                <article key={p.id}>
                  <h3>{p.title}</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p>
                </article>
              ))
            ) : (
              <p>{view.status === 'active' ? '近期沒有公告。' : '加入後可閱讀內部公告。'}</p>
            )}
          </section>
          <section>
            <h2>介紹</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{club.description || '社團尚未提供介紹。'}</p>
            {club.instagram && (
              <a href={club.instagram} target="_blank" rel="noopener noreferrer">
                IG ↗ 外部連結
              </a>
            )}
            {club.line && (
              <a href={club.line} target="_blank" rel="noopener noreferrer">
                LINE ↗ 外部連結
              </a>
            )}
          </section>
          {manage && officer && (
            <section aria-label="幹部管理">
              <h2>社員與申請</h2>
              {view.requests?.map((r) => (
                <form
                  key={r.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act({
                      action: 'review',
                      targetUid: r.id,
                      decision: 'declined',
                      reason: new FormData(e.currentTarget).get('reason'),
                    });
                  }}
                >
                  <p>{r.name}</p>
                  {button('通過', { action: 'review', targetUid: r.id, decision: 'approved' })}
                  <input
                    aria-label={`不通過理由：${r.name}`}
                    name="reason"
                    placeholder="不通過理由（選填）"
                    maxLength={200}
                  />
                  <button className="btn" disabled={busy}>
                    不通過
                  </button>
                </form>
              ))}
              {!view.requests?.length && <p>目前沒有待審申請。</p>}
              {view.members?.map((m) => (
                <article key={m.id} style={{ minHeight: 56 }}>
                  <p>
                    {m.name} · {m.role} · 電話 {m.phone || '未提供'}
                  </p>
                  {button(m.duesPaid ? '社費已繳' : '社費未繳', {
                    action: 'dues',
                    targetUid: m.id,
                    duesPaid: !m.duesPaid,
                  })}
                </article>
              ))}
              <form onSubmit={(e) => submit(e, 'profile')}>
                <h2>編輯社團介紹</h2>
                {clubProfileFields.map(([key, label]) => (
                  <label key={key} style={{ display: 'block' }}>
                    {label}
                    <input
                      name={key}
                      defaultValue={club[key === 'meetingTime' ? 'meetingTime' : key]}
                      maxLength={key === 'description' ? 2000 : 500}
                    />
                  </label>
                ))}
                <label>
                  入社方式
                  <select name="joinPolicy" defaultValue={club.joinPolicy}>
                    <option value="open">開放入社</option>
                    <option value="review">需幹部審核</option>
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="recruiting" defaultChecked={club.recruiting} />
                  招新中
                </label>
                <button className="btn" disabled={busy}>
                  儲存社團資料
                </button>
              </form>
              <form onSubmit={(e) => submit(e, 'announcement')}>
                <h2>發布公告</h2>
                <input aria-label="公告標題" name="title" required maxLength={120} />
                <textarea aria-label="公告內容" name="body" required maxLength={10000} />
                <button className="btn" disabled={busy}>
                  發布公告
                </button>
              </form>
              <form onSubmit={(e) => submit(e, 'createEvent')}>
                <h2>新增活動</h2>
                {clubEventFields.map(([key, label]) => (
                  <label key={key} style={{ display: 'block' }}>
                    {label}
                    <input
                      name={key}
                      required
                      type={
                        key === 'capacity'
                          ? 'number'
                          : /At$|Deadline$/.test(key)
                            ? 'datetime-local'
                            : 'text'
                      }
                    />
                  </label>
                ))}
                <select aria-label="活動對象" name="visibility">
                  <option value="members">只限社員</option>
                  <option value="public">公開給本校學生</option>
                </select>
                <p>這是社團內部活動；不會自動發布到校園活動。</p>
                <button className="btn" disabled={busy}>
                  建立活動
                </button>
              </form>
            </section>
          )}
          {(officer || view.office) && (
            <button
              className="btn"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([clubRosterCsv(view)], { type: 'text/csv;charset=utf-8' }),
                );
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `${club.name}-名冊與活動.csv`;
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              匯出已載入的名冊與活動 CSV
            </button>
          )}
          {view.officialOfficers?.map((m) => (
            <p key={`official-${m.id}`}>
              {view.members?.find((r) => r.id === m.id)?.name} ·{' '}
              {m.role === 'owner' ? '社長' : '幹部'} ·{' '}
              {m.status === 'confirmed' ? '課外組已確認' : '待課外組確認'}{' '}
              {view.office &&
                m.status === 'pending' &&
                button('確認官方幹部', { action: 'confirmOfficer', targetUid: m.id, role: m.role })}
            </p>
          ))}
          {view.office && (
            <form onSubmit={(e) => submit(e, 'official')}>
              <h2>課外組核可</h2>
              <label>
                學校類別
                <input name="category" defaultValue={club.category} required maxLength={80} />
              </label>
              <select
                name="status"
                defaultValue={club.approval === 'suspended' ? 'suspended' : 'approved'}
              >
                <option value="approved">核可</option>
                <option value="suspended">停權</option>
              </select>
              <button className="btn" disabled={busy}>
                確認官方資料
              </button>
              <p>平台維運須持有本校授權；不提供跨校覆寫。</p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
