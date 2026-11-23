import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { NuniError } from '@campus/shared/src/nuni';
import { useAuth } from '../state/auth';
import { useNuniSession } from '../state/nuniSession';
import { AIButton, AICard, AIHero, AIRow, AIScreen, aiTokens } from '../ui/aiFirst';
import {
  createNativeTronClassClient,
  nativeTronClassError,
  nativeTronClassDownloadTarget,
  safeTronClassSourceHref,
  tronClassConnectionLost,
  type NativeTronClassClient,
} from '../services/tronClassIntegration';
import {
  isNativeTronClassFirebaseOwner,
  nativeTronClassFirebaseRequest,
  nativeTronClassFirebaseDownload,
  nativeTronClassFirebaseSubmissionDownload,
  tronClassUploadQuery,
} from '../services/tronClassNativeTransport';
import type {
  TronClassConnection,
  TronClassCourseIndex,
  TronClassHomework,
  TronClassLocalDraft,
  TronClassSnapshot,
} from '../services/tronClassIntegrationTypes';
import {
  TronClassAssignmentPanel,
  tronClassNativeTime,
} from './tronclass/TronClassAssignmentPanel';
import { isTronClassDataFetchEnabled } from '../services/tronClassDataEnabled';
import { safeNavigate } from '../utils/safeNavigate';
import {
  NativeTronClassFileCache,
  purgeAbandonedNativeTronClassFiles,
} from '../services/tronClassNativeFileCache';

const copy = { color: aiTokens.text, lineHeight: 23, marginBottom: 12 };
const field = {
  borderWidth: 1,
  borderColor: aiTokens.border,
  borderRadius: 10,
  minHeight: 48,
  padding: 12,
  color: aiTokens.text,
  marginBottom: 12,
};

const MAX_LOCAL_DRAFTS = 5;
type HomeworkFilter = 'all' | 'pending' | 'unknown' | 'submitted';
const homeworkFilters: { value: HomeworkFilter; label: string }[] = [
  { value: 'all', label: '全部作業' },
  { value: 'pending', label: '待繳交' },
  { value: 'unknown', label: '狀態待確認' },
  { value: 'submitted', label: '已繳交' },
];
function homeworkState(item: TronClassHomework): Exclude<HomeworkFilter, 'all'> {
  return item.submitted === true ? 'submitted' : item.submitted === false ? 'pending' : 'unknown';
}
function homeworkDeadline(item: TronClassHomework): number {
  const value = item.deadline ? Date.parse(item.deadline) : NaN;
  return Number.isFinite(value) ? value : Infinity;
}
function homeworkOrder(left: TronClassHomework, right: TronClassHomework): number {
  const completed = Number(left.submitted === true) - Number(right.submitted === true);
  if (completed) return completed;
  const leftDeadline = homeworkDeadline(left);
  const rightDeadline = homeworkDeadline(right);
  return leftDeadline === rightDeadline ? 0 : leftDeadline < rightDeadline ? -1 : 1;
}

export function TronClassWorkspaceScreen() {
  const navigation = React.useContext(NavigationContext);
  if (isTronClassDataFetchEnabled()) return <EnabledTronClassWorkspace />;

  return (
    <AIScreen>
      <AICard>
        <Text accessibilityRole="alert" style={copy}>此功能目前未開放</Text>
        <AIButton label="返回" onPress={() => {
          if (!navigation) return;
          if (navigation.canGoBack()) {
            navigation.goBack();
            return;
          }
          const home = navigation.getState().routeNames.includes('LoginLanding') ? 'LoginLanding' : 'LearnHome';
          safeNavigate(navigation, home);
        }} />
      </AICard>
    </AIScreen>
  );
}

/** One independently verified BFF owner, with platform-session precedence over Firebase. */
function EnabledTronClassWorkspace() {
  const platform = useNuniSession();
  const school = useAuth();
  const navigation = React.useContext(NavigationContext);
  const latest = useRef({ platform, school });
  latest.current = { platform, school };
  const platformBlocked = platform.loading || !!platform.error || platform.pendingLogout;
  const platformSession = !platformBlocked ? platform.session : null;
  const schoolUid =
    !platformBlocked &&
    !platform.session &&
    !school.loading &&
    !school.tokenExpired &&
    school.user &&
    !school.user.uid.startsWith('demo_')
      ? school.user.uid
      : null;
  const scope = platformSession
    ? `platform:${platformSession.platformAccountId}:${platformSession.context}`
    : schoolUid
      ? `firebase:${schoolUid}`
      : '';
  const access = useMemo(() => {
    if (!scope) return null;
    const controller = new AbortController();
    if (platformSession) {
      const { platformAccountId, context } = platformSession;
      const isCurrent = () => {
        const auth = latest.current.platform;
        return (
          !controller.signal.aborted &&
          !auth.loading &&
          !auth.error &&
          !auth.pendingLogout &&
          auth.session?.platformAccountId === platformAccountId &&
          auth.session.context === context &&
          auth.isSessionCurrent(platformAccountId, context)
        );
      };
      return {
        controller,
        client: createNativeTronClassClient({
          owner: `platform:${platformAccountId}`,
          isCurrent,
          request: (input, signal) => latest.current.platform.bffRequest(
            'tronclass', context, input, undefined, undefined, signal ?? controller.signal,
          ),
          download: (input) => latest.current.platform.tronClassDownload(input, context),
          downloadSubmissionAttachment: typeof platform.tronClassSubmissionDownload === 'function'
            ? (input, signal) => latest.current.platform.tronClassSubmissionDownload(input, context, signal)
            : undefined,
          upload: (target, bytes, contentType) =>
            latest.current.platform.upload(
              'tronclass',
              context,
              bytes,
              contentType,
              tronClassUploadQuery(target),
            ),
        }),
      };
    }
    const uid = schoolUid!;
    const isCurrent = () => {
      const auth = latest.current;
      return (
        !controller.signal.aborted &&
        !auth.platform.loading &&
        !auth.platform.pendingLogout &&
        !auth.platform.error &&
        !auth.platform.session &&
        !auth.school.loading &&
        !auth.school.tokenExpired &&
        auth.school.user?.uid === uid &&
        isNativeTronClassFirebaseOwner(uid)
      );
    };
    return {
      controller,
      client: createNativeTronClassClient({
        owner: `firebase:${uid}`,
        isCurrent,
        request: (input, signal) =>
          nativeTronClassFirebaseRequest(uid, isCurrent, input, signal ?? controller.signal),
        download: (input) =>
          nativeTronClassFirebaseDownload(uid, isCurrent, input, controller.signal),
        downloadSubmissionAttachment: (input, signal) =>
          nativeTronClassFirebaseSubmissionDownload(uid, isCurrent, input, signal),
        upload: (target, bytes, contentType) =>
          nativeTronClassFirebaseRequest(
            uid,
            isCurrent,
            { scope: target, bytes, contentType },
            controller.signal,
          ),
      }),
    };
    // A fresh object from either auth provider must not replace a live screen's owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => () => access?.controller.abort(), [access]);
  if (platform.loading || (!platform.session && school.loading))
    return (
      <AIScreen>
        <AICard>
          <ActivityIndicator accessibilityLabel="正在確認登入帳號" />
        </AICard>
      </AIScreen>
    );
  if (platformBlocked)
    return (
      <AIScreen>
        <AICard title="請先確認 nuni 登入">
          <Text accessibilityRole="alert" style={copy}>
            {platform.pendingLogout
              ? 'nuni 登出尚未完成，請先完成登出。'
              : '目前無法確認 nuni 帳號。'}
          </Text>
          <AIButton
            label={platform.pendingLogout ? '完成登出' : '重新確認登入'}
            onPress={() => void (platform.pendingLogout ? platform.logout() : platform.refresh())}
          />
        </AICard>
      </AIScreen>
    );
  if (!access)
    return (
      <AIScreen>
        <AIHero title="連接 TronClass" subtitle="先登入 nuni，再獨立驗證你的校方帳號。" />
        <AICard>
          <AIButton
            label="前往 nuni 登入"
            onPress={() => safeNavigate(navigation, 'NuniWorkspace')}
          />
        </AICard>
      </AIScreen>
    );
  return <NativeTronClassWorkspace key={scope} client={access.client} />;
}

function NativeTronClassWorkspace({ client }: { client: NativeTronClassClient }) {
  const navigation = React.useContext(NavigationContext);
  const [connection, setConnection] = useState<TronClassConnection | null>(null);
  const [snapshot, setSnapshot] = useState<TronClassSnapshot | null>(null);
  const [courseIndex, setCourseIndex] = useState<TronClassCourseIndex | null>(null);
  const [indexError, setIndexError] = useState('');
  const [indexLoading, setIndexLoading] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('正在讀取連接狀態…');
  const [error, setError] = useState('');
  const [statusKnown, setStatusKnown] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [homeworkFilter, setHomeworkFilter] = useState<HomeworkFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TronClassHomework | null>(null);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [drafts, setDrafts] = useState<TronClassLocalDraft[]>([]);
  const retainedDrafts = useRef<TronClassLocalDraft[]>([]);
  const [courseLoading, setCourseLoading] = useState(false);
  const [fileCache] = useState(() => new NativeTronClassFileCache());
  const courseRequest = useRef(0);
  const indexRequest = useRef(0);
  const directorySequence = useRef(0);
  const acceptedDirectorySequence = useRef(0);
  const latestConnection = useRef(connection);
  latestConnection.current = connection;
  const draftIdentity = useRef<string | null>(null);
  const rememberedKey = useRef<string | null>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const connectController = useRef<AbortController | null>(null);
  const current = () => mounted.current && client.isCurrent();
  const clearDrafts = () => {
    retainedDrafts.current = [];
    fileCache.clear();
    setDrafts([]);
    draftIdentity.current = null;
  };
  function rememberDraft(value: TronClassLocalDraft | null, course: number, homeworkId: number) {
    if (!current()) return;
    const key = rememberedKey.current;
    if (!key) { clearDrafts(); return; }
    const otherDrafts = retainedDrafts.current.filter((item) => item.courseId !== course || item.homeworkId !== homeworkId);
    // Opening a sixth new editor is blocked; never silently replace prior work.
    if (value && otherDrafts.length >= MAX_LOCAL_DRAFTS) return;
    const next = value ? [...otherDrafts, value] : otherDrafts;
    retainedDrafts.current = next;
    draftIdentity.current = next.length ? key : null;
    fileCache.retain(next.flatMap((item) => item.files));
    setDrafts(next);
  }
  function acceptConnection(value: TronClassConnection) {
    const key =
      value.connected && /^[a-f0-9]{64}$/.test(value.studentKey ?? '') ? value.studentKey! : null;
    if (value.connected && (!key || (draftIdentity.current && draftIdentity.current !== key)))
      clearDrafts();
    if (!value.connected && value.revision === null) clearDrafts();
    rememberedKey.current = key;
    latestConnection.current = value;
    setConnection(value);
    setStatusKnown(true);
    setAccount(value.account || '');
    setReconnecting(!value.connected);
  }
  async function loadCourseIndex(value: TronClassConnection) {
    if (!value.connected || !value.revision) return;
    const run = ++indexRequest.current;
    const directoryOrder = ++directorySequence.current;
    const matches = () => current() && run === indexRequest.current && latestConnection.current?.revision === value.revision;
    setIndexLoading(true);
    setIndexError('');
    try {
      const data = await client.courses(value.revision);
      if (matches() && directoryOrder >= acceptedDirectorySequence.current) {
        acceptedDirectorySequence.current = directoryOrder;
        setCourseIndex(data);
      }
    } catch (failure) {
      if (!matches()) return;
      if (tronClassConnectionLost(failure)) lost(failure);
      else if (directoryOrder >= acceptedDirectorySequence.current) setIndexError(nativeTronClassError(failure));
    } finally { if (matches()) setIndexLoading(false); }
  }
  function synchronize(value: TronClassConnection) {
    if (!value.connected || !value.revision) return;
    // The small directory remains usable while a full coursework read is pending.
    void loadCourseIndex(value);
    void readCourseData(value, null);
  }
  async function readCourseData(connectionValue: TronClassConnection, target: number | null) {
    if (!connectionValue.connected || !connectionValue.revision) return;
    const expectedRevision = connectionValue.revision;
    const run = ++courseRequest.current;
    const directoryOrder = ++directorySequence.current;
    setCourseId(target);
    setSelected(null);
    setCourseLoading(true);
    setError('');
    setSnapshot(null);
    const matches = () => current() && courseRequest.current === run &&
      latestConnection.current?.revision === expectedRevision;
    try {
      const value = await client.sync(expectedRevision, target ?? undefined);
      if (matches()) {
        setSnapshot(value);
        if (directoryOrder >= acceptedDirectorySequence.current) {
          acceptedDirectorySequence.current = directoryOrder;
          const errors = value.errors.filter((issue) => issue.area === 'courses' && issue.courseId === null)
            .map((issue) => ({ courseId: null, area: 'courses' as const, message: issue.message }));
          setCourseIndex({ kind: 'course-index', revision: value.revision, fetchedAt: value.fetchedAt,
            courses: value.courses, errors, partial: errors.length > 0 });
          setIndexError('');
        }
      }
    } catch (failure) {
      if (!matches()) return;
      if (tronClassConnectionLost(failure)) lost(failure);
      else setError(nativeTronClassError(failure));
    } finally { if (matches()) setCourseLoading(false); }
  }
  function lost(failure: unknown) {
    ++courseRequest.current;
    ++indexRequest.current;
    setCourseIndex(null);
    setIndexError('');
    setIndexLoading(false);
    setCourseLoading(false);
    setPassword('');
    setSelected(null);
    setSnapshot(null);
    setCourseId(null);
    setAssignmentBusy(false);
    setStatusKnown(false);
    setReconnecting(true);
    setError(nativeTronClassError(failure));
    if (!rememberedKey.current && !draftIdentity.current) clearDrafts();
    // Keep only local text and URI handles. Revisions, preparations and confirmations are discarded.
    rememberedKey.current = null;
    latestConnection.current = null;
    setConnection(null);
  }
  async function load() {
    if (lock.current || assignmentBusy || !current()) return;
    lock.current = true;
    ++courseRequest.current;
    ++indexRequest.current;
    setCourseIndex(null);
    setIndexError('');
    setIndexLoading(false);
    setCourseLoading(false);
    if (!rememberedKey.current && !draftIdentity.current) clearDrafts();
    setBusy('正在讀取連接狀態…');
    setError('');
    setStatusKnown(false);
    setSelected(null);
    setSnapshot(null);
    setCourseId(null);
    setPassword('');
    try {
      const value = await client.status();
      if (!current()) return;
      acceptConnection(value);
      synchronize(value);
    } catch (failure) {
      if (current()) {
        if (tronClassConnectionLost(failure)) lost(failure);
        else setError(nativeTronClassError(failure));
      }
    } finally {
      lock.current = false;
      if (current()) setBusy('');
    }
  }
  useEffect(() => {
    mounted.current = true;
    purgeAbandonedNativeTronClassFiles();
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setPassword('');
        cancelConnect(false);
      }
    });
    const unsubscribeBlur = navigation?.addListener('blur', () => cancelConnect(false));
    return () => {
      mounted.current = false;
      connectController.current?.abort();
      connectController.current = null;
      rememberedKey.current = null;
      draftIdentity.current = null;
      fileCache.dispose();
      subscription.remove();
      unsubscribeBlur?.();
    };
    // The enclosing route remounts this workspace synchronously on owner/context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, navigation]);
  async function connect() {
    if (
      lock.current ||
      assignmentBusy ||
      !current() ||
      !statusKnown ||
      !account.trim() ||
      !password
    )
      return;
    const secret = password;
    setPassword('');
    lock.current = true;
    const controller = new AbortController();
    connectController.current = controller;
    const matches = () => current() && connectController.current === controller && !controller.signal.aborted;
    ++courseRequest.current;
    ++indexRequest.current;
    setCourseIndex(null);
    setIndexError('');
    setIndexLoading(false);
    setCourseLoading(false);
    setBusy('正在驗證校方帳號…');
    setError('');
    setSelected(null);
    setSnapshot(null);
    setCourseId(null);
    try {
      const value = await client.connect(account, secret, connection?.revision ?? null, controller.signal);
      if (!matches()) return;
      acceptConnection(value);
      setReconnecting(false);
      synchronize(value);
    } catch (failure) {
      if (!matches()) return;
      // A lost reply may have changed the binding. A status read must precede another attempt.
      setConnection(null);
      rememberedKey.current = null;
      setStatusKnown(false);
      setReconnecting(true);
      setError(nativeTronClassError(failure));
    } finally {
      if (connectController.current === controller) {
        connectController.current = null;
        lock.current = false;
        if (current()) setBusy('');
      }
    }
  }
  function cancelConnect(refreshStatus = true) {
    const controller = connectController.current;
    if (!controller) return;
    connectController.current = null;
    controller.abort();
    lock.current = false;
    if (!current()) return;
    setBusy('');
    setPassword('');
    setConnection(null);
    latestConnection.current = null;
    rememberedKey.current = null;
    setStatusKnown(false);
    setReconnecting(true);
    // The request may have committed before cancellation. Do not reuse its old
    // revision or automatically retry the login; first fetch the current state.
    if (refreshStatus) void load();
  }
  async function disconnect() {
    if (lock.current || assignmentBusy || !current() || !statusKnown || !connection) return;
    lock.current = true;
    ++courseRequest.current;
    ++indexRequest.current;
    setCourseIndex(null);
    setIndexError('');
    setIndexLoading(false);
    setCourseLoading(false);
    setBusy('正在解除連接…');
    setError('');
    clearDrafts();
    setSelected(null);
    setSnapshot(null);
    setCourseId(null);
    setPassword('');
    rememberedKey.current = null;
    setDisconnecting(false);
    try {
      const value = await client.disconnect(connection.revision);
      if (current()) acceptConnection(value);
    } catch (failure) {
      if (current()) {
        setConnection(null);
        setStatusKnown(false);
        setError(`${nativeTronClassError(failure)} 請讀取狀態，確認是否已解除。`);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy('');
    }
  }
  async function selectCourse(target: number | null) {
    if (!current() || lock.current || assignmentBusy || !connection?.connected || !connection.revision) return;
    const directory = courseIndex?.courses ?? snapshot?.courses;
    if (!directory || (target !== null && !directory.some((course) => course.id === target))) return;
    await readCourseData(connection, target);
  }
  async function downloadMaterial(
    material: TronClassSnapshot['materials'][number],
    file: TronClassSnapshot['materials'][number]['files'][number],
  ) {
    if (!current() || lock.current || assignmentBusy || courseLoading || !connection?.revision)
      return;
    const target = nativeTronClassDownloadTarget(material, file, connection.revision);
    if (!target) return;
    const generation = courseRequest.current;
    const live = () => {
      const binding = latestConnection.current;
      return (
        binding?.connected === true &&
        binding.revision === target.revision &&
        typeof binding.expiresAt === 'string' &&
        Number.isFinite(Date.parse(binding.expiresAt)) &&
        new Date(binding.expiresAt).toISOString() === binding.expiresAt &&
        Date.parse(binding.expiresAt) > Date.now()
      );
    };
    const expired = () => {
      if (current() && latestConnection.current?.revision === target.revision && !live())
        lost(new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED'));
    };
    if (!live()) {
      expired();
      return;
    }
    const matches = () => current() && courseRequest.current === generation && live();
    lock.current = true;
    setBusy(`正在下載 ${file.name}…`);
    setError('');
    try {
      const downloaded = await client.download(target);
      if (!matches()) {
        expired();
        return;
      }
      await fileCache.share(downloaded, matches);
    } catch (failure) {
      if (!matches()) {
        expired();
        return;
      }
      if (tronClassConnectionLost(failure)) lost(failure);
      else setError(nativeTronClassError(failure));
    } finally {
      lock.current = false;
      if (current()) setBusy('');
    }
  }
  const catalogReady = !!connection?.connected && !!snapshot && !busy && statusKnown;
  const ready = catalogReady && !courseLoading;
  const directoryReady = !!connection?.connected && !!(courseIndex || snapshot) && !busy && statusKnown;
  const courses = courseIndex?.courses ?? snapshot?.courses ?? [];
  const matchingHomework = snapshot?.homework.filter((row) =>
    (courseId === null || row.courseId === courseId) &&
    `${row.title} ${row.courseName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ) ?? [];
  const homeworkCounts: Record<HomeworkFilter, number> = { all: matchingHomework.length, pending: 0, unknown: 0, submitted: 0 };
  for (const row of matchingHomework) homeworkCounts[homeworkState(row)]++;
  const homework = matchingHomework
    .filter((row) => homeworkFilter === 'all' || homeworkState(row) === homeworkFilter)
    .sort(homeworkOrder);
  const chooseAssignment = (row: TronClassHomework) => {
    if (!ready || assignmentBusy || !current()) return;
    const draft = drafts.find((item) => item.courseId === row.courseId && item.homeworkId === row.id);
    if (!draft && drafts.length >= MAX_LOCAL_DRAFTS) {
      setError(`本頁已保留 ${MAX_LOCAL_DRAFTS} 份草稿。請先繼續或丟棄其中一份，再開啟其他作業。`);
      return;
    }
    setError('');
    setSelected(row);
  };
  return (
    <AIScreen keyboardShouldPersistTaps="handled">
      <AIHero
        title="TronClass 課務"
        subtitle="獨立連接靜宜大學帳號，在 App 查看課程、整理與核對作業。"
      />
      <AICard
        title={
          connection?.connected
            ? `已連接 ${connection.userName || connection.account}`
            : '連接校方帳號'
        }
      >
        {connection?.connected ? (
          <Text style={copy}>
            帳號：{connection.account} · 有效至 {tronClassNativeTime(connection.expiresAt)}
          </Text>
        ) : null}
        <Text style={copy}>
          校方密碼僅用於這次驗證；文字草稿留在本頁，附件會暫存於 App
          並在離頁時清除。連接不會改變你的 nuni 身分。
        </Text>
        {(reconnecting || !connection?.connected) && statusKnown ? (
          <>
            <TextInput
              accessibilityLabel="TronClass 帳號"
              value={account}
              onChangeText={setAccount}
              editable={!busy && !assignmentBusy}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
              placeholder="學校帳號"
              placeholderTextColor={aiTokens.muted}
              style={field}
            />
            <TextInput
              accessibilityLabel="TronClass 密碼"
              value={password}
              onChangeText={setPassword}
              editable={!busy && !assignmentBusy}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              maxLength={1000}
              placeholder="校方密碼"
              placeholderTextColor={aiTokens.muted}
              style={field}
            />
            <AIButton
              label="驗證並連接 TronClass"
              disabled={!!busy || assignmentBusy || !account.trim() || !password}
              onPress={() => void connect()}
            />
          </>
        ) : null}
        {connection?.connected && !reconnecting ? (
          <AIButton
            label="重新連接或切換校方帳號"
            variant="ghost"
            disabled={!!busy || assignmentBusy}
            onPress={() => {
              if (!current()) return;
              setReconnecting(true);
              setPassword('');
              setSelected(null);
              setDisconnecting(false);
            }}
          />
        ) : null}
        {connection?.revision && statusKnown ? (
          <AIButton
            label="解除 TronClass 連接"
            variant="ghost"
            disabled={!!busy || assignmentBusy}
            onPress={() => setDisconnecting(true)}
          />
        ) : null}
        {disconnecting ? (
          <View>
            <Text style={copy}>解除後會清除本頁課務與草稿；已發出的作業不會撤回。</Text>
            <AIButton
              label="確認解除連接並清除草稿"
              variant="danger"
              disabled={!!busy || assignmentBusy}
              onPress={() => void disconnect()}
            />
            <AIButton
              label="取消解除"
              variant="ghost"
              disabled={!!busy}
              onPress={() => setDisconnecting(false)}
            />
          </View>
        ) : null}
        <AIButton
          label={statusKnown ? '重新整理課務資料' : '重新讀取連接狀態'}
          variant="ghost"
          disabled={!!busy || assignmentBusy}
          onPress={() => void load()}
        />
      </AICard>
      {busy ? (
        <AICard>
          <ActivityIndicator accessibilityLabel={busy} />
          <Text accessibilityLiveRegion="polite" style={copy}>
            {busy}
          </Text>
          {connectController.current && (
            <AIButton label="取消連接" variant="ghost" onPress={() => cancelConnect()} />
          )}
        </AICard>
      ) : null}
      {error ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ ...copy, color: aiTokens.danger }}>
            {error}
          </Text>
        </AICard>
      ) : null}
      {drafts.length > 0 && !ready ? (
        <AICard title="本頁草稿等待恢復">
          <Text style={copy}>
            重新連接經校方驗證的同一帳號後，可在同一份作業恢復文字與附件；送出權限會重新確認。
          </Text>
          <AIButton label="丟棄保留的草稿" variant="ghost" disabled={!!busy} onPress={clearDrafts} />
        </AICard>
      ) : null}
      {ready && selected ? (
        <TronClassAssignmentPanel
          key={`${connection.revision}:${selected.courseId}:${selected.id}`}
          client={client}
          fileCache={fileCache}
          revision={connection.revision!}
          homework={selected}
          initialDraft={draftIdentity.current === connection.studentKey
            ? drafts.find((item) => item.courseId === selected.courseId && item.homeworkId === selected.id)
            : undefined}
          onDraftChange={(value) => rememberDraft(value, selected.courseId, selected.id)}
          onBusy={setAssignmentBusy}
          isBindingCurrent={() => {
            const binding = latestConnection.current;
            return current() && binding?.connected === true && binding.revision === connection.revision &&
              typeof binding.expiresAt === 'string' && Number.isFinite(Date.parse(binding.expiresAt)) &&
              new Date(binding.expiresAt).toISOString() === binding.expiresAt && Date.parse(binding.expiresAt) > Date.now();
          }}
          onConnectionLost={(failure) => {
            if (latestConnection.current?.revision === connection.revision) lost(failure);
          }}
          onSubmitted={() => {
            if (!current() || latestConnection.current?.revision !== connection.revision) return;
            // A read already in flight may still contain the pre-submission
            // status. Later explicit refreshes remain authoritative.
            ++courseRequest.current;
            setCourseLoading(false);
            setSnapshot((value) => value?.revision === connection.revision ? {
              ...value,
              homework: value.homework.map((row) => row.courseId === selected.courseId && row.id === selected.id
                ? { ...row, submitted: true } : row),
            } : value);
            setSelected((value) => value?.courseId === selected.courseId && value.id === selected.id
              ? { ...value, submitted: true } : value);
          }}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {indexError && !selected ? <AICard title="課程清單尚未讀取完成">
        <Text accessibilityRole="alert" style={copy}>{indexError}</Text>
        <AIButton label="重新讀取課程清單" disabled={indexLoading || !!busy || assignmentBusy}
          onPress={() => { if (connection) void loadCourseIndex(connection); }} />
      </AICard> : null}
      {directoryReady && !selected ? (
          <AICard title="我的校方課程">
            <Text style={copy}>清單更新時間：{tronClassNativeTime(courseIndex?.fetchedAt ?? snapshot!.fetchedAt)}</Text>
            {courseIndex?.partial ? <Text style={copy}>部分課程清單尚未取得，可先選擇已顯示的課程。</Text> : null}
            <AIButton
              label="顯示全部課程作業"
              variant="ghost"
              onPress={() => void selectCourse(null)}
            />
            {courses.map((course) => (
              <AIRow
                key={course.id}
                title={course.name}
                subtitle={[course.code, course.semester, course.teachers.join('、')]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() => void selectCourse(course.id)}
              />
            ))}
            {!courses.length ? (
              <Text style={copy}>
                目前沒有取得課程。若預期應有資料，請重新整理或到校方確認修課名單。
              </Text>
            ) : null}
          </AICard>
      ) : null}
      {courseLoading && !selected ? <AICard>
        <ActivityIndicator accessibilityLabel="正在讀取所選課程" />
        <Text style={copy}>正在讀取作業、公告與教材…{directoryReady ? '可先選擇一門課，不必等候全部同步。' : ''}</Text>
      </AICard> : null}
      {directoryReady && !snapshot && !courseLoading && !selected ? <AICard>
        <Text style={copy}>課程清單已載入。請選一門課讀取作業、公告與教材，或重新整理。</Text>
        <AIButton label="重試讀取課務" variant="ghost" onPress={() => void selectCourse(courseId)} />
      </AICard> : null}
      {catalogReady && !selected && snapshot ? (
        <>
          {snapshot.partial ? (
            <AICard title="部分資料尚未讀取完成">
              <Text accessibilityRole="alert" style={copy}>
                以下清單可能不完整。未讀到的項目不代表沒有作業。
              </Text>
              {snapshot.errors.map((issue, index) => (
                <Text key={index} style={copy}>
                  {issue.courseId ? `課程 ${issue.courseId}：` : ''}
                  {issue.message}
                </Text>
              ))}
              <AIButton
                label="重試讀取課務"
                variant="ghost"
                onPress={() => void selectCourse(courseId)}
              />
            </AICard>
          ) : null}
          <AICard
            title={
              courseId
                ? `${courses.find((course) => course.id === courseId)?.name || '課程'}的作業`
                : '全部作業'
            }
          >
            <TextInput accessibilityLabel="搜尋作業" placeholder="搜尋作業或課程名稱"
              placeholderTextColor={aiTokens.muted} value={query} onChangeText={setQuery}
              autoCorrect={false} style={field} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {homeworkFilters.map(({ value, label }) => (
                <Pressable key={value} accessibilityRole="button"
                  accessibilityLabel={`${label}，${homeworkCounts[value]} 份`}
                  accessibilityState={{ selected: homeworkFilter === value }}
                  onPress={() => setHomeworkFilter(value)}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12,
                    borderRadius: 8, borderWidth: 1,
                    borderColor: homeworkFilter === value ? aiTokens.ai : aiTokens.border,
                    backgroundColor: homeworkFilter === value ? aiTokens.aiSoft : aiTokens.surface }}>
                  <Text style={{ color: aiTokens.text, fontSize: 14 }}>{label} {homeworkCounts[value]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ ...copy, fontSize: 12, color: aiTokens.muted }}>
              待繳交與狀態待確認優先，按截止時間排列。
            </Text>
            {homework.map((row) => (
              <AIRow
                key={`${row.courseId}:${row.id}`}
                title={row.title}
                subtitle={`${row.courseName} · ${row.deadlineLabel || tronClassNativeTime(row.deadline)} · ${row.submitted === true ? '已繳交' : row.submitted === false ? '未繳交' : '狀態待確認'}`}
                onPress={() => chooseAssignment(row)}
              />
            ))}
            {!homework.length && !courseLoading ? (
              <Text style={copy}>
                {snapshot.partial
                  ? '目前已讀到的資料中沒有符合條件的作業；仍有資料未完成。'
                  : '目前沒有符合條件的作業。'}
              </Text>
            ) : null}
            {drafts.length > 0 ? <View>
              <Text style={copy}>本頁保留 {drafts.length} 份作業草稿；繳交結果請開啟作業查證。最多保留 {MAX_LOCAL_DRAFTS} 份。</Text>
              {drafts.map((draft) => {
                const target = snapshot.homework.find((row) => row.courseId === draft.courseId && row.id === draft.homeworkId);
                return <View key={`${draft.courseId}:${draft.homeworkId}`}>
                  <Text style={copy}>{target?.title ?? '待重新確認的作業'}</Text>
                  <AIButton
                    label={drafts.length === 1 ? '恢復本頁作業草稿' : `繼續編輯 ${target?.title ?? '待確認的作業'}`}
                    disabled={!target || !ready}
                    onPress={() => { if (target) chooseAssignment(target); }}
                  />
                  <AIButton
                    label={drafts.length === 1 ? '丟棄保留的草稿' : `丟棄 ${target?.title ?? '待確認的作業'} 的草稿`}
                    variant="ghost"
                    onPress={() => rememberDraft(null, draft.courseId, draft.homeworkId)}
                  />
                </View>;
              })}
            </View> : null}
          </AICard>
          {snapshot.announcements.filter((row) => courseId === null || row.courseId === courseId)
            .length ? (
            <AICard title="校方公告">
              {snapshot.announcements
                .filter((row) => courseId === null || row.courseId === courseId)
                .map((row) => (
                  <View key={`${row.courseId}:${row.id}`} style={{ marginBottom: 12 }}>
                    <Text style={{ ...copy, fontWeight: '600' }}>{row.title}</Text>
                    <Text style={copy}>
                      {row.courseName} · {tronClassNativeTime(row.publishedAt)}
                    </Text>
                    <Text selectable style={copy}>
                      {row.content}
                    </Text>
                  </View>
                ))}
            </AICard>
          ) : null}
          {snapshot.materials.filter((row) => courseId === null || row.courseId === courseId)
            .length ? (
            <AICard title="校方教材">
              {snapshot.materials
                .filter((row) => courseId === null || row.courseId === courseId)
                .map((row) => (
                  <View key={`${row.courseId}:${row.id}`} style={{ marginBottom: 12 }}>
                    <Text style={copy}>
                      {row.title} · {row.courseName}
                    </Text>
                    {row.files.map((file, index) => (
                      <View key={index}>
                        <Text style={copy}>
                          {file.name}
                          {file.allowDownload ? '' : '（校方未開放下載）'}
                        </Text>
                        {nativeTronClassDownloadTarget(row, file, connection.revision!) ? (
                          <AIButton
                            label={`下載並分享：${file.name}`}
                            variant="ghost"
                            onPress={() => void downloadMaterial(row, file)}
                          />
                        ) : null}
                      </View>
                    ))}
                    {safeTronClassSourceHref(row.href) ? (
                      <AIButton
                        label={`查看教材原頁：${row.title}`}
                        variant="ghost"
                        onPress={() => {
                          if (!current()) return;
                          void Linking.openURL(safeTronClassSourceHref(row.href)!).catch(() => {
                            if (current()) setError('無法開啟教材原頁。');
                          });
                        }}
                      />
                    ) : null}
                  </View>
                ))}
            </AICard>
          ) : null}
        </>
      ) : null}
    </AIScreen>
  );
}
