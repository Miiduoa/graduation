/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useMemo } from 'react';
import { ScrollView, Text, View, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Paths, File } from 'expo-file-system';

import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { exportUserData } from '../services/privacy';
import { formatDateTime } from '../utils/format';

type ExportCategory = {
  id: string;
  name: string;
  description: string;
  icon: string;
  selected: boolean;
};

const EXPORT_CATEGORIES: ExportCategory[] = [
  {
    id: 'profile',
    name: '個人資料',
    description: '姓名、學號、系所、自我介紹',
    icon: 'person-outline',
    selected: true,
  },
  {
    id: 'favorites',
    name: '收藏項目',
    description: '收藏的公告、活動、地點、餐點',
    icon: 'heart-outline',
    selected: true,
  },
  {
    id: 'groups',
    name: '群組與貼文',
    description: '加入的群組、發布的貼文',
    icon: 'people-outline',
    selected: true,
  },
  {
    id: 'assignments',
    name: '作業與成績',
    description: '繳交的作業、獲得的成績',
    icon: 'document-text-outline',
    selected: true,
  },
  {
    id: 'registrations',
    name: '活動報名',
    description: '報名過的活動紀錄',
    icon: 'calendar-outline',
    selected: true,
  },
  {
    id: 'messages',
    name: '私訊紀錄',
    description: '與其他用戶的對話',
    icon: 'chatbubble-outline',
    selected: false,
  },
  {
    id: 'notifications',
    name: '通知設定',
    description: '推播偏好、免打擾時段',
    icon: 'notifications-outline',
    selected: true,
  },
  {
    id: 'lostfound',
    name: '失物招領',
    description: '發布的遺失/拾獲物品',
    icon: 'search-outline',
    selected: true,
  },
];

export function DataExportScreen(_props: any) {
  const { school } = useSchool();
  const auth = useAuth();

  const [categories, setCategories] = useState<ExportCategory[]>(EXPORT_CATEGORIES);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<'json' | 'readable'>('readable');

  const selectedCount = useMemo(() => categories.filter((c) => c.selected).length, [categories]);

  const toggleCategory = (id: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
  };

  const selectAll = () => {
    setCategories((prev) => prev.map((c) => ({ ...c, selected: true })));
  };

  const deselectAll = () => {
    setCategories((prev) => prev.map((c) => ({ ...c, selected: false })));
  };

  const exportData = async () => {
    if (!auth.user) {
      Alert.alert('錯誤', '請先登入');
      return;
    }

    if (selectedCount === 0) {
      Alert.alert('錯誤', '請至少選擇一個資料類別');
      return;
    }

    setExporting(true);
    setProgress('準備匯出...');

    try {
      const selectedCategories = categories.filter((c) => c.selected);
      setProgress(`正在匯出：${selectedCategories.map((category) => category.name).join('、')}...`);
      const exportedData: Record<string, any> = {
        ...(await exportUserData({
          categories: selectedCategories.map((category) => category.id),
          schoolId: school.id,
        })),
        exportDate: new Date().toISOString(),
        schoolId: school.id,
        schoolName: school.name,
        userId: auth.user.uid,
        email: auth.user.email,
      };

      setProgress('正在生成檔案...');

      let fileContent: string;
      let filename: string;
      let mimeType: string;

      if (exportFormat === 'json') {
        fileContent = JSON.stringify(exportedData, null, 2);
        filename = `campus-data-export-${Date.now()}.json`;
        mimeType = 'application/json';
      } else {
        fileContent = generateReadableExport(exportedData);
        filename = `campus-data-export-${Date.now()}.txt`;
        mimeType = 'text/plain';
      }

      const file = new File(Paths.cache, filename);
      await file.write(fileContent);

      setProgress('準備分享...');

      const canShare = await isAvailableAsync();
      if (canShare) {
        await shareAsync(file.uri, {
          mimeType,
          dialogTitle: '匯出我的資料',
        });
      } else {
        Alert.alert('完成', `資料已儲存至：${file.uri}`);
      }

      setProgress('');
      Alert.alert('匯出成功', '您的資料已成功匯出');
    } catch (error: any) {
      console.error('Export error:', error);
      Alert.alert('匯出失敗', error?.message || '無法匯出資料，請稍後再試');
    } finally {
      setExporting(false);
      setProgress('');
    }
  };

  const generateReadableExport = (data: Record<string, any>): string => {
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('               校園 App 個人資料匯出報告');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`匯出日期：${formatDateTime(new Date())}`);
    lines.push(`學校：${data.schoolName} (${data.schoolId})`);
    lines.push(`Email：${data.email}`);
    lines.push('');

    if (data.profile) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push('【個人資料】');
      lines.push('───────────────────────────────────────────────────────────');
      lines.push(`姓名：${data.profile.displayName || '(未設定)'}`);
      lines.push(`學號：${data.profile.studentId || '(未設定)'}`);
      lines.push(`系所：${data.profile.department || '(未設定)'}`);
      lines.push(`角色：${data.profile.role || 'student'}`);
      lines.push(`自我介紹：${data.profile.bio || '(無)'}`);
      lines.push('');
    }

    if (data.groups && data.groups.length > 0) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push(`【群組】共 ${data.groups.length} 個`);
      lines.push('───────────────────────────────────────────────────────────');
      data.groups.forEach((g: any, i: number) => {
        lines.push(`${i + 1}. ${g.name || g.groupId || '(未命名)'} - ${g.role || 'member'}`);
      });
      lines.push('');
    }

    if (data.posts && data.posts.length > 0) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push(`【貼文】共 ${data.posts.length} 篇`);
      lines.push('───────────────────────────────────────────────────────────');
      data.posts.forEach((p: any, i: number) => {
        lines.push(`${i + 1}. [${p.kind || 'post'}] ${p.title || '(無標題)'}`);
        if (p.body) {
          lines.push(`   ${p.body.slice(0, 100)}${p.body.length > 100 ? '...' : ''}`);
        }
      });
      lines.push('');
    }

    if (data.registrations && data.registrations.length > 0) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push(`【活動報名】共 ${data.registrations.length} 筆`);
      lines.push('───────────────────────────────────────────────────────────');
      data.registrations.forEach((r: any, i: number) => {
        lines.push(`${i + 1}. 活動 ID: ${r.eventId} - ${r.status || 'registered'}`);
      });
      lines.push('');
    }

    if (data.submissions && data.submissions.length > 0) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push(`【作業繳交】共 ${data.submissions.length} 筆`);
      lines.push('───────────────────────────────────────────────────────────');
      data.submissions.forEach((s: any, i: number) => {
        lines.push(`${i + 1}. ${s.status || 'submitted'} - 成績: ${s.score ?? '(未評分)'}`);
      });
      lines.push('');
    }

    if (data.lostFound && data.lostFound.length > 0) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push(`【失物招領】共 ${data.lostFound.length} 筆`);
      lines.push('───────────────────────────────────────────────────────────');
      data.lostFound.forEach((item: any, i: number) => {
        lines.push(`${i + 1}. [${item.type}] ${item.name} - ${item.status}`);
      });
      lines.push('');
    }

    if (data.notificationPreferences) {
      lines.push('───────────────────────────────────────────────────────────');
      lines.push('【通知設定】');
      lines.push('───────────────────────────────────────────────────────────');
      const prefs = data.notificationPreferences;
      lines.push(`通知啟用：${prefs.enabled ? '是' : '否'}`);
      lines.push(`公告通知：${prefs.announcements ? '是' : '否'}`);
      lines.push(`活動通知：${prefs.events ? '是' : '否'}`);
      lines.push(`群組通知：${prefs.groups ? '是' : '否'}`);
      lines.push(`訊息通知：${prefs.messages ? '是' : '否'}`);
      if (prefs.quietHoursEnabled) {
        lines.push(`免打擾時段：${prefs.quietHoursStart} - ${prefs.quietHoursEnd}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('                     資料匯出完成');
    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  };

  if (!auth.user) {
    return (
      <Screen>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        >
          <Card title="資料匯出" subtitle="需要登入">
            <Pill text="請先登入" />
            <Text style={{ color: theme.colors.muted, marginTop: 10, lineHeight: 20 }}>
              您需要登入才能匯出您的個人資料。
            </Text>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard title="匯出我的資料" subtitle="下載您在平台上的所有資料">
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <View
              style={{
                width: 70,
                height: 70,
                borderRadius: 35,
                backgroundColor: theme.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <Ionicons name="download-outline" size={36} color={theme.colors.accent} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
              資料可攜權
            </Text>
            <Text
              style={{
                color: theme.colors.muted,
                textAlign: 'center',
                marginTop: 8,
                lineHeight: 20,
              }}
            >
              根據資料保護法規，您有權下載並保存{'\n'}您在本平台上的所有個人資料。
            </Text>
          </View>
        </AnimatedCard>

        <Card title="選擇匯出內容" subtitle={`已選擇 ${selectedCount} 項`}>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <Button text="全選" onPress={selectAll} />
            <Button text="取消全選" onPress={deselectAll} />
          </View>

          <View style={{ gap: 2 }}>
            {categories.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => toggleCategory(category.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: category.selected
                      ? theme.colors.accentSoft
                      : theme.colors.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                  }}
                >
                  <Ionicons
                    name={category.icon as any}
                    size={20}
                    color={category.selected ? theme.colors.accent : theme.colors.muted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontWeight: '600',
                    }}
                  >
                    {category.name}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {category.description}
                  </Text>
                </View>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: category.selected ? theme.colors.accent : theme.colors.border,
                    backgroundColor: category.selected ? theme.colors.accent : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {category.selected && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card title="匯出格式">
          <View style={{ gap: 10 }}>
            <Pressable
              onPress={() => setExportFormat('readable')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor:
                  exportFormat === 'readable' ? theme.colors.accentSoft : theme.colors.surface2,
                borderWidth: 2,
                borderColor:
                  exportFormat === 'readable' ? theme.colors.accent : theme.colors.border,
              }}
            >
              <Ionicons
                name="document-text-outline"
                size={24}
                color={exportFormat === 'readable' ? theme.colors.accent : theme.colors.muted}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontWeight: '600',
                  }}
                >
                  易讀格式 (.txt)
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  方便閱讀的純文字格式
                </Text>
              </View>
              {exportFormat === 'readable' && (
                <Ionicons name="checkmark-circle" size={24} color={theme.colors.accent} />
              )}
            </Pressable>

            <Pressable
              onPress={() => setExportFormat('json')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor:
                  exportFormat === 'json' ? theme.colors.accentSoft : theme.colors.surface2,
                borderWidth: 2,
                borderColor: exportFormat === 'json' ? theme.colors.accent : theme.colors.border,
              }}
            >
              <Ionicons
                name="code-slash-outline"
                size={24}
                color={exportFormat === 'json' ? theme.colors.accent : theme.colors.muted}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontWeight: '600',
                  }}
                >
                  JSON 格式 (.json)
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  結構化資料，適合技術用途
                </Text>
              </View>
              {exportFormat === 'json' && (
                <Ionicons name="checkmark-circle" size={24} color={theme.colors.accent} />
              )}
            </Pressable>
          </View>
        </Card>

        {exporting ? (
          <Card title="匯出中...">
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, marginTop: 12 }}>{progress}</Text>
            </View>
          </Card>
        ) : (
          <Button
            text={`匯出 ${selectedCount} 項資料`}
            kind="primary"
            onPress={exportData}
            disabled={selectedCount === 0}
          />
        )}

        <Card title="隱私說明">
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Ionicons name="shield-checkmark" size={20} color={theme.colors.success} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20, fontSize: 13 }}>
                匯出的資料僅包含您的個人資料，不包含其他用戶的資訊。
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Ionicons name="lock-closed" size={20} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20, fontSize: 13 }}>
                匯出過程中資料經過加密傳輸，確保安全性。
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Ionicons name="time" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20, fontSize: 13 }}>
                資料匯出可能需要一些時間，取決於您的資料量。
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
