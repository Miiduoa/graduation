import React from 'react';
import { theme } from '../../ui/theme';
import { useThemeMode } from '../../state/theme';
import { View, Linking, Alert } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import { resolveLmsMaterialUrl } from '../../services/lmsV2MaterialAccess';
import {
  CourseV2Header,
  CourseV2List,
  CourseV2Card,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseMaterialsV2Screen() {
  useThemeMode();
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) throw new Error('LMS 服務尚未連線，請確認設定後重試。');
    if (!courseId) throw new Error('缺少課程資訊，請返回課程重新選擇。');
    const { data, error } = await sb
      .from('course_materials')
      .select('id, title, storage_path, external_url, mime_type, description_html, publish_at, is_published, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

  const openMaterial = async (material: {
    external_url?: string | null;
    storage_path?: string | null;
  }) => {
    const sb = getSupabaseClient();
    if (!sb) {
      Alert.alert('尚未開啟', 'LMS 服務尚未連線，請重新登入後重試。');
      return;
    }
    try {
      const url = await resolveLmsMaterialUrl(material, String(courseId), (path, expires) =>
        sb.storage.from('materials').createSignedUrl(path, expires),
      );
      await Linking.openURL(url);
    } catch {
      Alert.alert('無法開啟教材', '教材檔案無法存取或連結已失效，請更新課程後重試。');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header title="教材" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無教材"
        renderItem={(m: any) => (
          <CourseV2Card
            title={m.title}
            subtitle={m.storage_path ? '課程檔案' : m.external_url ? '線上教材' : '尚未提供檔案'}
            badge={!m.is_published ? '尚未發布' : undefined}
            onPress={m.external_url || m.storage_path
              ? () => void openMaterial(m)
              : undefined}
          />
        )}
      />
    </View>
  );
}
