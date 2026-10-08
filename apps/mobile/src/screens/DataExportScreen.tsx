import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Paths, File, Directory } from 'expo-file-system';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { exportUserData, isPrivacyAccountCurrent } from '../services/privacy';

type Props = { navigation?: { goBack?: () => void; navigate?: (screen: string) => void } };
const categories = [
  { id: 'profile', name: '個人資料', description: '帳號資料與個人簡介' },
  {
    id: 'schoolRecords',
    name: '校園紀錄',
    description: '目前學校的課程、成績、行事曆、借閱、訂單與錢包紀錄',
  },
  { id: 'favorites', name: '收藏項目', description: '目前學校或帳號原有的收藏' },
  { id: 'groups', name: '群組與貼文', description: '帳號加入的群組與發布的貼文' },
  { id: 'assignments', name: '作業紀錄', description: '帳號的作業繳交內容與評分' },
  { id: 'registrations', name: '活動報名', description: '帳號的活動報名紀錄' },
  {
    id: 'messages',
    name: '對話紀錄',
    description: '目前學校與未指定學校的對話，包含對方傳送的訊息',
  },
  { id: 'notifications', name: '通知資料', description: '通知偏好、裝置推播註冊與收到的通知' },
  { id: 'lostfound', name: '失物招領', description: '在目前學校發布的遺失與拾獲資訊' },
];

export function DataExportScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const active = useRef(scope);
  active.current = scope;
  return user ? (
    <ExportEditor
      key={scope}
      uid={user.uid}
      schoolId={school.id}
      schoolName={school.name}
      navigation={navigation}
      isScopeCurrent={() => active.current === scope}
    />
  ) : (
    <AIDetailScreen title="匯出我的資料" onBack={() => navigation?.goBack?.()}>
      <AICard title="請先登入">
        <View style={{ gap: 16 }}>
          <Text style={{ color: aiTokens.muted }}>登入後可選擇要保存的帳號資料。</Text>
          <AIButton label="學校登入" onPress={() => navigation?.navigate?.('SSOLogin')} />
        </View>
      </AICard>
    </AIDetailScreen>
  );
}

function ExportEditor({
  uid,
  schoolId,
  schoolName,
  navigation,
  isScopeCurrent,
}: Props & {
  uid: string;
  schoolId: string;
  schoolName: string;
  isScopeCurrent: () => boolean;
}) {
  const [selected, setSelected] = useState(() =>
    categories.filter((item) => item.id !== 'messages').map((item) => item.id),
  );
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ truncated: boolean } | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const current = () => mounted.current && isScopeCurrent() && isPrivacyAccountCurrent(uid);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exportData = async () => {
    if (locked.current || !selected.length) return;
    setError('');
    setResult(null);
    if (!current()) {
      setError('登入狀態已變更，請重新登入後再匯出。');
      return;
    }
    locked.current = true;
    setProgress('正在準備匯出…');
    let file: File | null = null;
    let shared = false;
    try {
      const available = await isAvailableAsync();
      if (!current()) return;
      if (!available) {
        setError('這台裝置目前無法開啟分享選單，請使用手機版匯出。');
        return;
      }
      setProgress('正在讀取所選資料…');
      const data = await exportUserData({ expectedUserId: uid, categories: selected, schoolId });
      if (!current()) return;
      if (
        data.userId !== uid ||
        data.schoolId !== schoolId ||
        !data.coverage ||
        data.coverage.scope !== 'selected-categories' ||
        typeof data.coverage.truncated !== 'boolean' ||
        !Array.isArray(data.coverage.categories) ||
        data.coverage.categories.length !== selected.length ||
        data.coverage.categories.some((category) => !selected.includes(category))
      ) {
        throw new Error('Unconfirmed export scope');
      }
      setProgress('正在開啟分享選單…');
      const directory = new Directory(Paths.cache, 'campus-one-exports');
      directory.create({ idempotent: true, intermediates: true });
      // Android may finish the chooser before the receiving app reads the URI.
      // Retain handed-off files and only expire older exports on a later request.
      for (const previous of directory.list()) {
        if (
          previous instanceof File &&
          /^campus-one-export-\d+\.json$/.test(previous.name) &&
          previous.modificationTime !== null &&
          Date.now() - previous.modificationTime > 24 * 60 * 60 * 1000
        ) {
          try {
            previous.delete();
          } catch {
            /* Let the OS expire an inaccessible cache file. */
          }
        }
      }
      file = new File(directory, `campus-one-export-${Date.now()}.json`);
      await file.write(JSON.stringify(data, null, 2));
      if (!current()) return;
      shared = true;
      await shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: '儲存 Campus One 資料',
      });
      if (current()) setResult({ truncated: data.coverage.truncated });
    } catch {
      if (current()) setError('無法完成資料匯出，請確認網路後重試。');
    } finally {
      if (file && !shared) {
        try {
          file.delete();
        } catch {
          /* OS cache cleanup remains available. */
        }
      }
      locked.current = false;
      if (mounted.current && isScopeCurrent()) setProgress('');
    }
  };

  const busy = Boolean(progress);
  return (
    <AIDetailScreen
      title="匯出我的資料"
      subtitle="選擇內容，將資料保存到自己的裝置。"
      onBack={() => navigation?.goBack?.()}
    >
      <AICard title="這次匯出的範圍">
        <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
          目前學校：{schoolName}
          。個人資料、群組與作業等帳號紀錄可能跨越學校；校園紀錄與失物招領限目前學校。
        </Text>
      </AICard>
      <AICard title={`選擇內容 · ${selected.length} 項`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <AIButton
            label="全選"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setSelected(categories.map((item) => item.id));
              setResult(null);
            }}
          />
          <AIButton
            label="取消全選"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setSelected([]);
              setResult(null);
            }}
          />
        </View>
        {categories.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="checkbox"
              accessibilityLabel={item.name}
              accessibilityState={{ checked, disabled: busy }}
              disabled={busy}
              onPress={() => {
                setSelected((values) =>
                  checked ? values.filter((id) => id !== item.id) : [...values, item.id],
                );
                setResult(null);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: aiTokens.border,
              }}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={24}
                color={checked ? aiTokens.ai : aiTokens.muted}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: aiTokens.text, fontWeight: '600', fontSize: 16 }}>
                  {item.name}
                </Text>
                <Text style={{ color: aiTokens.muted, lineHeight: 20 }}>{item.description}</Text>
              </View>
            </Pressable>
          );
        })}
      </AICard>
      <AICard title="檔案與保存方式">
        <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
          匯出為
          JSON，保留伺服器回傳的完整欄位。資料量較大時，單次匯出可能只有部分紀錄，檔案會標記未完整的項目。請在分享選單選擇保存位置；關閉選單不代表檔案已儲存。
        </Text>
        <Text style={{ color: aiTokens.muted, lineHeight: 23, marginTop: 12 }}>
          檔案可能包含個人資料與對話內容，請保存在信任的位置。
        </Text>
      </AICard>
      <AICard>
        <View style={{ gap: 16 }}>
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={aiTokens.ai} />
              <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.muted, flex: 1 }}>
                {progress}
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>
              {error}
            </Text>
          ) : null}
          {result ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: result.truncated ? aiTokens.warning : aiTokens.muted,
                lineHeight: 22,
              }}
            >
              {result.truncated
                ? '這次匯出包含部分紀錄，請查看檔案中的未完整項目。'
                : '分享選單已關閉。'}
              請確認已在選擇的位置儲存檔案。
            </Text>
          ) : null}
          <AIButton
            label={busy ? '正在匯出…' : `匯出 ${selected.length} 項資料`}
            disabled={busy || selected.length === 0}
            onPress={() => void exportData()}
          />
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
