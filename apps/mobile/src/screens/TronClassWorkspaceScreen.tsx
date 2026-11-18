import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Text, TextInput, View } from 'react-native';
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
  tronClassUploadQuery,
} from '../services/tronClassNativeTransport';
import type {
  TronClassConnection,
  TronClassHomework,
  TronClassLocalDraft,
  TronClassSnapshot,
} from '../services/tronClassIntegrationTypes';
import {
  TronClassAssignmentPanel,
  tronClassNativeTime,
} from './tronclass/TronClassAssignmentPanel';
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

/** One independently verified BFF owner, with platform-session precedence over Firebase. */
export function TronClassWorkspaceScreen() {
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
          request: (input) => latest.current.platform.bffRequest('tronclass', context, input),
          download: (input) => latest.current.platform.tronClassDownload(input, context),
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
        request: (input) =>
          nativeTronClassFirebaseRequest(uid, isCurrent, input, controller.signal),
        download: (input) =>
          nativeTronClassFirebaseDownload(uid, isCurrent, input, controller.signal),
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
  const [connection, setConnection] = useState<TronClassConnection | null>(null);
  const [snapshot, setSnapshot] = useState<TronClassSnapshot | null>(null);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('正在讀取連接狀態…');
  const [error, setError] = useState('');
  const [statusKnown, setStatusKnown] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [selected, setSelected] = useState<TronClassHomework | null>(null);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [draft, setDraft] = useState<TronClassLocalDraft | null>(null);
  const [courseLoading, setCourseLoading] = useState(false);
  const [fileCache] = useState(() => new NativeTronClassFileCache());
  const courseRequest = useRef(0);
  const latestConnection = useRef(connection);
  latestConnection.current = connection;
  const draftIdentity = useRef<string | null>(null);
  const rememberedKey = useRef<string | null>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const current = () => mounted.current && client.isCurrent();
  const clearDraft = () => {
    fileCache.clear();
    setDraft(null);
    draftIdentity.current = null;
  };
  function acceptConnection(value: TronClassConnection) {
    const key =
      value.connected && /^[a-f0-9]{64}$/.test(value.studentKey ?? '') ? value.studentKey! : null;
    if (value.connected && (!key || (draftIdentity.current && draftIdentity.current !== key)))
      clearDraft();
    if (!value.connected && value.revision === null) clearDraft();
    rememberedKey.current = key;
    setConnection(value);
    setStatusKnown(true);
    setAccount(value.account || '');
    setReconnecting(!value.connected);
  }
  async function synchronize(value: TronClassConnection) {
    if (!value.connected || !value.revision) return;
    setBusy('正在讀取課程、作業與教材…');
    const data = await client.sync(value.revision);
    if (current()) setSnapshot(data);
  }
  function lost(failure: unknown) {
    ++courseRequest.current;
    setCourseLoading(false);
    setPassword('');
    setSelected(null);
    setSnapshot(null);
    setCourseId(null);
    setAssignmentBusy(false);
    setStatusKnown(false);
    setReconnecting(true);
    setError(nativeTronClassError(failure));
    if (!rememberedKey.current && !draftIdentity.current) clearDraft();
    // Keep only local text and URI handles. Revisions, preparations and confirmations are discarded.
    rememberedKey.current = null;
    setConnection(null);
  }
  async function load() {
    if (lock.current || assignmentBusy || !current()) return;
    lock.current = true;
    ++courseRequest.current;
    setCourseLoading(false);
    if (!rememberedKey.current && !draftIdentity.current) clearDraft();
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
      await synchronize(value);
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
      if (state !== 'active') setPassword('');
    });
    return () => {
      mounted.current = false;
      rememberedKey.current = null;
      draftIdentity.current = null;
      fileCache.dispose();
      subscription.remove();
    };
    // The enclosing route remounts this workspace synchronously on owner/context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
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
    ++courseRequest.current;
    setCourseLoading(false);
    setBusy('正在驗證校方帳號…');
    setError('');
    setSelected(null);
    setSnapshot(null);
    setCourseId(null);
    try {
      const value = await client.connect(account, secret, connection?.revision ?? null);
      if (!current()) return;
      acceptConnection(value);
      setReconnecting(false);
      await synchronize(value);
    } catch (failure) {
      if (!current()) return;
      // A lost reply may have changed the binding. A status read must precede another attempt.
      setConnection(null);
      rememberedKey.current = null;
      setStatusKnown(false);
      setReconnecting(true);
      setError(nativeTronClassError(failure));
    } finally {
      lock.current = false;
      if (current()) setBusy('');
    }
  }
  async function disconnect() {
    if (lock.current || assignmentBusy || !current() || !statusKnown || !connection) return;
    lock.current = true;
    ++courseRequest.current;
    setCourseLoading(false);
    setBusy('正在解除連接…');
    setError('');
    clearDraft();
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
    if (
      !current() ||
      lock.current ||
      assignmentBusy ||
      !connection?.connected ||
      !connection.revision ||
      !snapshot
    )
      return;
    if (target !== null && !snapshot.courses.some((course) => course.id === target)) return;
    const expectedRevision = connection.revision;
    const run = ++courseRequest.current;
    setCourseId(target);
    setSelected(null);
    setCourseLoading(true);
    setError('');
    // Keep the same owner's course directory, but never show the previous course's content while loading.
    setSnapshot({
      ...snapshot,
      homework: [],
      announcements: [],
      materials: [],
      errors: [],
      partial: false,
    });
    const matches = () =>
      current() &&
      courseRequest.current === run &&
      latestConnection.current?.revision === expectedRevision;
    try {
      const value = await client.sync(expectedRevision, target ?? undefined);
      if (matches()) setSnapshot(value);
    } catch (failure) {
      if (!matches()) return;
      if (tronClassConnectionLost(failure)) lost(failure);
      else {
        const message = nativeTronClassError(failure);
        setError(message);
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                partial: true,
                errors: [{ courseId: target, area: 'courses', message }],
              }
            : null,
        );
      }
    } finally {
      if (matches()) setCourseLoading(false);
    }
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
  const courses = snapshot?.courses ?? [];
  const homework =
    snapshot?.homework.filter((row) => courseId === null || row.courseId === courseId) ?? [];
  const chooseAssignment = (row: TronClassHomework) => {
    if (!ready || assignmentBusy || !current()) return;
    if (draft && (draft.courseId !== row.courseId || draft.homeworkId !== row.id)) clearDraft();
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
        </AICard>
      ) : null}
      {error ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ ...copy, color: aiTokens.danger }}>
            {error}
          </Text>
        </AICard>
      ) : null}
      {draft && !ready ? (
        <AICard title="本頁草稿等待恢復">
          <Text style={copy}>
            重新連接經校方驗證的同一帳號後，可在同一份作業恢復文字與附件；送出權限會重新確認。
          </Text>
          <AIButton label="丟棄保留的草稿" variant="ghost" disabled={!!busy} onPress={clearDraft} />
        </AICard>
      ) : null}
      {ready && selected ? (
        <TronClassAssignmentPanel
          key={`${connection.revision}:${selected.courseId}:${selected.id}`}
          client={client}
          fileCache={fileCache}
          revision={connection.revision!}
          homework={selected}
          initialDraft={
            draftIdentity.current === connection.studentKey &&
            draft?.courseId === selected.courseId &&
            draft.homeworkId === selected.id
              ? draft
              : undefined
          }
          onDraftChange={(value) => {
            if (!current()) return;
            fileCache.retain(value?.files ?? []);
            const key = rememberedKey.current;
            if (!key) {
              setDraft(null);
              draftIdentity.current = null;
              return;
            }
            draftIdentity.current = key;
            setDraft(value);
          }}
          onBusy={setAssignmentBusy}
          onConnectionLost={lost}
          onClose={() => {
            setSelected(null);
            clearDraft();
          }}
        />
      ) : null}
      {catalogReady && !selected ? (
        <>
          <AICard title="我的校方課程">
            <Text style={copy}>更新時間：{tronClassNativeTime(snapshot.fetchedAt)}</Text>
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
          {courseLoading ? (
            <AICard>
              <ActivityIndicator accessibilityLabel="正在讀取所選課程" />
              <Text style={copy}>正在讀取所選課程的完整作業、公告與教材…</Text>
            </AICard>
          ) : null}
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
                  ? '目前已讀到的資料中沒有作業；仍有資料未完成。'
                  : '目前清單沒有作業。'}
              </Text>
            ) : null}
            {draft ? (
              <AIButton
                label="恢復本頁作業草稿"
                onPress={() => {
                  const target = snapshot.homework.find(
                    (row) => row.courseId === draft.courseId && row.id === draft.homeworkId,
                  );
                  if (target) chooseAssignment(target);
                  else setError('最新清單未找到原作業，請重新整理或到校方確認。');
                }}
              />
            ) : null}
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
