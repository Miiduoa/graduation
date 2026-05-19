import React from 'react';
import { View, Alert } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import { checkInLive, endLiveSession } from '../../services/lmsV2WriteTools';
import {
  CourseV2Header,
  CourseV2List,
  CourseV2Card,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseLiveV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from('live_sessions')
      .select('id, title, status, started_at, ended_at, attendance_open_at, attendance_close_at, attendance_late_cutoff_at')
      .eq('course_id', courseId)
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });

  const handleCheckIn = async (sessionId: string) => {
    const r = await checkInLive({ sessionId });
    Alert.alert(r.success ? '簽到成功' : '簽到失敗', r.summary);
    if (r.success) loadable.refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <CourseV2Header title="直播 / 點名" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無直播課堂"
        renderItem={(s: any) => {
          const now = Date.now();
          const close = s.attendance_close_at ? new Date(s.attendance_close_at).getTime() : 0;
          const open = s.attendance_open_at ? new Date(s.attendance_open_at).getTime() : 0;
          const inWindow = open && close && open <= now && now <= close;
          return (
            <CourseV2Card
              title={s.title ?? '直播課堂'}
              subtitle={`${s.started_at ? new Date(s.started_at).toLocaleString() : ''}${inWindow ? ' · 簽到中' : ''}`}
              badge={inWindow ? '簽到' : s.status === 'closed' ? '已結束' : undefined}
              onPress={inWindow ? () => handleCheckIn(String(s.id)) : undefined}
            />
          );
        }}
      />
    </View>
  );
}
