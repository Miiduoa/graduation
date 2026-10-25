import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Screen, AnimatedCard, Button, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import type { LostFoundCategory } from '../data/types';
import { LoginRequiredLostFoundComments } from '../components/LoginRequiredLostFoundComments';
import { LOST_FOUND_CATEGORIES, lostFoundDataSource, useLostFoundLoad } from '../features/lostFound';
import {
  LostFoundConflictError,
  LostFoundError,
  LostFoundScopeChangedError,
  LostFoundWriteUnconfirmedError,
  CONTACT_VISIBILITY_NOTE,
  LEGACY_MIGRATION_NOTE,
  asLostFoundViewItem,
  canManageLostFoundItem,
  fieldsEqual,
  type LostFoundViewItem,
  type LostFoundWriteFields,
} from '../data/lostFoundMeta';
import {
  LostFoundStorageError,
  clearLostFoundDraftIfMatches,
  clearLostFoundPendingIfMatches,
  drainLostFoundDraftSaves,
  emptyLostFoundFields,
  enqueueLostFoundDraftSave,
  forgetCreateDocumentIdIfMatches,
  loadCreateDocumentId,
  loadLostFoundDraft,
  loadLostFoundPending,
  rememberCreateDocumentId,
  saveLostFoundDraft,
  saveLostFoundPending,
  type LostFoundDraftScope,
  type LostFoundPendingIntent,
} from '../data/lostFoundDrafts';
import { isLostFoundDateOnly, lostFoundDateFieldValue } from '../data/lostFoundDates';
import { useLostFoundGenerationScope } from '../data/lostFoundScope';
import { allocateLostFoundDocumentId } from '../data/lostFoundSource';

type Props = {
  navigation?: { goBack?: () => void; navigate?: (screen: string, params?: object) => void };
  route?: { params?: { id?: string; type?: 'lost' | 'found' } };
};

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  editable = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  editable?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        editable={editable}
        maxLength={multiline ? 2000 : 200}
        style={{
          padding: 12,
          minHeight: multiline ? 100 : 46,
          color: theme.colors.text,
          borderColor: theme.colors.border,
          borderWidth: 1,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.md,
          textAlignVertical: 'top',
          opacity: editable ? 1 : 0.6,
        }}
      />
    </View>
  );
}

function Editor({
  item,
  initialType,
  uid,
  schoolId,
  isCurrent,
  assertCurrentScope,
  navigation,
}: {
  item: LostFoundViewItem | null;
  initialType: 'lost' | 'found';
  uid: string;
  schoolId: string;
  isCurrent: () => boolean;
  assertCurrentScope: () => Promise<boolean>;
  navigation?: Props['navigation'];
}) {
  const mode = item ? ('edit' as const) : ('create' as const);
  const [hydrated, setHydrated] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(item?.id ?? null);
  const [type, setType] = useState<'lost' | 'found'>(item?.type ?? initialType);
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState<LostFoundCategory>(
    (item?.category as LostFoundCategory) ?? 'other',
  );
  const [location, setLocation] = useState(item?.location ?? '');
  const [date, setDate] = useState(lostFoundDateFieldValue(item?.date));
  const [contactInfo, setContactInfo] = useState(item?.contactInfo ?? '');
  const [expectedRevision, setExpectedRevision] = useState(item?.updatedAtRevision ?? null);
  const [pending, setPending] = useState<LostFoundPendingIntent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [storageCorrupt, setStorageCorrupt] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const locked = useRef(false);
  const pendingRef = useRef<LostFoundPendingIntent | null>(null);
  const fieldsRef = useRef<LostFoundWriteFields>(emptyLostFoundFields(initialType));
  const documentIdRef = useRef<string | null>(item?.id ?? null);
  const expectedRevisionRef = useRef(item?.updatedAtRevision ?? null);

  const currentFields = (): LostFoundWriteFields => ({
    type,
    title,
    description,
    category,
    location,
    date,
    contactInfo,
  });

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    fieldsRef.current = currentFields();
  });

  useEffect(() => {
    documentIdRef.current = documentId;
  }, [documentId]);

  useEffect(() => {
    expectedRevisionRef.current = expectedRevision;
  }, [expectedRevision]);

  const draftScope = useCallback(
    (id: string): LostFoundDraftScope => ({ uid, schoolId, mode, itemKey: id }),
    [uid, schoolId, mode],
  );

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        if (item) {
          if (!canManageLostFoundItem(item, uid)) {
            if (active && isCurrent()) {
              setStatusMessage(LEGACY_MIGRATION_NOTE);
              setHydrated(true);
              setStorageBlocked(true);
            }
            return;
          }
          const scope = draftScope(item.id);
          try {
            const storedPending = await loadLostFoundPending(scope);
            const draft = await loadLostFoundDraft(scope);
            if (!active || !isCurrent()) return;
            setDocumentId(item.id);
            setExpectedRevision(item.updatedAtRevision ?? null);
            if (storedPending?.fields) {
              applyFields(storedPending.fields);
              setPending(storedPending);
              setStatusMessage('偵測到尚未確認的編輯，請先重試同一則內容。');
            } else if (draft) {
              applyFields(draft);
              if (draft.expectedRevision !== undefined) setExpectedRevision(draft.expectedRevision);
              setStatusMessage('已還原先前未完成的編輯草稿。');
            }
            setStorageBlocked(false);
            setStorageCorrupt(false);
            setHydrated(true);
          } catch (reason) {
            if (!active || !isCurrent()) return;
            // Keep item id; do not invent a replacement mutation identity.
            setDocumentId(item.id);
            setExpectedRevision(item.updatedAtRevision ?? null);
            setStorageBlocked(true);
            setStorageCorrupt(true);
            setStatusMessage(
              reason instanceof LostFoundStorageError
                ? reason.message
                : '本機草稿無法讀取；請先重試還原，勿直接送出新變更。',
            );
            setHydrated(true);
          }
          return;
        }

        let id = await loadCreateDocumentId(uid, schoolId);
        let nextFields = emptyLostFoundFields(initialType);
        let nextPending: LostFoundPendingIntent | null = null;
        let message = '';
        let corrupt = false;
        if (id) {
          const scope = draftScope(id);
          try {
            const storedPending = await loadLostFoundPending(scope);
            const draft = await loadLostFoundDraft(scope);
            if (storedPending?.fields) {
              nextFields = {
                ...storedPending.fields,
                contactInfo: storedPending.fields.contactInfo ?? '',
              };
              nextPending = storedPending;
              message = '偵測到尚未確認的刊登，請先重試同一則，避免重複發布。';
            } else if (draft) {
              nextFields = { ...draft, contactInfo: draft.contactInfo ?? '' };
              message = '已還原先前未完成的草稿。';
            } else {
              id = null;
            }
          } catch (reason) {
            // Retain the create id and block mutation until recovery succeeds.
            corrupt = true;
            message =
              reason instanceof LostFoundStorageError
                ? reason.message
                : '本機草稿無法讀取；請先重試還原，勿另開新則。';
          }
        }
        if (!id && !corrupt) {
          id = allocateLostFoundDocumentId(schoolId);
          try {
            await rememberCreateDocumentId(uid, schoolId, id);
          } catch {
            if (active && isCurrent()) {
              setDocumentId(id);
              applyFields(nextFields);
              setStorageBlocked(true);
              setStatusMessage('目前無法安全保存草稿編號，畫面內容仍可編輯，但重開可能遺失。');
              setHydrated(true);
            }
            return;
          }
        }
        if (!active || !isCurrent()) return;
        if (!id) {
          setStorageBlocked(true);
          setStorageCorrupt(true);
          setStatusMessage(message || '本機草稿無法準備，請先重試還原。');
          setHydrated(true);
          return;
        }
        setDocumentId(id);
        applyFields(nextFields);
        setPending(nextPending);
        if (message) setStatusMessage(message);
        setStorageBlocked(corrupt);
        setStorageCorrupt(corrupt);
        setHydrated(true);
      } catch (reason) {
        if (!active || !isCurrent()) return;
        setStorageBlocked(true);
        setStatusMessage(
          reason instanceof LostFoundStorageError
            ? reason.message
            : '目前無法準備刊登表單，請稍後再試。',
        );
        setHydrated(true);
      }
    };
    void boot();
    return () => {
      active = false;
    };
    // Intentionally once per editor mount (keyed by scope outside).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFields(next: LostFoundWriteFields) {
    setType(next.type);
    setTitle(next.title);
    setDescription(next.description);
    setCategory((next.category as LostFoundCategory) || 'other');
    setLocation(next.location);
    setDate(next.date);
    setContactInfo(next.contactInfo ?? '');
  }

  async function persistDraftNow(next: LostFoundWriteFields, id: string) {
    if (!isCurrent()) return;
    await enqueueLostFoundDraftSave(
      draftScope(id),
      {
        version: 1,
        documentId: id,
        expectedRevision: mode === 'edit' ? expectedRevisionRef.current : undefined,
        ...next,
      },
      () => isCurrent(),
    );
    if (!isCurrent()) return;
    if (mode === 'create') await rememberCreateDocumentId(uid, schoolId, id);
    if (!isCurrent()) return;
    setStorageBlocked(false);
    setStorageCorrupt(false);
    if (statusMessage.includes('無法安全保存') || statusMessage.includes('無法讀取')) {
      setStatusMessage('');
    }
  }

  async function retryStorage() {
    if (!isCurrent() || locked.current || saved) return;
    const id = documentIdRef.current;
    if (!id) return;
    locked.current = true;
    try {
      if (storageCorrupt) {
        const scope = draftScope(id);
        const storedPending = await loadLostFoundPending(scope);
        const draft = await loadLostFoundDraft(scope);
        if (!isCurrent()) return;
        if (storedPending?.fields) {
          applyFields(storedPending.fields);
          setPending(storedPending);
          setStatusMessage('偵測到尚未確認的操作，請先重試同一則內容。');
        } else if (draft) {
          applyFields(draft);
          if (draft.expectedRevision !== undefined) setExpectedRevision(draft.expectedRevision);
          setStatusMessage('已還原先前未完成的草稿。');
        } else if (item) {
          applyFields({
            type: item.type,
            title: item.title,
            description: item.description,
            category: item.category,
            location: item.location,
            date: lostFoundDateFieldValue(item.date),
            contactInfo: item.contactInfo ?? '',
          });
          setStatusMessage('');
        }
        // Re-persist current memory so storage is known-good; never allocate a new create id.
        await saveLostFoundDraft(draftScope(id), {
          version: 1,
          documentId: id,
          expectedRevision: mode === 'edit' ? expectedRevisionRef.current : undefined,
          ...fieldsRef.current,
        });
        if (mode === 'create') await rememberCreateDocumentId(uid, schoolId, id);
        if (!isCurrent()) return;
        setStorageBlocked(false);
        setStorageCorrupt(false);
        return;
      }
      await saveLostFoundDraft(draftScope(id), {
        version: 1,
        documentId: id,
        expectedRevision: mode === 'edit' ? expectedRevisionRef.current : undefined,
        ...fieldsRef.current,
      });
      if (mode === 'create') await rememberCreateDocumentId(uid, schoolId, id);
      if (!isCurrent()) return;
      setStorageBlocked(false);
      setStorageCorrupt(false);
      if (statusMessage.includes('無法安全保存') || statusMessage.includes('無法讀取')) {
        setStatusMessage('');
      }
    } catch (reason) {
      if (!isCurrent()) return;
      setStorageBlocked(true);
      setStatusMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : '目前無法安全保存草稿，畫面內容仍保留。',
      );
    } finally {
      locked.current = false;
    }
  }

  function onFieldChange(patch: Partial<LostFoundWriteFields>) {
    if (!hydrated || saved || !documentId || locked.current) return;
    if (!isCurrent()) return;
    if (storageCorrupt) {
      Alert.alert('請先還原草稿', '本機資料異常，請先重試還原後再修改。');
      return;
    }
    const currentPending = pendingRef.current;
    const next = { ...fieldsRef.current, ...patch };
    if (currentPending?.fields && !fieldsEqual(currentPending.fields, next)) {
      Alert.alert('尚有未確認的結果', '請先重試同一則內容，或確認列表後再修改。');
      applyFields({
        ...currentPending.fields,
        contactInfo: currentPending.fields.contactInfo ?? '',
      });
      return;
    }
    applyFields(next);
    fieldsRef.current = next;
    void persistDraftNow(next, documentId).catch((reason) => {
      if (!isCurrent()) return;
      setStorageBlocked(true);
      setStatusMessage(
        reason instanceof LostFoundStorageError
          ? reason.message
          : '目前無法安全保存草稿，畫面內容仍保留。',
      );
    });
  }

  const submit = async () => {
    if (!isCurrent() || locked.current || saved || !hydrated || !documentId) return;
    if (storageCorrupt) {
      Alert.alert('請先還原草稿', '本機待確認資料異常，請先重試還原，勿另開新則。');
      return;
    }
    if (item && !canManageLostFoundItem(item, uid)) {
      Alert.alert('無法編輯', LEGACY_MIGRATION_NOTE);
      return;
    }
    const existingPending = pendingRef.current;
    const intent: LostFoundPendingIntent =
      existingPending ??
      ({
        version: 1,
        action: mode === 'create' ? 'create' : 'edit',
        documentId,
        expectedRevision: mode === 'edit' ? expectedRevision : undefined,
        fields: {
          type,
          title: title.trim(),
          description: description.trim(),
          category,
          location: location.trim(),
          date,
          contactInfo: contactInfo.trim(),
        },
      } satisfies LostFoundPendingIntent);

    const fields = intent.fields!;
    if (
      fields.title.trim().length < 2 ||
      fields.description.trim().length < 10 ||
      !fields.location.trim() ||
      !isLostFoundDateOnly(fields.date)
    ) {
      Alert.alert(
        '請確認刊登內容',
        '標題至少 2 字、描述至少 10 字，並填寫地點與有效日期（YYYY-MM-DD）。',
      );
      return;
    }

    locked.current = true;
    setSubmitting(true);
    try {
      // Drain keystroke queue so pending/draft writes see a consistent latest payload.
      await drainLostFoundDraftSaves(draftScope(documentId));
      if (!isCurrent()) return;

      // Gate before durable pending write so a mid-await switch cannot orphan foreign state.
      if (!isCurrent()) return;
      await saveLostFoundPending(draftScope(documentId), intent);
      if (!isCurrent()) return;
      setPending(intent);

      await enqueueLostFoundDraftSave(
        draftScope(documentId),
        {
          version: 1,
          documentId,
          expectedRevision: mode === 'edit' ? intent.expectedRevision : undefined,
          ...fields,
          contactInfo: fields.contactInfo ?? '',
        },
        () => isCurrent(),
      );
      await drainLostFoundDraftSaves(draftScope(documentId));
      if (!isCurrent()) return;
      if (mode === 'create') await rememberCreateDocumentId(uid, schoolId, documentId);
      if (!isCurrent()) return;
      setStorageBlocked(false);

      const source = lostFoundDataSource();
      const writeOptions = {
        documentId: intent.documentId,
        expectedRevision: intent.expectedRevision,
        assertCurrentScope,
      };
      const result =
        mode === 'edit' && item
          ? await source.updateLostFoundItem(
              item.id,
              {
                type: fields.type,
                title: fields.title,
                description: fields.description,
                category: fields.category as LostFoundCategory,
                location: fields.location,
                date: fields.date,
                contactInfo: fields.contactInfo ?? '',
                reporterId: uid,
                schoolId,
              },
              schoolId,
              writeOptions,
            )
          : await source.createLostFoundItem(
              {
                type: fields.type,
                title: fields.title,
                description: fields.description,
                category: fields.category as LostFoundCategory,
                location: fields.location,
                date: fields.date,
                contactInfo: fields.contactInfo ?? '',
                reporterId: uid,
                schoolId,
              },
              writeOptions,
            );

      if (!isCurrent()) return;
      const view = asLostFoundViewItem(result);
      if (
        !view?.id ||
        (item && view.id !== item.id) ||
        view.userId !== uid ||
        view.schoolId !== schoolId ||
        view.title !== fields.title
      ) {
        throw new LostFoundWriteUnconfirmedError();
      }

      try {
        if (!isCurrent()) return;
        await clearLostFoundPendingIfMatches(draftScope(documentId), {
          action: intent.action,
          documentId: intent.documentId,
        });
        if (!isCurrent()) return;
        await drainLostFoundDraftSaves(draftScope(documentId));
        if (!isCurrent()) return;
        await clearLostFoundDraftIfMatches(draftScope(documentId), intent.documentId);
        if (!isCurrent()) return;
        if (mode === 'create') {
          await forgetCreateDocumentIdIfMatches(uid, schoolId, intent.documentId);
        }
      } catch {
        // Receipt already confirmed; cleanup is best-effort and identity-gated.
      }
      if (!isCurrent()) return;
      setPending(null);
      setSaved(true);
      setStatusMessage('');
      Alert.alert(mode === 'edit' ? '已更新刊登' : '已發布刊登', '可返回列表查看最新資訊。', [
        {
          text: '返回列表',
          onPress: () => {
            if (isCurrent()) navigation?.goBack?.();
          },
        },
      ]);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof LostFoundScopeChangedError) return;
      if (error instanceof LostFoundStorageError) {
        setStorageBlocked(true);
        setStatusMessage(error.message);
        Alert.alert('無法保存待確認操作', error.message);
        return;
      }
      if (error instanceof LostFoundConflictError) {
        Alert.alert('內容已變更', error.message);
        return;
      }
      if (
        error instanceof LostFoundWriteUnconfirmedError ||
        (error as { code?: string })?.code === 'lost-found-write-unconfirmed'
      ) {
        setPending(intent);
        setStatusMessage('送出結果未確認。請重試同一則內容，不要另開新則。');
        Alert.alert('無法確認刊登結果', error.message || '請先確認列表，再以同一則內容重試。');
        return;
      }
      Alert.alert(
        '無法確認刊登結果',
        error instanceof LostFoundError
          ? error.message
          : '請確認服務連線。內容仍保留，可以稍後重試。',
      );
    } finally {
      locked.current = false;
      if (isCurrent()) setSubmitting(false);
    }
  };

  if (!hydrated) {
    return (
      <Screen>
        <AnimatedCard title="正在準備刊登資料" />
      </Screen>
    );
  }

  if (item && !canManageLostFoundItem(item, uid)) {
    return (
      <Screen>
        <AnimatedCard title="無法編輯這則刊登" subtitle={LEGACY_MIGRATION_NOTE}>
          <Button
            text="返回"
            onPress={() => {
              if (isCurrent()) navigation?.goBack?.();
            }}
          />
        </AnimatedCard>
      </Screen>
    );
  }

  // Keep fields readable/editable on transient storage failure; freeze on pending/saved/corrupt.
  const inputsLocked = submitting || saved || !!pending || !documentId || storageCorrupt;
  const submitDisabled = saved || !documentId || storageCorrupt;
  const primaryLabel = pending
    ? mode === 'edit'
      ? '重試同一則編輯'
      : '重試同一則刊登'
    : saved
      ? '已儲存'
      : mode === 'edit'
        ? '儲存變更'
        : '發布刊登';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard
          title={mode === 'edit' ? '編輯失物招領' : '發布失物招領'}
          subtitle="提供清楚的物品特徵與聯絡方式，方便彼此核對。"
        >
          <View style={{ gap: 16 }}>
            {!!statusMessage && (
              <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>{statusMessage}</Text>
            )}
            <SegmentedControl
              options={[
                { id: 'lost', label: '遺失物品' },
                { id: 'found', label: '拾獲物品' },
              ]}
              selected={type}
              onSelect={(value) => {
                if (!inputsLocked) onFieldChange({ type: value as 'lost' | 'found' });
              }}
            />
            <Field
              label="物品名稱"
              value={title}
              editable={!inputsLocked}
              onChange={(value) => onFieldChange({ title: value })}
            />
            <Field
              label="物品描述"
              value={description}
              multiline
              editable={!inputsLocked}
              onChange={(value) => onFieldChange({ description: value })}
            />
            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>物品類別</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {LOST_FOUND_CATEGORIES.map((option) => (
                <Button
                  key={option.id}
                  text={option.label}
                  size="small"
                  kind={category === option.id ? 'primary' : 'secondary'}
                  disabled={inputsLocked}
                  onPress={() => onFieldChange({ category: option.id })}
                />
              ))}
            </View>
            <Field
              label="遺失或拾獲地點"
              value={location}
              editable={!inputsLocked}
              onChange={(value) => onFieldChange({ location: value })}
            />
            <Field
              label="日期（YYYY-MM-DD）"
              value={date}
              editable={!inputsLocked}
              onChange={(value) => onFieldChange({ date: value })}
              placeholder="例如 2026-10-08"
            />
            <Field
              label="聯絡方式（選填）"
              value={contactInfo}
              editable={!inputsLocked}
              onChange={(value) => onFieldChange({ contactInfo: value })}
            />
            <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
              {CONTACT_VISIBILITY_NOTE}
              完成交接後，可由本人在詳情頁結案。
            </Text>
            {(storageBlocked || storageCorrupt) && !saved && (
              <Button
                text={storageCorrupt ? '重試還原草稿' : '重試保存草稿'}
                disabled={submitting}
                onPress={() => void retryStorage()}
              />
            )}
            <Button
              text={primaryLabel}
              kind="primary"
              loading={submitting}
              disabled={submitDisabled}
              onPress={() => void submit()}
            />
            {(saved || pending) && (
              <Button
                text="返回列表"
                onPress={() => {
                  if (isCurrent()) navigation?.goBack?.();
                }}
              />
            )}
          </View>
        </AnimatedCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function LostFoundPostScreen({ navigation, route }: Props) {
  useThemeMode();
  const id = route?.params?.id ?? '';
  const { uid, schoolId, scope, focused, isCurrent, assertCurrentScope } =
    useLostFoundGenerationScope(id);
  const loader = useCallback(async () => {
    if (!id || !uid) return null;
    const item = asLostFoundViewItem(await lostFoundDataSource().getLostFoundItem(id, schoolId));
    if (!item || item.schoolId !== schoolId) throw new Error('無法編輯這則刊登。');
    if (canManageLostFoundItem(item, uid)) return item;
    // Own reporterId-only legacy: show truthful read-only migration UI (mutations refused by source).
    if (item.migrationReadOnly && item.reporterId === uid) return item;
    throw new Error('無法編輯這則刊登。');
  }, [id, uid, schoolId]);
  const { state, refresh } = useLostFoundLoad(scope, loader, isCurrent, Boolean(uid));
  if (!uid || state.status === 'login-required')
    return (
      <Screen>
        <AnimatedCard title="失物招領">
          <LoginRequiredLostFoundComments
            onLogin={() => {
              if (isCurrent()) navigation?.navigate?.('SSOLogin', { returnTo: '/lost-found/post' });
            }}
          />
        </AnimatedCard>
      </Screen>
    );
  // Wait until focus has produced a matching immutable isCurrent before mounting Editor.
  if (!focused || (id && state.status === 'loading'))
    return (
      <Screen>
        <AnimatedCard title="正在準備刊登資料" />
      </Screen>
    );
  if (id && state.status === 'error')
    return (
      <Screen>
        <AnimatedCard title="無法讀取刊登資料" subtitle="請確認這是本人於目前學校發布的資訊。">
          <Button text="重新讀取" onPress={refresh} />
        </AnimatedCard>
      </Screen>
    );
  const item = id ? asLostFoundViewItem(state.data ?? null) : null;
  return (
    <Screen>
      <Editor
        key={scope}
        item={item}
        initialType={route?.params?.type === 'found' ? 'found' : 'lost'}
        uid={uid}
        schoolId={schoolId}
        isCurrent={isCurrent}
        assertCurrentScope={assertCurrentScope}
        navigation={navigation}
      />
    </Screen>
  );
}
