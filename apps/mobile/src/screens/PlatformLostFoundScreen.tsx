import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { NuniError } from '@campus/shared/src/nuni';
import {
  NUNI_LOST_FOUND_CONTACT_NOTE,
  validateNuniLostFoundRequest,
  type NuniLostFoundItem,
  type NuniLostFoundListInput,
  type NuniLostFoundPage,
} from '@campus/shared/src/nuniLostFound';
import {
  lostFoundFormFields,
  newLostFoundFields,
  type LostFoundWriteFields,
} from '@campus/shared/src/lostFoundFields';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { PlatformLostFoundForm } from '../components/PlatformLostFoundForm';
import {
  clearPlatformLostFoundDeviceState,
  discardPlatformLostFoundDraft,
  finishPlatformLostFoundPending,
  readPlatformLostFoundDeviceState,
  savePlatformLostFoundDraft,
  savePlatformLostFoundPending,
  type PlatformLostFoundDeviceState,
  type PlatformLostFoundDraft,
  type PlatformLostFoundPending,
} from '../data/platformLostFoundDrafts';
import { taiwanCalendarDay } from '../data/lostFoundDates';
import {
  isPlatformLostFoundRejected,
  isPlatformLostFoundScopeError,
  platformLostFoundCategories,
  platformLostFoundCategoryLabel,
  platformLostFoundErrorMessage,
  usePlatformLostFoundFocus,
} from '../features/platformLostFound';
import { getGoogleCredentialCapability } from '../services/nuniGoogle';
import { createPlatformLostFoundClient } from '../services/platformLostFoundClient';
import { useNuniSession } from '../state/nuniSession';
import { useSchool } from '../state/school';
import { useThemeMode } from '../state/theme';
import { AnimatedCard, Button, Pill, Screen, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';

type Auth = ReturnType<typeof useNuniSession>;
type Navigation = {
  navigate: (screen: string, params?: object) => void;
  setParams?: (params: object) => void;
  getState?: () => { routeNames?: string[] };
};
type Params = { id?: string; schoolId?: string };
type Props = { navigation?: Navigation; route?: { params?: Params } };
type Load<T> = { key: string; status: 'loading' | 'ready' | 'error'; value?: T; error?: string };
const validSchool = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value) &&
  !['personal', 'all', 'unavailable-campus'].includes(value);
const validItem = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^plf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const bodyStyle = () => ({ color: theme.colors.text, lineHeight: 23 });

function Loading({ text }: { text: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={text}
      style={{ gap: 10, padding: 20 }}
    >
      <ActivityIndicator color={theme.colors.accent} />
      <Text style={bodyStyle()}>{text}</Text>
    </View>
  );
}

function GoogleEntry({ auth, webUrl }: { auth: Auth; webUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch {
      if (mounted.current) setError('操作沒有完成，請確認連線後重試。');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (auth.loading || busy) return <Loading text={busy ? '正在處理…' : '正在確認 Google 帳號…'} />;
  return (
    <AnimatedCard
      title="使用 Google 帳號查看與刊登"
      subtitle="不需要先登入學校帳號。登入後即可聯絡發布者，並管理自己的刊登。"
    >
      {auth.error || error ? (
        <Text accessibilityRole="alert" style={bodyStyle()}>
          {auth.error || error}
        </Text>
      ) : null}
      {auth.pendingLogout ? (
        <Button text="完成上次登出" onPress={() => void run(auth.logout)} />
      ) : auth.error || auth.session ? (
        <Button text="重新確認登入" onPress={() => void run(auth.refresh)} />
      ) : getGoogleCredentialCapability().available ? (
        <Button text="使用 Google 繼續" onPress={() => void run(auth.signIn)} />
      ) : (
        <Text style={bodyStyle()}>
          這個 App 版本目前無法使用 Google 登入，請更新 App 或使用網頁版。
        </Text>
      )}
      <Button text="開啟網頁版失物招領" onPress={() => void run(() => Linking.openURL(webUrl))} />
    </AnimatedCard>
  );
}

export function PlatformLostFoundScreen({ navigation, route }: Props) {
  useThemeMode();
  const auth = useNuniSession();
  const { school, selectionReady } = useSchool();
  const signature = JSON.stringify([route?.params?.id, route?.params?.schoolId]);
  const [ignoredLink, setIgnoredLink] = useState<string | null>(null);
  const params = ignoredLink === signature ? undefined : route?.params;
  const linkedId = params?.id;
  const linkedSchool = params?.schoolId;
  const legacyAvailable = navigation?.getState?.().routeNames?.includes('LostFound') === true;
  const clearLink = () => {
    setIgnoredLink(signature);
    navigation?.setParams?.({ id: undefined, schoolId: undefined });
  };
  const webPath = validItem(linkedId) ? `/lost-found/platform/${linkedId}` : '/lost-found/platform';
  const webUrl = `https://nuni.tw${webPath}?schoolId=${encodeURIComponent(school.id)}`;
  let content: React.ReactNode;
  if (selectionReady === false) content = <Loading text="正在讀取選擇的校園…" />;
  else if (!validSchool(school.id))
    content = (
      <AnimatedCard title="請先選擇校園" subtitle="目前校園尚無可用的刊登範圍，請選擇其他學校。" />
    );
  else if (
    (linkedId !== undefined && !validItem(linkedId)) ||
    (linkedSchool !== undefined && !validSchool(linkedSchool))
  ) {
    content = (
      <AnimatedCard title="這個刊登連結不完整">
        <Button text="回到目前校園的列表" onPress={clearLink} />
      </AnimatedCard>
    );
  } else if (linkedSchool && linkedSchool !== school.id) {
    content = (
      <AnimatedCard
        title="連結屬於另一個校園"
        subtitle="請先切換到連結的校園，再查看這則刊登；也可以回到目前校園的列表。"
      >
        <Text style={bodyStyle()}>連結校園：{linkedSchool}</Text>
        <Button text="回到目前校園的列表" onPress={clearLink} />
      </AnimatedCard>
    );
  } else if (
    !auth.session ||
    auth.loading ||
    auth.error ||
    auth.pendingLogout ||
    !auth.isSessionCurrent(auth.session.platformAccountId, auth.session.context)
  ) {
    content = <GoogleEntry auth={auth} webUrl={webUrl} />;
  } else {
    return (
      <PlatformLostFoundWorkspace
        key={JSON.stringify([
          auth.session.platformAccountId,
          auth.session.context,
          school.id,
          linkedId,
        ])}
        auth={auth}
        accountId={auth.session.platformAccountId}
        context={auth.session.context}
        schoolId={school.id}
        schoolName={school.name}
        initialId={linkedId}
        onList={clearLink}
        onLegacy={legacyAvailable ? () => navigation?.navigate('LostFound') : undefined}
      />
    );
  }
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <SchoolBrowsingControl compact />
        {content}
        {legacyAvailable && (
          <Button text="查看既有校園刊登" onPress={() => navigation?.navigate('LostFound')} />
        )}
      </ScrollView>
    </Screen>
  );
}

function PlatformLostFoundWorkspace({
  auth,
  accountId,
  context,
  schoolId,
  schoolName,
  initialId,
  onList,
  onLegacy,
}: {
  auth: Auth;
  accountId: string;
  context: string;
  schoolId: string;
  schoolName: string;
  initialId?: string;
  onList: () => void;
  onLegacy?: () => void;
}) {
  const { request, isSessionCurrent } = auth;
  const verifySession = useCallback(
    () => isSessionCurrent(accountId, context),
    [accountId, context, isSessionCurrent],
  );
  const { focus, isCurrent } = usePlatformLostFoundFocus(verifySession);
  const deviceScope = useMemo(() => ({ accountId, schoolId }), [accountId, schoolId]);
  const api = useMemo(
    () => createPlatformLostFoundClient({ request, accountId, context, isCurrent }),
    [request, accountId, context, isCurrent],
  );
  const [view, setView] = useState<'list' | 'detail' | 'edit'>(initialId ? 'detail' : 'list');
  const [targetId, setTargetId] = useState<string | undefined>(initialId);
  const [filters, setFilters] = useState<NuniLostFoundListInput>({ schoolId, status: 'open' });
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const listKey = JSON.stringify([focus, filters, attempt]);
  const detailKey = JSON.stringify([focus, targetId, attempt]);
  const deviceKey = String(focus);
  const [list, setList] = useState<Load<NuniLostFoundPage>>({ key: '', status: 'loading' });
  const [detail, setDetail] = useState<Load<NuniLostFoundItem>>({ key: '', status: 'loading' });
  const [device, setDevice] = useState<Load<PlatformLostFoundDeviceState>>({
    key: '',
    status: 'loading',
  });
  const [editor, setEditor] = useState<PlatformLostFoundDraft | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyState, setBusyState] = useState<{ focus: number | null; label: string } | null>(null);
  const [confirmedMutation, setConfirmedMutation] = useState<string | null>(null);
  const lock = useRef<{ focus: number | null; token: symbol } | null>(null);
  const draftSequence = useRef(0);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const pageCursors = useRef(new Set<string>());
  const busy = busyState?.focus === focus ? busyState.label : '';
  const liveDevice =
    device.key === deviceKey ? device : { key: deviceKey, status: 'loading' as const };
  const liveList = list.key === listKey ? list : { key: listKey, status: 'loading' as const };
  const liveDetail =
    detail.key === detailKey ? detail : { key: detailKey, status: 'loading' as const };
  const deviceState = liveDevice.value;
  const pending = deviceState?.pending;
  const item = view === 'detail' ? liveDetail.value : undefined;
  const detailReference = useRef(item);
  detailReference.current = item;
  const editorReference = useRef(editor);
  editorReference.current = editor;
  const viewReference = useRef(view);
  viewReference.current = view;
  const mutable = !busy && liveDevice.status === 'ready' && !pending;

  const loadDevice = useCallback(async () => {
    if (!isCurrent()) return;
    setDevice({ key: deviceKey, status: 'loading' });
    try {
      const value = await readPlatformLostFoundDeviceState(deviceScope, isCurrent);
      if (isCurrent()) setDevice({ key: deviceKey, status: 'ready', value });
    } catch (error) {
      if (isCurrent())
        setDevice({
          key: deviceKey,
          status: 'error',
          error: error instanceof Error ? error.message : '無法讀取本機草稿。',
        });
    }
  }, [deviceScope, deviceKey, isCurrent]);

  useEffect(() => {
    void loadDevice();
  }, [loadDevice]);
  useEffect(() => {
    if (!isCurrent() || view !== 'list') return;
    const sequence = ++listSequence.current;
    pageCursors.current.clear();
    setList({ key: listKey, status: 'loading' });
    void api
      .list(filters)
      .then((value) => {
        if (isCurrent() && sequence === listSequence.current)
          setList({ key: listKey, status: 'ready', value });
      })
      .catch((error) => {
        if (isCurrent() && sequence === listSequence.current)
          setList({ key: listKey, status: 'error', error: platformLostFoundErrorMessage(error) });
      });
    return () => {
      listSequence.current += 1;
    };
  }, [api, filters, isCurrent, listKey, view]);

  useEffect(() => {
    if (!isCurrent() || view !== 'detail' || !targetId) return;
    const sequence = ++detailSequence.current;
    setDetail({ key: detailKey, status: 'loading' });
    void api
      .get({ schoolId, id: targetId })
      .then((value) => {
        if (isCurrent() && sequence === detailSequence.current)
          setDetail({ key: detailKey, status: 'ready', value });
      })
      .catch((error) => {
        if (isCurrent() && sequence === detailSequence.current)
          setDetail({
            key: detailKey,
            status: 'error',
            error: platformLostFoundErrorMessage(error),
          });
      });
    return () => {
      detailSequence.current += 1;
    };
  }, [api, detailKey, isCurrent, schoolId, targetId, view]);

  const setDeviceValue = (value: PlatformLostFoundDeviceState) =>
    setDevice({ key: deviceKey, status: 'ready', value });
  const returnToList = () => {
    if (!isCurrent() || busy) return;
    viewReference.current = 'list';
    detailReference.current = undefined;
    setView('list');
    setTargetId(undefined);
    setDetail({ key: '', status: 'loading' });
    onList();
  };
  const persistDraft = async (next: PlatformLostFoundDraft) => {
    const sequence = ++draftSequence.current;
    setDraftSaving(true);
    setDraftError('');
    try {
      const value = await savePlatformLostFoundDraft(deviceScope, next, isCurrent);
      if (isCurrent() && sequence === draftSequence.current) setDeviceValue(value);
    } catch (error) {
      if (isCurrent() && sequence === draftSequence.current)
        setDraftError(error instanceof Error ? error.message : '無法保存草稿。');
    } finally {
      if (isCurrent() && sequence === draftSequence.current) setDraftSaving(false);
    }
  };
  const openEditor = (next: PlatformLostFoundDraft) => {
    if (!mutable || !isCurrent()) return;
    editorReference.current = next;
    viewReference.current = 'edit';
    setEditor(next);
    setView('edit');
    setMessage('');
    setActionError('');
    void persistDraft(next);
  };
  const startCreate = (type: 'lost' | 'found') => {
    if (!mutable || deviceState?.draft || !isCurrent()) return;
    try {
      openEditor({
        mode: 'create',
        id: `plf_${Crypto.randomUUID()}`,
        fields: newLostFoundFields(taiwanCalendarDay(), type),
      });
    } catch {
      setActionError('目前無法建立刊登編號，請稍後重試。');
    }
  };

  const runMutation = async (
    intent: PlatformLostFoundPending,
    draftToSave?: PlatformLostFoundDraft,
  ) => {
    if (!isCurrent() || lock.current?.focus === focus) return;
    const token = Symbol('lost-found-write');
    lock.current = { focus, token };
    setBusyState({ focus, label: '正在確認操作結果…' });
    setMessage('');
    setActionError('');
    let sent = false;
    let confirmed = confirmedMutation === intent.input.mutationId;
    try {
      if (draftToSave)
        setDeviceValue(await savePlatformLostFoundDraft(deviceScope, draftToSave, isCurrent));
      const saved = await savePlatformLostFoundPending(deviceScope, intent, isCurrent);
      if (!isCurrent()) return;
      setDeviceValue(saved);
      if (!confirmed) {
        sent = true;
        const receipt =
          intent.action === 'create'
            ? await api.create(intent.input)
            : intent.action === 'update'
              ? await api.update(intent.input)
              : intent.action === 'resolve'
                ? await api.resolve(intent.input)
                : await api.remove(intent.input);
        if (!isCurrent()) return;
        // A detail/list read started before this receipt must never restore old contact data.
        detailSequence.current += 1;
        listSequence.current += 1;
        editorReference.current = null;
        confirmed = true;
        setConfirmedMutation(intent.input.mutationId);
        setEditor(null);
        setDraftError('');
        if ('removed' in receipt) {
          detailReference.current = undefined;
          viewReference.current = 'list';
          setView('list');
          setTargetId(undefined);
          setDetail({ key: '', status: 'loading' });
          setAttempt((value) => value + 1);
          setMessage('已下架這則刊登。');
        } else {
          detailReference.current = receipt;
          viewReference.current = 'detail';
          setTargetId(receipt.id);
          setView('detail');
          setDetail({
            key: JSON.stringify([focus, receipt.id, attempt]),
            status: 'ready',
            value: receipt,
          });
          setMessage(
            intent.action === 'resolve'
              ? '已結案，聯絡方式已清除。'
              : intent.action === 'create'
                ? '已完成刊登。'
                : '修改已儲存。',
          );
        }
      }
      const value = await finishPlatformLostFoundPending(deviceScope, intent, isCurrent);
      if (!isCurrent()) return;
      setDeviceValue(value);
      setConfirmedMutation(null);
    } catch (error) {
      if (!isCurrent() || isPlatformLostFoundScopeError(error)) return;
      if (confirmed) {
        setActionError('操作已完成，但這台手機的待確認紀錄尚未清除。請重試清理，不需重新刊登。');
      } else if (sent && isPlatformLostFoundRejected(error)) {
        detailSequence.current += 1;
        if (targetId === intent.input.id) {
          setDetail({
            key: detailKey,
            status: 'error',
            error: platformLostFoundErrorMessage(error),
          });
        }
        try {
          const value = await finishPlatformLostFoundPending(deviceScope, intent, isCurrent, true);
          if (isCurrent()) setDeviceValue(value);
        } catch {
          if (isCurrent()) setActionError('服務已拒絕這次操作，但本機紀錄尚未清除；請重試確認。');
        }
        if (isCurrent()) setActionError(platformLostFoundErrorMessage(error));
      } else if (!sent) {
        setActionError(error instanceof Error ? error.message : '無法保存待確認操作，尚未送出。');
        await loadDevice();
      } else {
        setActionError(
          `結果尚未確認，請重試同一則操作，避免重複刊登。${platformLostFoundErrorMessage(error)}`,
        );
      }
    } finally {
      if (lock.current?.token === token) lock.current = null;
      if (isCurrent()) setBusyState(null);
    }
  };

  const submit = () => {
    const currentEditor = editorReference.current;
    if (!currentEditor || viewReference.current !== 'edit' || !mutable || !isCurrent()) return;
    try {
      const base = {
        schoolId,
        id: currentEditor.id,
        mutationId: `plfm_${Crypto.randomUUID()}`,
        fields: currentEditor.fields,
      };
      const intent: PlatformLostFoundPending =
        currentEditor.mode === 'create'
          ? { action: 'create', input: validateNuniLostFoundRequest('create', base) }
          : {
              action: 'update',
              input: validateNuniLostFoundRequest('update', {
                ...base,
                expectedVersion: currentEditor.expectedVersion,
              }),
            };
      void runMutation(intent, currentEditor);
    } catch (error) {
      setDraftError(platformLostFoundErrorMessage(error));
    }
  };

  const confirmAction = (action: 'resolve' | 'remove', current: NuniLostFoundItem) => {
    if (!mutable || !current.isOwner || !isCurrent()) return;
    Alert.alert(
      action === 'resolve' ? '確認結案？' : '確認下架？',
      action === 'resolve'
        ? '確認已找回或完成歸還後結案。聯絡方式將永久清除，這則刊登也不能再編輯。'
        : '這則刊登與聯絡方式將不再供其他人查看，並清除這台手機上對應的草稿。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: action === 'resolve' ? '確認結案' : '確認下架',
          style: action === 'remove' ? 'destructive' : 'default',
          onPress: () => {
            if (
              !isCurrent() ||
              detailReference.current?.id !== current.id ||
              detailReference.current.version !== current.version
            )
              return;
            try {
              void runMutation({
                action,
                input: {
                  schoolId,
                  id: current.id,
                  expectedVersion: current.version,
                  mutationId: `plfm_${Crypto.randomUUID()}`,
                },
              });
            } catch {
              setActionError('目前無法建立操作編號，請重試。');
            }
          },
        },
      ],
    );
  };

  const discardDraft = () => {
    const id = deviceState?.draft?.id;
    if (!id || !mutable || !isCurrent()) return;
    Alert.alert('捨棄這台手機的草稿？', '只清除此帳號在目前校園的本機草稿，不會刪除已刊登資料。', [
      { text: '取消', style: 'cancel' },
      {
        text: '捨棄草稿',
        style: 'destructive',
        onPress: () => {
          if (!isCurrent()) return;
          void discardPlatformLostFoundDraft(deviceScope, id, isCurrent)
            .then((value) => {
              if (isCurrent()) {
                setDeviceValue(value);
                setEditor(null);
                setView('list');
                setDraftError('');
              }
            })
            .catch((error) => {
              if (isCurrent())
                setActionError(error instanceof Error ? error.message : '無法清除草稿。');
            });
        },
      },
    ]);
  };

  const clearBrokenStorage = () => {
    if (!isCurrent() || busy) return;
    Alert.alert(
      '清除本機失物招領紀錄？',
      '將清除此 Google 帳號在目前校園的草稿及待確認紀錄，不會刪除已刊登資料。操作可能已送出，清除後請先查看「我的刊登」，避免重複刊登。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除本機紀錄',
          style: 'destructive',
          onPress: () => {
            if (!isCurrent()) return;
            void clearPlatformLostFoundDeviceState(deviceScope, isCurrent)
              .then(() => {
                if (isCurrent()) {
                  setDeviceValue({ draft: null, pending: null });
                  setEditor(null);
                  setView('list');
                  setFilters({ schoolId, mine: true, status: 'all' });
                }
              })
              .catch((error) => {
                if (isCurrent())
                  setActionError(error instanceof Error ? error.message : '無法清除本機紀錄。');
              });
          },
        },
      ],
    );
  };

  const reloadEditor = () => {
    if (!editor || editor.mode !== 'update' || !mutable || !isCurrent()) return;
    const id = editor.id;
    Alert.alert(
      '以最新刊登內容取代草稿？',
      '目前草稿中的修改將被取代。讀取完成後，請再核對並編輯。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重新讀取',
          onPress: () => {
            if (
              !isCurrent() ||
              viewReference.current !== 'edit' ||
              editorReference.current?.id !== id ||
              lock.current?.focus === focus
            )
              return;
            const token = Symbol('lost-found-reload');
            lock.current = { focus, token };
            setBusyState({ focus, label: '正在讀取最新刊登…' });
            void api
              .get({ schoolId, id })
              .then(async (fresh) => {
                if (
                  !isCurrent() ||
                  viewReference.current !== 'edit' ||
                  editorReference.current?.id !== id
                )
                  return;
                if (!fresh.isOwner || fresh.status !== 'open')
                  throw new NuniError(409, 'LOST_FOUND_CLOSED');
                const next: PlatformLostFoundDraft = {
                  mode: 'update',
                  id,
                  expectedVersion: fresh.version,
                  fields: lostFoundFormFields(fresh),
                };
                const value = await savePlatformLostFoundDraft(deviceScope, next, isCurrent);
                if (isCurrent()) {
                  editorReference.current = next;
                  setEditor(next);
                  setDeviceValue(value);
                  setDraftError('');
                  setActionError('');
                }
              })
              .catch((error) => {
                if (isCurrent()) setActionError(platformLostFoundErrorMessage(error));
              })
              .finally(() => {
                if (lock.current?.token === token) lock.current = null;
                if (isCurrent()) setBusyState(null);
              });
          },
        },
      ],
    );
  };

  const more = async () => {
    const page = liveList.value;
    if (!page?.nextCursor || busy || !isCurrent()) return;
    const cursor = page.nextCursor;
    const token = Symbol('lost-found-page');
    if (lock.current?.focus === focus) return;
    lock.current = { focus, token };
    setBusyState({ focus, label: '正在讀取更多刊登…' });
    const sequence = listSequence.current;
    try {
      if (pageCursors.current.has(cursor)) throw new NuniError(502, 'INVALID_RESPONSE');
      const next = await api.list({ ...filters, cursor });
      if (!isCurrent() || sequence !== listSequence.current) return;
      pageCursors.current.add(cursor);
      const items = new Map(page.items.map((entry) => [entry.id, entry]));
      for (const entry of next.items) items.set(entry.id, entry);
      setList({ key: listKey, status: 'ready', value: { ...next, items: [...items.values()] } });
    } catch (error) {
      if (isCurrent() && sequence === listSequence.current)
        setActionError(platformLostFoundErrorMessage(error));
    } finally {
      if (lock.current?.token === token) lock.current = null;
      if (isCurrent()) setBusyState(null);
    }
  };

  const exportMine = async () => {
    if (!isCurrent() || lock.current?.focus === focus) return;
    const token = Symbol('lost-found-export');
    lock.current = { focus, token };
    setBusyState({ focus, label: '正在準備本人刊登資料…' });
    setActionError('');
    try {
      const entries: NuniLostFoundItem[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await api.export({ schoolId, ...(cursor ? { cursor } : {}) });
        if (!isCurrent()) return;
        entries.push(...page.items);
        if (entries.length > 5000 || (page.nextCursor && seen.has(page.nextCursor)))
          throw new NuniError(502, 'INVALID_RESPONSE');
        cursor = page.nextCursor ?? undefined;
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
        throw new NuniError(502, 'INVALID_RESPONSE');
      const payload = JSON.stringify(
        { schoolId, exportedAt: new Date().toISOString(), items: entries },
        null,
        2,
      );
      if (payload.length > 1_000_000) throw new NuniError(502, 'INVALID_RESPONSE');
      if (!isCurrent()) return;
      await Share.share({ title: `${schoolName}・我的失物招領資料`, message: payload });
    } catch (error) {
      if (isCurrent()) setActionError(platformLostFoundErrorMessage(error));
    } finally {
      if (lock.current?.token === token) lock.current = null;
      if (isCurrent()) setBusyState(null);
    }
  };

  if (focus === null)
    return (
      <Screen>
        <Loading text="正在確認目前畫面…" />
      </Screen>
    );
  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          testID="platform-lost-found"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        >
          <SchoolBrowsingControl compact />
          <View style={{ gap: 5 }}>
            <Text
              accessibilityRole="header"
              style={{ color: theme.colors.text, fontSize: 26, fontWeight: '700' }}
            >
              失物招領
            </Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              以 Google 帳號刊登，不需要先綁定學校。這裡顯示 {schoolName} 的平台刊登。
            </Text>
          </View>
          {message ? (
            <Text accessibilityLiveRegion="polite" style={bodyStyle()}>
              {message}
            </Text>
          ) : null}
          {actionError ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger, lineHeight: 23 }}>
              {actionError}
            </Text>
          ) : null}
          {busy ? <Loading text={busy} /> : null}
          {liveDevice.status === 'error' ? (
            <AnimatedCard title="本機草稿暫時無法讀取" subtitle={liveDevice.error}>
              <Button text="重試讀取本機紀錄" disabled={!!busy} onPress={() => void loadDevice()} />
              <Button text="清除損毀的本機紀錄" disabled={!!busy} onPress={clearBrokenStorage} />
            </AnimatedCard>
          ) : pending ? (
            <AnimatedCard
              title={
                confirmedMutation === pending.input.mutationId
                  ? '操作完成，等待清理本機紀錄'
                  : '還有一則操作待確認'
              }
            >
              <Text style={bodyStyle()}>
                {pending.action === 'create'
                  ? '刊登'
                  : pending.action === 'update'
                    ? '編輯'
                    : pending.action === 'resolve'
                      ? '結案'
                      : '下架'}
                {'fields' in pending.input ? `：${pending.input.fields.title}` : ''}
              </Text>
              <Text style={bodyStyle()}>重試會沿用同一則操作，不會另開一則刊登。</Text>
              <Button
                text={
                  confirmedMutation === pending.input.mutationId
                    ? '重試清理本機紀錄'
                    : '重試確認這則操作'
                }
                disabled={!!busy}
                onPress={() => void runMutation(pending)}
              />
            </AnimatedCard>
          ) : deviceState?.draft && view !== 'edit' ? (
            <AnimatedCard
              title="這台手機有一份草稿"
              subtitle={deviceState.draft.fields.title || '尚未填寫物品名稱'}
            >
              <Button
                text="繼續編輯草稿"
                disabled={!mutable}
                onPress={() => {
                  if (isCurrent() && deviceState.draft) {
                    setEditor(deviceState.draft);
                    setView('edit');
                  }
                }}
              />
              <Button text="捨棄本機草稿" disabled={!mutable} onPress={discardDraft} />
            </AnimatedCard>
          ) : null}
          {view === 'edit' && editor ? (
            <PlatformLostFoundForm
              draft={editor}
              disabled={!mutable}
              saving={draftSaving}
              error={draftError}
              onChange={(fields: LostFoundWriteFields) => {
                if (
                  !mutable ||
                  !isCurrent() ||
                  viewReference.current !== 'edit' ||
                  editorReference.current?.id !== editor.id
                )
                  return;
                const next = { ...editor, fields };
                editorReference.current = next;
                setEditor(next);
                void persistDraft(next);
              }}
              onSave={submit}
              onReload={reloadEditor}
              onClose={() => {
                if (!mutable || !isCurrent()) return;
                void savePlatformLostFoundDraft(deviceScope, editor, isCurrent)
                  .then((value) => {
                    if (isCurrent()) {
                      setDeviceValue(value);
                      returnToList();
                    }
                  })
                  .catch((error) => {
                    if (isCurrent())
                      setDraftError(error instanceof Error ? error.message : '無法保存草稿。');
                  });
              }}
            />
          ) : view === 'detail' ? (
            <>
              <Button text="返回刊登列表" disabled={!!busy} onPress={returnToList} />
              {liveDetail.status === 'loading' ? (
                <Loading text="正在讀取刊登…" />
              ) : liveDetail.status === 'error' ? (
                <AnimatedCard title="無法讀取這則刊登" subtitle={liveDetail.error}>
                  <Button text="重新讀取刊登" onPress={() => setAttempt((value) => value + 1)} />
                </AnimatedCard>
              ) : item ? (
                <AnimatedCard title={item.title}>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Pill text={item.type === 'lost' ? '遺失' : '拾獲'} />
                    <Pill text={item.status === 'open' ? '尋找中' : '已結案'} />
                    <Pill text={platformLostFoundCategoryLabel(item.category)} />
                  </View>
                  <Text style={bodyStyle()}>
                    {item.location} · {item.date}
                  </Text>
                  <Text style={bodyStyle()}>{item.description}</Text>
                  <Text selectable style={bodyStyle()}>
                    {item.status === 'resolved'
                      ? '已結案，聯絡方式已清除。'
                      : item.contactInfo || '發布者未提供聯絡方式。'}
                  </Text>
                  {item.status === 'open' && (
                    <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                      {NUNI_LOST_FOUND_CONTACT_NOTE}
                    </Text>
                  )}
                  <Button
                    text="分享這則刊登"
                    disabled={!!busy}
                    onPress={() => {
                      if (!isCurrent()) return;
                      void Share.share({
                        title: item.title,
                        message: `【${item.type === 'lost' ? '遺失' : '拾獲'}】${item.title}\nhttps://nuni.tw/lost-found/platform/${item.id}?schoolId=${encodeURIComponent(schoolId)}`,
                      }).catch(() => {
                        if (isCurrent()) setActionError('無法開啟分享，請重試。');
                      });
                    }}
                  />
                  {item.isOwner && (
                    <View style={{ gap: 10 }}>
                      <Text style={{ color: theme.colors.muted }}>這是你的刊登</Text>
                      {item.status === 'open' && (
                        <>
                          <Button
                            text="編輯這則刊登"
                            disabled={!mutable || !!deviceState?.draft}
                            onPress={() =>
                              openEditor({
                                mode: 'update',
                                id: item.id,
                                expectedVersion: item.version,
                                fields: lostFoundFormFields(item),
                              })
                            }
                          />
                          <Button
                            text="將這則刊登結案"
                            disabled={!mutable}
                            onPress={() => confirmAction('resolve', item)}
                          />
                        </>
                      )}
                      <Button
                        text="下架這則刊登"
                        disabled={!mutable}
                        onPress={() => confirmAction('remove', item)}
                      />
                    </View>
                  )}
                </AnimatedCard>
              ) : null}
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    text="我遺失了"
                    disabled={!mutable || !!deviceState?.draft}
                    onPress={() => startCreate('lost')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    text="我拾獲了"
                    disabled={!mutable || !!deviceState?.draft}
                    onPress={() => startCreate('found')}
                  />
                </View>
              </View>
              <View testID="platform-lost-found-owner-filter">
                <SegmentedControl
                  disabled={!!busy}
                  options={[
                    { id: 'campus', label: '校園刊登' },
                    { id: 'mine', label: '我的刊登' },
                  ]}
                  selected={filters.mine ? 'mine' : 'campus'}
                  onSelect={(value) => {
                    if (!isCurrent() || busy) return;
                    setFilters({
                      ...filters,
                      mine: value === 'mine',
                      status: value === 'mine' ? 'all' : 'open',
                    });
                  }}
                />
              </View>
              <View style={{ gap: 8 }}>
                <TextInput
                  accessibilityLabel="搜尋平台失物"
                  value={search}
                  onChangeText={setSearch}
                  maxLength={100}
                  placeholder="搜尋名稱、地點或描述"
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    padding: 12,
                    minHeight: 48,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: theme.radius.md,
                  }}
                />
                <Button
                  text="搜尋刊登"
                  disabled={!!busy}
                  onPress={() => {
                    if (isCurrent()) setFilters({ ...filters, q: search.trim() });
                  }}
                />
              </View>
              <SegmentedControl
                options={[
                  { id: 'all', label: '遺失與拾獲' },
                  { id: 'lost', label: '遺失' },
                  { id: 'found', label: '拾獲' },
                ]}
                selected={filters.type ?? 'all'}
                onSelect={(value) => {
                  if (isCurrent() && !busy) {
                    const next = { ...filters };
                    if (value === 'all') delete next.type;
                    else next.type = value as 'lost' | 'found';
                    setFilters(next);
                  }
                }}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {[{ id: '', label: '所有類別' }, ...platformLostFoundCategories].map(
                  ({ id, label }) => (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      accessibilityLabel={`篩選類別：${label}`}
                      accessibilityState={{ selected: (filters.category ?? '') === id }}
                      disabled={!!busy}
                      onPress={() => {
                        if (isCurrent()) {
                          const next = { ...filters };
                          if (id) next.category = id;
                          else delete next.category;
                          setFilters(next);
                        }
                      }}
                      style={{
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor:
                          (filters.category ?? '') === id
                            ? theme.colors.accentSoft
                            : theme.colors.surface2,
                      }}
                    >
                      <Text style={bodyStyle()}>{label}</Text>
                    </Pressable>
                  ),
                )}
              </ScrollView>
              <Button
                text={filters.status === 'open' ? '只看尋找中：開啟' : '只看尋找中：關閉'}
                disabled={!!busy}
                onPress={() => {
                  if (isCurrent())
                    setFilters({ ...filters, status: filters.status === 'open' ? 'all' : 'open' });
                }}
              />
              {liveList.status === 'loading' ? (
                <Loading text="正在讀取平台刊登…" />
              ) : liveList.status === 'error' ? (
                <AnimatedCard title="平台刊登暫時無法讀取" subtitle={liveList.error}>
                  <Button text="重新讀取列表" onPress={() => setAttempt((value) => value + 1)} />
                </AnimatedCard>
              ) : liveList.value?.items.length ? (
                liveList.value.items.map((entry) => (
                  <AnimatedCard key={entry.id}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`查看平台刊登：${entry.title}`}
                      disabled={!!busy}
                      onPress={() => {
                        if (isCurrent()) {
                          setTargetId(entry.id);
                          setView('detail');
                          setMessage('');
                          setActionError('');
                        }
                      }}
                      style={{ gap: 8 }}
                    >
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        <Pill text={entry.type === 'lost' ? '遺失' : '拾獲'} />
                        <Pill text={entry.status === 'open' ? '尋找中' : '已結案'} />
                        {entry.isOwner && <Pill text="我的刊登" />}
                      </View>
                      <Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: '600' }}>
                        {entry.title}
                      </Text>
                      <Text style={{ color: theme.colors.muted }}>
                        {entry.location} · {entry.date}
                      </Text>
                      <Text style={bodyStyle()} numberOfLines={2}>
                        {entry.description}
                      </Text>
                    </Pressable>
                  </AnimatedCard>
                ))
              ) : (
                <AnimatedCard
                  title="目前沒有符合條件的刊登"
                  subtitle="可以調整搜尋與篩選條件，或刊登遺失、拾獲資訊。"
                />
              )}
              {liveList.value?.nextCursor && (
                <Button text="載入更多刊登" disabled={!!busy} onPress={() => void more()} />
              )}
              {filters.mine && (
                <AnimatedCard title="我的資料">
                  <Text style={bodyStyle()}>
                    匯出目前校園的本人刊登，包含你填寫的聯絡方式。你可以自行選擇儲存或分享位置。
                  </Text>
                  <Button
                    text="匯出本校的本人刊登"
                    disabled={!!busy}
                    onPress={() => void exportMine()}
                  />
                </AnimatedCard>
              )}
            </>
          )}
          {onLegacy && <Button text="查看既有校園刊登" disabled={!!busy} onPress={onLegacy} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
