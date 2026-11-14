import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
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
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setProfile(null);
    setError('');
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
  const textStyle = { color: theme.colors.text, lineHeight: 22 };
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
            {profile.memberCount === null ? '社員數未提供' : `${profile.memberCount} 位社員`} ·
            社課時間未提供
          </Text>
          <Button text="已加入" disabled onPress={() => {}} />
          <Text style={textStyle}>
            這是你已加入的社團群組；本頁不代表課外組已核可，也不提供入社或申請。
          </Text>
          <Text style={textStyle}>近期活動</Text>
          <Text style={textStyle}>目前沒有排定的活動。</Text>
          <Text style={textStyle}>
            此頁尚未接入社團內部活動，實際排程請向幹部確認。校園活動與社團內部活動分開管理。
          </Text>
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
          <Text style={textStyle}>{profile.description || '社團尚未提供介紹。'}</Text>
          <Text style={textStyle}>僅供現有社員閱讀。IG、LINE 官方連結尚未提供。</Text>
          {['owner', 'admin'].includes(profile.role) ? (
            <Text style={textStyle}>這所學校還沒開放社團管理。</Text>
          ) : null}
        </>
      )}
      <Button text="重新讀取社團資料" onPress={() => setRevision((v) => v + 1)} />
    </Card>
  );
}
