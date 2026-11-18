import { normalizeClubProfileText } from '@campus/shared/src/clubProfile';
import { ClubPortal } from './ClubPortal';
import { clubSummaryEnabled } from '../services/clubSummary';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text } from 'react-native';
import { Button, Card } from '../ui/components';
import { theme } from '../ui/theme';
import { loadClubProfile } from '../services/clubProfile';

export function ClubProfile({
  uid,
  schoolId,
  groupId,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
}) {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof loadClubProfile>> | null>(null);
  const [revision, setRevision] = useState(0);
  const [manage, setManage] = useState(false);
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setProfile(null);
    setManage(false);
    setError('');
    setLinkError('');
    loadClubProfile(uid, schoolId, groupId).then(
      (result) => {
        if (request === generation.current) setProfile(result);
      },
      () => {
        if (request === generation.current) setError('無法讀取社團資料，請確認資格與連線後重試。');
      },
    );
    return () => {
      generation.current++;
    };
  }, [uid, schoolId, groupId, revision]);
  const meetingTime = normalizeClubProfileText(profile?.meetingTime);
  const description = normalizeClubProfileText(profile?.description);
  const textStyle = { color: theme.colors.text, lineHeight: 22 };
  if (manage && profile && clubSummaryEnabled() && ['owner', 'admin'].includes(profile.role)) {
    return (
      <ClubPortal
        uid={uid}
        schoolId={schoolId}
        groupId={groupId}
        onBack={() => {
          setManage(false);
          setRevision((value) => value + 1);
        }}
      />
    );
  }
  return (
    <Card title="社團" subtitle="生活 › 社團">
      {error ? (
        <Text accessibilityRole="alert">{error}</Text>
      ) : !profile ? (
        <Text style={textStyle}>正在讀取社團資料…</Text>
      ) : (
        <>
          <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}>
            {profile.name}
          </Text>
          <Text style={textStyle}>
            類別未提供 ·{' '}
            {profile.memberCount === null ? '社員數未提供' : `${profile.memberCount} 位社員`} ·{' '}
            {meetingTime || '社課時間未提供'}
          </Text>
          {clubSummaryEnabled() && ['owner', 'admin'].includes(profile.role) && !meetingTime ? (
            <Button text="填寫社課時間" onPress={() => setManage(true)} />
          ) : null}
          <Button text="已加入" disabled />
          <Text style={textStyle}>
            這是你已加入的社團群組；本頁不代表課外組已核可，也不提供入社或申請。
          </Text>
          <Text style={textStyle}>近期活動</Text>
          {!profile.feed ? (
            <>
              <Text accessibilityRole="alert" style={textStyle}>
                活動資料目前讀不到，請稍後再試。
              </Text>
              <Button text="重試活動與官方連結" onPress={() => setRevision((v) => v + 1)} />
            </>
          ) : profile.feed.events.length ? (
            profile.feed.events.map((event) => (
              <React.Fragment key={event.id}>
                <Text style={textStyle}>{event.title}</Text>
                <Text style={textStyle}>
                  {new Date(event.startsAt).toLocaleString('zh-TW')} ～{' '}
                  {new Date(event.endsAt).toLocaleString('zh-TW')}
                </Text>
                {event.location ? <Text style={textStyle}>{event.location}</Text> : null}
              </React.Fragment>
            ))
          ) : (
            <Text style={textStyle}>目前沒有排定的活動。</Text>
          )}
          <Text style={textStyle}>公告</Text>
          {profile.announcements.length ? (
            profile.announcements.map((post) => (
              <React.Fragment key={post.id}>
                <Text style={textStyle}>{post.title}</Text>
                <Text style={textStyle}>{post.body}</Text>
              </React.Fragment>
            ))
          ) : (
            <Text style={textStyle}>近期沒有公告。</Text>
          )}
          <Text style={textStyle}>
            顯示最近 20 則討論中的最新 3 則公告；更多公告請查看下方討論。
          </Text>
          <Text style={textStyle}>介紹</Text>
          <Text style={textStyle}>{description || '社團尚未提供介紹。'}</Text>
          {clubSummaryEnabled() && ['owner', 'admin'].includes(profile.role) && !description ? (
            <Button text="填寫社團介紹" onPress={() => setManage(true)} />
          ) : null}
          <Text style={textStyle}>僅供現有社員閱讀。</Text>
          {!profile.feed ? (
            <Text style={textStyle}>官方連結目前讀不到，請稍後再試。</Text>
          ) : (
            <>
              {profile.feed.instagram ? (
                <Text
                  accessibilityRole="link"
                  style={[
                    textStyle,
                    { color: theme.colors.accent, textDecorationLine: 'underline', minHeight: 44 },
                  ]}
                  onPress={() => {
                    void Linking.openURL(profile.feed!.instagram).catch(() =>
                      setLinkError('無法開啟官方連結，請稍後再試。'),
                    );
                  }}
                >
                  IG
                </Text>
              ) : (
                <Text style={textStyle}>社團尚未提供 IG 官方連結。</Text>
              )}
              {profile.feed.line ? (
                <Text
                  accessibilityRole="link"
                  style={[
                    textStyle,
                    { color: theme.colors.accent, textDecorationLine: 'underline', minHeight: 44 },
                  ]}
                  onPress={() => {
                    void Linking.openURL(profile.feed!.line).catch(() =>
                      setLinkError('無法開啟官方連結，請稍後再試。'),
                    );
                  }}
                >
                  LINE
                </Text>
              ) : (
                <Text style={textStyle}>社團尚未提供 LINE 官方連結。</Text>
              )}
            </>
          )}
          {linkError ? <Text accessibilityRole="alert">{linkError}</Text> : null}
          {!clubSummaryEnabled() && ['owner', 'admin'].includes(profile.role) ? (
            <Text style={textStyle}>這所學校還沒開放社團管理。</Text>
          ) : null}
        </>
      )}
      <Button text="重新讀取社團資料" onPress={() => setRevision((v) => v + 1)} />
    </Card>
  );
}
