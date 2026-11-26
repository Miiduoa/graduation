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
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useAsyncStorage } from '../hooks/useStorage';
import { getScopedStorageKey } from '../services/scopedStorage';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

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
  useThemeVersion();
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

  const canSave = Boolean(draft.trim()) && !notesLoading;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingVertical: 12,
          backgroundColor: theme.colors.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700', lineHeight: 24 }}
            numberOfLines={1}
          >
            {courseName}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {notesLoading ? '載入中…' : `${notes.length} 則筆記 · 僅存裝置`}
          </Text>
        </View>
        <Pressable
          onPress={handleExport}
          hitSlop={8}
          disabled={notesLoading}
          accessibilityRole="button"
          accessibilityLabel="匯出筆記"
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || notesLoading ? 0.6 : 1,
          })}
        >
          <Ionicons name="share-outline" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>

      {notesLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.bg }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      ) : (
        <>
          {tags.length > 0 && (
            <View
              style={{
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.separator,
                backgroundColor: theme.colors.bg,
              }}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: theme.layout.screenHorizontalPadding,
                  paddingVertical: 10,
                  gap: 8,
                }}
              >
                <Pressable
                  onPress={() => setFilterTag(null)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !filterTag }}
                  hitSlop={4}
                  style={{
                    paddingHorizontal: 14,
                    minHeight: 36,
                    justifyContent: 'center',
                    borderRadius: theme.radius.md,
                    backgroundColor: !filterTag ? theme.colors.accent : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: !filterTag ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: !filterTag ? theme.colors.onAccent : theme.colors.text,
                      fontSize: 13,
                      fontWeight: !filterTag ? '700' : '500',
                    }}
                  >
                    全部
                  </Text>
                </Pressable>
                {tags.map((t) => {
                  const active = filterTag === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setFilterTag(active ? null : t)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      hitSlop={4}
                      style={{
                        paddingHorizontal: 14,
                        minHeight: 36,
                        justifyContent: 'center',
                        borderRadius: theme.radius.md,
                        backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: active ? theme.colors.accent : theme.colors.border,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? theme.colors.onAccent : theme.colors.text,
                          fontSize: 13,
                          fontWeight: active ? '700' : '500',
                        }}
                      >
                        #{t}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: theme.layout.screenHorizontalPadding,
              paddingTop: 16,
              paddingBottom: 200,
            }}
          >
            {filteredNotes.length === 0 ? (
              <View
                style={{
                  paddingVertical: 32,
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Ionicons name="document-text-outline" size={32} color={theme.colors.muted} />
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    lineHeight: 20,
                  }}
                >
                  還沒有筆記。在下方輸入框寫第一則吧！
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: 'center' }}>
                  提示：用 #標籤 可以分類，例如 #期中、#重點
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text
                  accessibilityRole="header"
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 12,
                    fontWeight: '600',
                    letterSpacing: 0.4,
                  }}
                >
                  {filterTag ? `#${filterTag} · ${filteredNotes.length} 則` : `所有筆記（${filteredNotes.length}）`}
                </Text>
                <View
                  style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {filteredNotes.map((n, idx) => (
                    <View
                      key={n.id}
                      style={{
                        padding: 14,
                        borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                        borderTopColor: theme.colors.separator,
                      }}
                    >
                      <Text style={{ fontSize: 14, color: theme.colors.text, lineHeight: 21 }}>
                        {n.text}
                      </Text>
                      {n.tags.length > 0 && (
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {n.tags.map((t) => (
                            <Text
                              key={t}
                              style={{
                                fontSize: 11,
                                fontWeight: '600',
                                color: theme.colors.accent,
                                backgroundColor: theme.colors.accentSoft,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: theme.radius.sm,
                                overflow: 'hidden',
                              }}
                            >
                              #{t}
                            </Text>
                          ))}
                        </View>
                      )}
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: 10,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: theme.colors.muted }}>
                          {new Date(n.updatedAt).toLocaleString('zh-TW')}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 16 }}>
                          <Pressable
                            onPress={() => handleEdit(n)}
                            hitSlop={8}
                            accessibilityRole="button"
                            style={{ minHeight: 28, justifyContent: 'center' }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.accent }}>
                              編輯
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleDelete(n.id)}
                            hitSlop={8}
                            accessibilityRole="button"
                            style={{ minHeight: 28, justifyContent: 'center' }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.danger }}>
                              刪除
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
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
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingVertical: 12,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.separator,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="寫筆記... 可用 #標籤"
          placeholderTextColor={theme.colors.muted}
          multiline
          editable={!notesLoading}
          style={{
            backgroundColor: theme.colors.bg,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: 10,
            fontSize: 14,
            color: theme.colors.text,
            minHeight: 50,
            maxHeight: 120,
            textAlignVertical: 'top',
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {editingId ? (
            <Pressable
              onPress={() => {
                setEditingId(null);
                setDraft('');
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: theme.colors.textSecondary, fontWeight: '600', fontSize: 14 }}>
                取消
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              borderRadius: theme.radius.md,
              backgroundColor: canSave ? theme.colors.accent : theme.colors.disabledBg,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed && canSave ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                color: canSave ? theme.colors.onAccent : theme.colors.disabledText,
                fontWeight: '700',
                fontSize: 14,
              }}
            >
              {editingId ? '更新筆記' : '加入筆記'}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
