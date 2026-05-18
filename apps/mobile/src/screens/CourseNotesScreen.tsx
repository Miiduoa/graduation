/**
 * Course Notes Screen — 課程個人筆記本地化
 *
 * 學生可在每堂課寫筆記、加標籤、附截圖、匯出。
 * 資料經 useAsyncStorage（依帳號／學校 scoped key）寫入本地；未來同步 TronClass 或自家後端。
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Share,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useAsyncStorage } from '../hooks/useStorage';
import { getScopedStorageKey } from '../services/scopedStorage';

type RouteProps = {
  route?: {
    params?: {
      courseId?: string;
      courseName?: string;
    };
  };
};

interface CourseNote {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export default function CourseNotesScreen(props: RouteProps) {
  const auth = useAuth();
  const { school } = useSchool();
  const courseId = props.route?.params?.courseId ?? 'default';
  const courseName = props.route?.params?.courseName ?? '課程筆記';

  const storageKey = useMemo(
    () =>
      getScopedStorageKey(`course-notes-${courseId}`, {
        uid: auth.user?.uid ?? null,
        schoolId: school?.id ?? auth.profile?.schoolId ?? null,
      }),
    [courseId, auth.user?.uid, school?.id, auth.profile?.schoolId],
  );

  const [notes, setNotes, notesLoading] = useAsyncStorage<CourseNote[]>(storageKey, {
    defaultValue: [],
  });

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const persistNotes = useCallback(
    async (updater: (prev: CourseNote[]) => CourseNote[]) => {
      await setNotes(updater);
    },
    [setNotes],
  );

  const tags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => n.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (!filterTag) return notes;
    return notes.filter((n) => n.tags.includes(filterTag));
  }, [notes, filterTag]);

  const extractTags = (text: string): string[] => {
    const matches = text.match(/#[^\s#]+/g) ?? [];
    return matches.map((m) => m.slice(1));
  };

  const handleSave = () => {
    if (!draft.trim()) return;
    const now = new Date().toISOString();
    const newTags = extractTags(draft);
    if (editingId) {
      void persistNotes((prev) =>
        prev.map((n) =>
          n.id === editingId ? { ...n, text: draft, tags: newTags, updatedAt: now } : n,
        ),
      );
      setEditingId(null);
    } else {
      const newNote: CourseNote = {
        id: `n_${Date.now()}`,
        text: draft,
        tags: newTags,
        createdAt: now,
        updatedAt: now,
      };
      void persistNotes((prev) => [newNote, ...prev]);
    }
    setDraft('');
  };

  const handleEdit = (n: CourseNote) => {
    setEditingId(n.id);
    setDraft(n.text);
  };

  const handleDelete = (id: string) => {
    Alert.alert('刪除筆記', '這則筆記將永久消失。', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: () => {
          void persistNotes((prev) => prev.filter((n) => n.id !== id));
        },
      },
    ]);
  };

  const handleExport = async () => {
    if (notes.length === 0) {
      Alert.alert('還沒有筆記可以匯出');
      return;
    }
    const text = notes
      .map(
        (n) =>
          `── ${new Date(n.createdAt).toLocaleString('zh-TW')} ──\n${n.text}\n標籤：${n.tags.map((t) => `#${t}`).join(' ') || '無'}`,
      )
      .join('\n\n');
    try {
      await Share.share({ message: `【${courseName} 筆記】\n\n${text}` });
    } catch {
      /* swallow */
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          padding: 14,
          backgroundColor: '#003F8A',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{courseName}</Text>
          <Text style={{ color: '#E5F2FF', fontSize: 12, marginTop: 2 }}>
            {notesLoading ? '載入中…' : `${notes.length} 則筆記 · 僅存裝置`}
          </Text>
        </View>
        <Pressable onPress={handleExport} hitSlop={8} disabled={notesLoading}>
          <Ionicons name="share-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {notesLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#003F8A" />
        </View>
      ) : (
        <>
          {tags.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ padding: 12, gap: 8 }}
            >
              <Pressable
                onPress={() => setFilterTag(null)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: !filterTag ? '#003F8A' : '#fff',
                  borderWidth: 1,
                  borderColor: !filterTag ? '#003F8A' : '#e5e7eb',
                }}
              >
                <Text style={{ color: !filterTag ? '#fff' : '#1C1C1E', fontSize: 12 }}>全部</Text>
              </Pressable>
              {tags.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setFilterTag(filterTag === t ? null : t)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: filterTag === t ? '#003F8A' : '#fff',
                    borderWidth: 1,
                    borderColor: filterTag === t ? '#003F8A' : '#e5e7eb',
                  }}
                >
                  <Text style={{ color: filterTag === t ? '#fff' : '#1C1C1E', fontSize: 12 }}>
                    #{t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
            {filteredNotes.length === 0 ? (
              <View style={{ alignItems: 'center', padding: 24, gap: 8 }}>
                <Text style={{ fontSize: 48 }}>📓</Text>
                <Text style={{ color: '#8E8E93', fontSize: 14 }}>
                  還沒有筆記。在下方輸入框寫第一則吧！
                </Text>
                <Text style={{ color: '#AEAEB2', fontSize: 11 }}>
                  提示：用 #標籤 可以分類，例如 #期中、#重點
                </Text>
              </View>
            ) : (
              filteredNotes.map((n) => (
                <View
                  key={n.id}
                  style={{
                    marginBottom: 10,
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                  }}
                >
                  <Text style={{ fontSize: 14, color: '#1C1C1E', lineHeight: 20 }}>{n.text}</Text>
                  {n.tags.length > 0 && (
                    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {n.tags.map((t) => (
                        <Text
                          key={t}
                          style={{
                            fontSize: 11,
                            color: '#003F8A',
                            backgroundColor: '#003F8A14',
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 6,
                          }}
                        >
                          #{t}
                        </Text>
                      ))}
                    </View>
                  )}
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}
                  >
                    <Text style={{ fontSize: 11, color: '#AEAEB2' }}>
                      {new Date(n.updatedAt).toLocaleString('zh-TW')}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Pressable onPress={() => handleEdit(n)} hitSlop={8}>
                        <Text style={{ fontSize: 12, color: '#003F8A' }}>編輯</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDelete(n.id)} hitSlop={8}>
                        <Text style={{ fontSize: 12, color: '#D70015' }}>刪除</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#fff',
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="寫筆記... 可用 #標籤"
          multiline
          editable={!notesLoading}
          style={{
            backgroundColor: '#f9fafb',
            borderRadius: 8,
            padding: 10,
            fontSize: 14,
            color: '#1C1C1E',
            minHeight: 50,
            maxHeight: 120,
            textAlignVertical: 'top',
          }}
        />
        <Pressable
          onPress={handleSave}
          disabled={!draft.trim() || notesLoading}
          style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 8,
            backgroundColor: draft.trim() && !notesLoading ? '#003F8A' : '#AEAEB2',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>
            {editingId ? '更新筆記' : '加入筆記'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
