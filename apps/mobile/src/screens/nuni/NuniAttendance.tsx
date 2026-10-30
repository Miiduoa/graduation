import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import {
  type createNuniClassroom,
  type NuniClassroomSession,
  type NuniWorkspaceMember,
} from '@campus/shared/src/nuniClassroom';
import { courseRoleLabels } from '@campus/shared/src/nuniCourseTasks';
import { useTheme } from '../../state/theme';

type Classroom = ReturnType<typeof createNuniClassroom>;
type Roster = Awaited<ReturnType<Classroom['roster']>>;
type Props = {
  classroom: Classroom;
  course: NuniWorkspace;
  mode: 'attendance' | 'members';
  onAccessDenied(): void;
};

const attendanceLabels = { present: '出席', absent: '缺席', late: '遲到' };

function accessDenied(error: unknown): boolean {
  return (
    error instanceof NuniError &&
    ([401, 403, 404].includes(error.status) || error.code === 'SESSION_CHANGED')
  );
}

function Action({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 14,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function NuniAttendance(props: Props) {
  if (props.mode === 'members' && props.course.memberRole === 'student') return null;
  return (
    <AttendanceScope
      key={`${props.course.id}:${props.course.memberRole}:${props.course.state}:${props.mode}`}
      {...props}
    />
  );
}

function AttendanceScope({ classroom, course, mode, onAccessDenied }: Props) {
  const theme = useTheme();
  const [sessions, setSessions] = useState<NuniClassroomSession[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [members, setMembers] = useState<NuniWorkspaceMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const mounted = useRef(false);
  const blocked = useRef(false);
  const generation = useRef(0);
  const mutating = useRef(false);
  const deniedCallback = useRef(onAccessDenied);
  deniedCallback.current = onAccessDenied;
  const teacher = course.memberRole !== 'student';
  const current = useCallback(
    (run: number) => mounted.current && !blocked.current && generation.current === run,
    [],
  );
  const deny = useCallback(() => {
    blocked.current = true;
    ++generation.current;
    setSessions([]);
    setRoster(null);
    setMembers(null);
    setCode('');
    setNotice('');
    setLoading(false);
    setBusy(false);
    setError('目前無法存取這門課程，請更新內容後確認權限。');
    deniedCallback.current();
  }, []);

  const reload = useCallback(
    async (confirmationId?: string): Promise<void> => {
      const run = ++generation.current;
      setLoading(true);
      setError('');
      setNotice('');
      setSessions([]);
      setRoster(null);
      setMembers(null);
      try {
        if (mode === 'members') {
          const next = await classroom.members(course.id);
          if (current(run)) setMembers(next);
        } else {
          const next = await classroom.sessions(course.id);
          if (!current(run)) return;
          setSessions(next);
          if (confirmationId) {
            setPendingConfirmation(null);
            setNotice(
              next.some((session) => session.id === confirmationId && session.checkedInByMe)
                ? '簽到完成。'
                : '尚未查到簽到紀錄，請確認簽到碼後重試。',
            );
          }
          const review =
            next.find((session) => session.state === 'open') ??
            next.find((session) => session.state === 'closed');
          if (teacher && review) {
            const nextRoster = await classroom.roster(course.id, review.id);
            if (current(run)) setRoster(nextRoster);
          }
        }
      } catch (failure) {
        if (!current(run)) return;
        if (accessDenied(failure)) deny();
        else
          setError(
            confirmationId
              ? '簽到已送出，但目前無法確認結果。請更新簽到狀態。'
              : mode === 'members'
                ? '目前讀不到名冊，請重試。'
                : '目前讀不到點名資料，請重試。',
          );
      } finally {
        if (current(run)) setLoading(false);
      }
    },
    [classroom, course.id, current, deny, mode, teacher],
  );

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, [reload]);

  const live = sessions.find((session) => session.state === 'open');
  const review = live ?? sessions.find((session) => session.state === 'closed');
  async function checkIn() {
    if (
      !live ||
      teacher ||
      course.state !== 'active' ||
      loading ||
      mutating.current ||
      pendingConfirmation ||
      blocked.current
    )
      return;
    const run = generation.current;
    mutating.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await classroom.checkIn(course.id, live.id, code.trim() || undefined);
      if (!current(run)) return;
      setCode('');
      setPendingConfirmation(live.id);
      await reload(live.id);
    } catch (failure) {
      if (!current(run)) return;
      if (accessDenied(failure)) deny();
      else if (!(failure instanceof NuniError) || failure.status === 0 || failure.status >= 500) {
        setPendingConfirmation(live.id);
        setError('尚未確認簽到結果，請更新簽到狀態。');
      } else
        setError(
          failure instanceof NuniError && [400, 422].includes(failure.status)
            ? '簽到未完成，請確認老師提供的簽到碼。'
            : failure instanceof NuniError && failure.status === 409
              ? '課堂狀態已變更，請更新簽到狀態。'
              : '簽到未完成，請確認網路後重試。',
        );
    } finally {
      if (mounted.current && !blocked.current) {
        mutating.current = false;
        setBusy(false);
      }
    }
  }

  const textStyle = { color: theme.colors.text, fontSize: 15, lineHeight: 24 };
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 20, fontWeight: '600' }}>
        {mode === 'members' ? '課程名冊' : '課堂點名'}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ ...textStyle, color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={textStyle}>
          {notice}
        </Text>
      ) : null}
      {!blocked.current ? (
        <>
          <Action
            label={mode === 'members' ? '更新名冊' : '更新簽到狀態'}
            disabled={loading || busy}
            onPress={() => void reload(pendingConfirmation ?? undefined)}
          />
          {loading ? (
            <Text style={textStyle}>正在讀取{mode === 'members' ? '名冊' : '點名資料'}…</Text>
          ) : null}
          {mode === 'members' && members ? (
            members.length === 0 ? (
              <Text style={textStyle}>這門課程目前沒有成員。</Text>
            ) : (
              members.map((member) => (
                <View key={member.platformAccountId} style={{ gap: 2 }}>
                  <Text style={textStyle}>{member.displayName}</Text>
                  <Text style={{ ...textStyle, color: theme.colors.muted }}>
                    {courseRoleLabels[member.memberRole]}
                  </Text>
                </View>
              ))
            )
          ) : null}
          {mode === 'attendance' && !loading ? (
            <>
              {review ? (
                <>
                  <Text style={textStyle}>
                    {review.state === 'open' ? '進行中' : '最近一堂已結束'}：{review.title}
                  </Text>
                  {teacher && review.checkInCount !== undefined ? (
                    <Text style={textStyle}>已簽到 {review.checkInCount} 人</Text>
                  ) : null}
                  {teacher && live?.shortCode ? (
                    <Text accessibilityLabel={`課堂短碼 ${live.shortCode}`} style={textStyle}>
                      課堂短碼：{live.shortCode}
                    </Text>
                  ) : null}
                  {!teacher && review.checkedInByMe ? <Text style={textStyle}>已簽到</Text> : null}
                  {!teacher && review.state === 'closed' && !review.checkedInByMe ? (
                    <Text style={textStyle}>這堂課沒有你的簽到紀錄。</Text>
                  ) : null}
                  {!teacher && live && !live.checkedInByMe && course.state === 'active' ? (
                    <>
                      <Text style={textStyle}>簽到碼（若老師有提供）</Text>
                      <TextInput
                        accessibilityLabel="簽到碼（若老師有提供）"
                        value={code}
                        onChangeText={setCode}
                        maxLength={6}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        editable={!busy && !pendingConfirmation}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          borderRadius: 10,
                          padding: 14,
                          color: theme.colors.text,
                          fontSize: 16,
                        }}
                      />
                      <Action
                        label={busy ? '正在確認簽到…' : '簽到'}
                        disabled={busy || !!pendingConfirmation}
                        onPress={() => void checkIn()}
                      />
                    </>
                  ) : null}
                  {teacher && roster
                    ? (Object.keys(attendanceLabels) as Array<keyof Roster>).map((group) => (
                        <View key={group} style={{ gap: 6 }}>
                          <Text accessibilityRole="header" style={textStyle}>
                            {attendanceLabels[group]} {roster[group].length}
                          </Text>
                          {roster[group].map((person) => (
                            <Text key={person.platformAccountId} style={textStyle}>
                              {person.displayName}
                              {person.punctuality === 'makeup' ? ' · 補簽' : ''}
                              {person.makeupRequestState === 'pending' ? ' · 待補簽' : ''}
                            </Text>
                          ))}
                        </View>
                      ))
                    : null}
                </>
              ) : !error ? (
                <Text style={textStyle}>目前沒有課堂點名紀錄。</Text>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
