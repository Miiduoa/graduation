import { shareClubCsv } from '../services/clubExport';
import { ClubCheckIn } from './ClubCheckIn';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { Button, Card } from '../ui/components';
import { theme } from '../ui/theme';
import { callClubPortal } from '../services/clubPortal';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';
import {
  clubProfileFields,
  clubEventFields,
  clubEventInput,
} from '../../../../packages/shared/src/clubForms';

export function ClubPortal({
  uid,
  schoolId,
  groupId,
  onChanged,
}: {
  uid: string;
  schoolId: string;
  groupId?: string;
  onChanged?: () => void;
}) {
  const [view, setView] = useState<ClubPortalView | null>(null),
    [selected, setSelected] = useState(groupId || ''),
    [office, setOffice] = useState(false),
    [manage, setManage] = useState(false),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [confirmLeave, setConfirmLeave] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({}),
    [clock, setClock] = useState(Date.now());
  const generation = useRef(0),
    lock = useRef(false),
    operation = useRef<string | null>(null);
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
    setValues({});
    operation.current = null;
    callClubPortal(
      uid,
      schoolId,
      selected
        ? { action: 'read', groupId: selected }
        : { action: office ? 'office' : 'directory' },
    ).then(
      (data) => {
        if (generation.current === current) {
          setView(data);
          if (data.club)
            setValues({
              ...Object.fromEntries(
                clubProfileFields.map(([key]) => [key, String(data.club?.[key] || '')]),
              ),
              joinPolicy: data.club.joinPolicy,
              recruiting: String(data.club.recruiting),
            });
        }
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
      await callClubPortal(uid, schoolId, { ...input, groupId: selected });
      if (generation.current !== current) return;
      operation.current = null;
      if (['join', 'leave', 'review', 'profile'].includes(String(input.action))) onChanged?.();
      if (input.action === 'leave') {
        setNotice('已退出社團');
        setSelected('');
        return;
      }
      const next = await callClubPortal(uid, schoolId, { action: 'read', groupId: selected });
      if (generation.current === current) {
        setView(next);
        setConfirmLeave(false);
        setNotice(next.status === 'pending' ? '已送出申請，等幹部回覆' : '已由伺服器確認');
      }
    } catch (err) {
      if (generation.current === current)
        setError(err instanceof Error ? err.message : '伺服器尚未確認，請重試');
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const style = { color: theme.colors.text, lineHeight: 22 },
    club = view?.club,
    officer = ['owner', 'admin'].includes(view?.role || '');
  const button = (label: string, input: Record<string, unknown>, disabled = false) => (
    <Button text={label} disabled={busy || disabled} onPress={() => void act(input)} />
  );
  const field = (key: string, label: string, fallback = '') => (
    <View key={key}>
      <Text style={style}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={values[key] ?? fallback}
        onChangeText={(value) => setValues((v) => ({ ...v, [key]: value }))}
        style={{
          color: theme.colors.text,
          borderColor: theme.colors.border,
          borderWidth: 1,
          padding: 12,
          minHeight: 44,
        }}
      />
    </View>
  );
  const create = (action: string) => {
    operation.current ??= `club-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    void act({
      ...(action === 'createEvent'
        ? clubEventInput(values)
        : { title: values.announcementTitle, body: values.announcementBody }),
      action,
      operationId: operation.current,
    });
  };
  return (
    <Card title="社團服務" subtitle="生活 › 社團">
      {view?.memberCursor ? (
        <Button text="載入更多社員" disabled={busy} onPress={() => void loadMore('member')} />
      ) : null}
      {view?.eventCursor ? (
        <Button text="載入更多活動" disabled={busy} onPress={() => void loadMore('event')} />
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
      {!view && !error ? <Text style={style}>正在讀取社團資料…</Text> : null}
      <Button text="重新讀取社團資料" disabled={busy} onPress={() => setRevision((n) => n + 1)} />
      {selected && !groupId ? (
        <Button text="回找社團" disabled={busy} onPress={() => setSelected('')} />
      ) : null}
      {!selected && view ? (
        <>
          {view.office ? (
            <Button
              text={office ? '回學生目錄' : '課外組／平台維運（依本校授權）'}
              onPress={() => setOffice(!office)}
            />
          ) : null}
          <TextInput
            accessibilityLabel="搜尋學校社團"
            placeholder="搜尋名稱或類別"
            value={search}
            onChangeText={setSearch}
            style={style}
          />
          {!view.clubs?.length ? <Text style={style}>學校還沒提供社團名單。</Text> : null}
          {view.clubs
            ?.filter((c) => `${c.name} ${c.category}`.includes(search))
            .sort((a, b) => a.category.localeCompare(b.category))
            .map((c) => (
              <View key={c.id} style={{ minHeight: 64, paddingVertical: 8 }}>
                <Text style={style}>
                  {c.name} · {c.category} · {c.meetingTime} · {c.recruiting ? '招新中' : ''}
                  {office ? ` · ${c.approval}` : ''}
                </Text>
                <Button text={`查看社團：${c.name}`} onPress={() => setSelected(c.id)} />
              </View>
            ))}
          {office ? (
            <>
              {field('groupId', '待核可社團群組 ID')}
              <Button text="查閱並核可" onPress={() => setSelected(values.groupId || '')} />
              <Text style={style}>場地借用請到 E 校園申請。經費與評鑑等第以課外組資料為準。</Text>
            </>
          ) : null}
        </>
      ) : null}
      {club ? (
        <>
          <Text style={{ ...style, fontSize: 28, lineHeight: 34, fontWeight: '700' }}>
            {club.name}
          </Text>
          <Text style={style}>
            {club.category} · {club.memberCount ?? '未提供'} 位社員 · {club.meetingTime}
          </Text>
          {club.approval === 'approved' ? <Text style={style}>本校社團（課外組核可）</Text> : null}
          {officer ? <Button text="管理" onPress={() => setManage(!manage)} /> : null}
          {view.status === 'active' ? (
            <>
              <Button text="已加入" disabled />
              <Button text="⋯ 退出社團" onPress={() => setConfirmLeave(true)} />
              {confirmLeave ? (
                <>
                  {button('確認退出社團', { action: 'leave' })}
                  <Button text="取消" onPress={() => setConfirmLeave(false)} />
                </>
              ) : null}
            </>
          ) : view.status === 'pending' ? (
            <Text style={style}>已送出申請，等幹部回覆</Text>
          ) : (
            <>
              {view.status === 'declined' ? (
                <Text style={style}>申請未通過：{view.reason || '請聯絡幹部'}</Text>
              ) : null}
              {club.approval === 'approved' ? (
                button(club.joinPolicy === 'review' ? '申請加入' : '加入', { action: 'join' })
              ) : (
                <Text style={style}>未經課外組核可；可使用原有邀請碼加入。</Text>
              )}
            </>
          )}
          <Text style={style}>近期活動</Text>
          {!view.events?.length ? <Text style={style}>目前沒有排定的活動。</Text> : null}
          {view.events
            ?.filter((e) => manage || e.endsAt >= clock)
            .slice(0, manage ? undefined : 3)
            .map((e) => (
              <View key={e.id} style={{ gap: 8 }}>
                <Text style={style}>
                  {e.title} · {new Date(e.startsAt).toLocaleString('zh-TW')} · {e.location}
                </Text>
                <Text style={style}>
                  報名 {e.registered}／{e.capacity} · 簽到 {e.checkedIn} ·{' '}
                  {e.myCheckIn ? '已簽到' : e.mine ? '已報名' : ''}
                </Text>
                {button(
                  e.mine ? '取消報名' : e.registered >= e.capacity ? '名額已滿' : '報名',
                  { action: e.mine ? 'cancel' : 'register', eventId: e.id },
                  e.myCheckIn ||
                    clock >= (e.mine ? e.cancellationDeadline : e.registrationDeadline) ||
                    (!e.mine && e.registered >= e.capacity),
                )}
                {e.mine && clock >= e.cancellationDeadline ? (
                  <Text style={style}>已過取消時間，請聯絡幹部</Text>
                ) : null}
                {clock >= e.startsAt && clock <= e.endsAt ? (
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
                ) : null}
                {manage
                  ? view.members
                      ?.filter((m) => !e.registrations?.some((r) => r.uid === m.id))
                      .map((m) => (
                        <View key={`onsite-${m.id}`}>
                          <Text style={style}>{m.name} · 這位不在報名名單</Text>
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
                        </View>
                      ))
                  : null}
                {manage
                  ? e.registrations?.map((r) => (
                      <View key={r.uid}>
                        <Text style={style}>{r.name}</Text>
                        {r.checkedInAt ? (
                          <Text style={style}>
                            已簽到 {new Date(r.checkedInAt).toLocaleTimeString('zh-TW')}
                          </Text>
                        ) : (
                          button(
                            '確認簽到',
                            { action: 'checkIn', eventId: e.id, targetUid: r.uid },
                            clock < e.startsAt || clock > e.endsAt,
                          )
                        )}
                      </View>
                    ))
                  : null}
              </View>
            ))}
          <Text style={style}>公告</Text>
          {view.announcements?.length ? (
            view.announcements.map((p) => (
              <View key={p.id}>
                <Text style={style}>{p.title}</Text>
                <Text style={style}>{p.body}</Text>
              </View>
            ))
          ) : (
            <Text style={style}>
              {view.status === 'active' ? '近期沒有公告。' : '加入後可閱讀內部公告。'}
            </Text>
          )}
          <Text style={style}>介紹</Text>
          <Text style={style}>{club.description || '社團尚未提供介紹。'}</Text>
          {club.instagram ? (
            <Button
              text="IG ↗ 外部連結"
              onPress={() => {
                void Linking.openURL(club.instagram);
              }}
            />
          ) : null}
          {club.line ? (
            <Button
              text="LINE ↗ 外部連結"
              onPress={() => {
                void Linking.openURL(club.line);
              }}
            />
          ) : null}
          {manage && officer ? (
            <>
              <Text style={style}>社員與申請</Text>
              {!view.requests?.length ? <Text style={style}>目前沒有待審申請。</Text> : null}
              {view.requests?.map((r) => (
                <View key={r.id}>
                  <Text style={style}>{r.name}</Text>
                  {button('通過', { action: 'review', targetUid: r.id, decision: 'approved' })}
                  {field(`reason-${r.id}`, `不通過理由：${r.name}`)}
                  {button('不通過', {
                    action: 'review',
                    targetUid: r.id,
                    decision: 'declined',
                    reason: values[`reason-${r.id}`] || '',
                  })}
                </View>
              ))}
              {view.members?.map((m) => (
                <View key={m.id} style={{ minHeight: 56 }}>
                  <Text style={style}>
                    {m.name} · {m.role} · 電話 {m.phone || '未提供'}
                  </Text>
                  {button(m.duesPaid ? '社費已繳' : '社費未繳', {
                    action: 'dues',
                    targetUid: m.id,
                    duesPaid: !m.duesPaid,
                  })}
                </View>
              ))}
              <Text style={style}>編輯社團介紹</Text>
              {clubProfileFields.map(([key, label]) => field(key, label))}
              <Button
                text={
                  values.joinPolicy === 'review' ? '入社方式：需幹部審核' : '入社方式：開放入社'
                }
                onPress={() =>
                  setValues((v) => ({
                    ...v,
                    joinPolicy: v.joinPolicy === 'review' ? 'open' : 'review',
                  }))
                }
              />
              <Button
                text={values.recruiting === 'true' ? '招新中' : '未招新'}
                onPress={() =>
                  setValues((v) => ({ ...v, recruiting: String(v.recruiting !== 'true') }))
                }
              />
              {button('儲存社團資料', {
                ...values,
                action: 'profile',
                recruiting: values.recruiting === 'true',
              })}
              <Text style={style}>發布公告</Text>
              {field('announcementTitle', '公告標題')}
              {field('announcementBody', '公告內容')}
              <Button text="發布公告" disabled={busy} onPress={() => create('announcement')} />
              <Text style={style}>新增活動</Text>
              <Text style={style}>
                時間請填 YYYY-MM-DDTHH:mm，例如 2026-12-01T18:00（本機時區）。
              </Text>
              {clubEventFields.map(([key, label]) => field(key, label))}
              <Button
                text={
                  values.visibility === 'public' ? '活動對象：公開給本校學生' : '活動對象：只限社員'
                }
                onPress={() =>
                  setValues((v) => ({
                    ...v,
                    visibility: v.visibility === 'public' ? 'members' : 'public',
                  }))
                }
              />
              <Text style={style}>這是社團內部活動；不會自動發布到校園活動。</Text>
              <Button
                text="建立活動"
                disabled={busy}
                onPress={() => {
                  if (!values.visibility) {
                    void act({
                      ...clubEventInput(values),
                      visibility: 'members',
                      action: 'createEvent',
                      operationId:
                        operation.current ??
                        (operation.current = `club-${Date.now()}-${Math.random().toString(36).slice(2)}`),
                    });
                  } else create('createEvent');
                }}
              />
            </>
          ) : null}
          {officer || view.office ? (
            <Button
              text="匯出已載入的名冊與活動 CSV（分享）"
              onPress={() => {
                void shareClubCsv(view).catch(() => setError('無法開啟分享，請重試'));
              }}
            />
          ) : null}
          {view.officialOfficers?.map((m) => (
            <View key={`official-${m.id}`}>
              <Text style={style}>
                {view.members?.find((r) => r.id === m.id)?.name} ·{' '}
                {m.role === 'owner' ? '社長' : '幹部'} ·{' '}
                {m.status === 'confirmed' ? '課外組已確認' : '待課外組確認'}
              </Text>
              {view.office && m.status === 'pending'
                ? button('確認官方幹部', {
                    action: 'confirmOfficer',
                    targetUid: m.id,
                    role: m.role,
                  })
                : null}
            </View>
          ))}
          {view.office ? (
            <>
              <Text style={style}>課外組核可</Text>
              {field('category', '學校類別', club.category)}
              {button('核可', {
                action: 'official',
                category: values.category || club.category,
                status: 'approved',
              })}
              {button('停權', {
                action: 'official',
                category: values.category || club.category,
                status: 'suspended',
              })}
              <Text style={style}>平台維運須持有本校授權；不提供跨校覆寫。</Text>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
