import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Switch, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassSubmissionHistoryEntry } from '@campus/shared/src/tronClassSubmissionHistory';
import {
  discardTronClassPickerCopies,
  type NativeTronClassFileCache,
} from '../../services/tronClassNativeFileCache';
import { AIButton, AICard, aiTokens } from '../../ui/aiFirst';
import {
  nativeTronClassError,
  nativeTronClassSubmissionDownloadTarget,
  safeTronClassSourceHref,
  tronClassConnectionLost,
  type NativeTronClassClient,
} from '../../services/tronClassIntegration';
import {
  clearNativeTronClassPending,
  nativeTronClassLimits,
  nativeTronClassPayloadIssue,
  nativeTronClassSize,
  readNativeTronClassFile,
  readNativeTronClassPending,
  saveNativeTronClassPending,
} from '../../services/tronClassNativeDraft';
import type {
  TronClassHomework,
  TronClassLocalDraft,
  TronClassLocalFile,
  TronClassPreparation,
  TronClassResult,
} from '../../services/tronClassIntegrationTypes';

type Phase = 'editing' | 'preview' | 'sending' | 'unknown' | 'finished';
const body = { color: aiTokens.text, lineHeight: 23, marginBottom: 10 };
export function tronClassNativeTime(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
    : '未提供';
}
function confirmationScope(preparation: TronClassPreparation) {
  // A new read timestamp is expected; only material school rules invalidate confirmation.
  const details =
    preparation.details?.status === 'available'
      ? { ...preparation.details, fetchedAt: undefined }
      : preparation.details;
  return JSON.stringify([
    preparation.revision,
    preparation.courseId,
    preparation.homeworkId,
    preparation.title,
    preparation.description,
    preparation.deadline,
    preparation.canSubmit,
    preparation.rules,
    preparation.maxFiles,
    preparation.maxFileBytes,
    preparation.allowedContentTypes,
    details,
  ]);
}

export function TronClassAssignmentPanel({
  client,
  fileCache,
  revision,
  homework,
  initialDraft,
  onDraftChange,
  onConnectionLost,
  onBusy,
  isBindingCurrent,
  onSubmitted,
  onClose,
}: {
  client: NativeTronClassClient;
  fileCache: NativeTronClassFileCache;
  revision: string;
  homework: TronClassHomework;
  initialDraft?: TronClassLocalDraft;
  onDraftChange(draft: TronClassLocalDraft | null): void;
  onConnectionLost(error: unknown): void;
  onBusy(value: boolean): void;
  isBindingCurrent(): boolean;
  onSubmitted(): void;
  onClose(): void;
}) {
  const [preparation, setPreparation] = useState<TronClassPreparation | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<TronClassLocalFile[]>([]);
  const [phase, setPhase] = useState<Phase>('editing');
  const [busy, setBusy] = useState('正在讀取作業…');
  const [error, setError] = useState('');
  const [prepareError, setPrepareError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [journalReady, setJournalReady] = useState(false);
  const [result, setResult] = useState<TronClassResult | null>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const operation = useRef<string | null>(null);
  const draftToRestore = useRef(initialDraft);
  const frozen = useRef(new Map<string, { bytes: Uint8Array; sha256: string }>());
  const pendingDownload = useRef<AbortController | null>(null);
  const callbacks = useRef({ onDraftChange, onConnectionLost, onBusy, onSubmitted, isBindingCurrent });
  callbacks.current = { onDraftChange, onConnectionLost, onBusy, onSubmitted, isBindingCurrent };
  const current = () => mounted.current && client.isCurrent();
  const setWorking = (label: string) => {
    setBusy(label);
    callbacks.current.onBusy(!!label);
  };
  const limits = nativeTronClassLimits(preparation);
  const canSubmit =
    preparation?.canSubmit === true && limits.confirmed && !prepareError && journalReady;
  const remember = (nextContent: string, nextFiles: TronClassLocalFile[]) => {
    callbacks.current.onDraftChange(
      nextContent || nextFiles.length
        ? {
            courseId: homework.courseId,
            homeworkId: homework.id,
            content: nextContent,
            files: nextFiles,
          }
        : null,
    );
  };
  const failed = (failure: unknown) => {
    if (tronClassConnectionLost(failure)) callbacks.current.onConnectionLost(failure);
    else setError(nativeTronClassError(failure));
  };
  async function accept(value: TronClassResult) {
    if (!current()) return;
    if (value.status === 'unknown') {
      frozen.current.clear();
      setPhase('unknown');
      return;
    }
    setResult(value);
    setPhase('finished');
    setConfirmed(false);
    setContent('');
    setFiles([]);
    frozen.current.clear();
    draftToRestore.current = undefined;
    callbacks.current.onDraftChange(null);
    callbacks.current.onSubmitted();
    setError('');
    try {
      await clearNativeTronClassPending(client.owner, homework.courseId, homework.id, value.operationId);
    } catch {
      if (current())
        setNotice('校方結果已確認；裝置上的操作編號尚未清除，再次開啟時仍會核對原紀錄。');
    }
  }
  async function reconcile(operationId: string) {
    try {
      await accept(
        await client.reconcile({
          operationId,
          revision,
          courseId: homework.courseId,
          homeworkId: homework.id,
        }),
      );
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof NuniError && failure.code === 'TRONCLASS_SUBMISSION_NOT_STARTED') {
        // Only an explicit server verdict can release an uncertain operation.
        try {
          await clearNativeTronClassPending(client.owner, homework.courseId, homework.id, operationId);
        } catch {
          setError('已確認未送出，但無法更新裝置紀錄。請再次查詢後再編輯。');
          return;
        }
        if (!current()) return;
        operation.current = null;
        frozen.current.clear();
        setPhase('editing');
        setConfirmed(false);
        setNotice('已確認這次作業未送出，請重新預覽與確認後再繳交。');
      } else failed(failure);
    }
  }
  async function load() {
    if (lock.current || !current()) return;
    lock.current = true;
    setWorking('正在讀取作業與前次操作…');
    setError('');
    setConfirmed(false);
    setJournalReady(false);
    try {
      try {
        operation.current = await readNativeTronClassPending(
          client.owner,
          homework.courseId,
          homework.id,
        );
        if (!current()) return;
        setJournalReady(true);
        if (operation.current) setPhase('unknown');
      } catch {
        if (current())
          setError('無法讀取前次送出紀錄。請重新讀取，確認之前沒有待查操作後才能送出。');
        return;
      }
      try {
        const value = await client.prepare(homework.courseId, homework.id, revision);
        if (!current()) return;
        setPreparation(value);
        setPrepareError('');
        const draft = draftToRestore.current;
        if (draft && draft.courseId === homework.courseId && draft.homeworkId === homework.id) {
          setContent(draft.content);
          setFiles(draft.files.map((file) => ({ ...file, key: Crypto.randomUUID() })));
          draftToRestore.current = undefined;
          setNotice('已恢復此帳號的頁面草稿，請重新預覽；先前的確認與上傳狀態不會沿用。');
        }
      } catch (failure) {
        if (!current()) return;
        setPreparation(null);
        setPrepareError(nativeTronClassError(failure));
        if (tronClassConnectionLost(failure)) {
          callbacks.current.onConnectionLost(failure);
          return;
        }
      }
      if (operation.current && current()) {
        setWorking('正在查證前次送出結果…');
        await reconcile(operation.current);
      }
    } finally {
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  useEffect(() => {
    mounted.current = true;
    const bytes = frozen.current;
    void load();
    return () => {
      mounted.current = false;
      pendingDownload.current?.abort();
      bytes.clear();
      callbacks.current.onBusy(false);
    };
    // The parent keys this panel by verified binding revision and assignment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, revision, homework.courseId, homework.id]);

  async function chooseFiles() {
    if (lock.current || !current() || phase !== 'editing' || !limits.allowsAttachments) return;
    lock.current = true;
    setWorking('正在選擇附件…');
    setError('');
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: '*/*',
      });
      if (selection.canceled) return;
      if (!current()) {
        discardTronClassPickerCopies(selection.assets);
        return;
      }
      const selected = fileCache.adopt(selection.assets);
      const next = [...files, ...selected];
      const issue = nativeTronClassPayloadIssue(content, next, preparation);
      if (issue) {
        fileCache.retain(files);
        setError(issue);
        return;
      }
      setFiles(next);
      remember(content, next);
      frozen.current.clear();
    } catch {
      if (current()) setError('無法讀取選取的附件，請重新選檔。');
    } finally {
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  async function preview() {
    if (
      lock.current ||
      !current() ||
      phase !== 'editing' ||
      !journalReady ||
      operation.current ||
      draftToRestore.current
    )
      return;
    const issue = nativeTronClassPayloadIssue(content, files, preparation);
    if (issue) {
      setError(issue);
      return;
    }
    lock.current = true;
    setWorking('正在準備預覽並重新核對作業…');
    setError('');
    setNotice('');
    setConfirmed(false);
    frozen.current.clear();
    try {
      // Freeze the exact bytes before the user confirms; an external file can change later.
      for (const file of files) {
        const read = await readNativeTronClassFile(file);
        if (!current()) return;
        frozen.current.set(file.key, read);
      }
      let latest: TronClassPreparation | null = null;
      try {
        latest = await client.prepare(homework.courseId, homework.id, revision);
        if (!current()) return;
        setPreparation(latest);
        setPrepareError('');
      } catch (failure) {
        if (!current()) return;
        setPreparation(null);
        setPrepareError(nativeTronClassError(failure));
        if (tronClassConnectionLost(failure)) {
          callbacks.current.onConnectionLost(failure);
          return;
        }
      }
      const latestIssue = nativeTronClassPayloadIssue(content, files, latest);
      if (latestIssue) {
        setError(latestIssue);
        frozen.current.clear();
        return;
      }
      setPhase('preview');
    } catch {
      if (current()) setError('附件已變更或無法讀取。請移除後重新選檔，再預覽作業。');
    } finally {
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  async function submit() {
    if (
      lock.current ||
      !current() ||
      phase !== 'preview' ||
      !confirmed ||
      !canSubmit ||
      !preparation ||
      operation.current
    )
      return;
    lock.current = true;
    setWorking('正在重新確認繳交條件…');
    setError('');
    let journalSaved = false;
    try {
      const latest = await client.prepare(homework.courseId, homework.id, revision);
      if (!current()) return;
      setPreparation(latest);
      const issue = nativeTronClassPayloadIssue(content, files, latest, true);
      if (
        !latest.canSubmit ||
        issue ||
        confirmationScope(latest) !== confirmationScope(preparation)
      ) {
        setConfirmed(false);
        setError(issue || '校方作業條件已變更，請查看最新要求並重新確認。');
        return;
      }
      if (files.some((file) => !frozen.current.has(file.key))) {
        setError('附件預覽已失效，請返回編輯後重新預覽。');
        return;
      }
      const operationId = Crypto.randomUUID();
      try {
        await saveNativeTronClassPending(client.owner, homework.courseId, homework.id, operationId);
      } catch {
        setJournalReady(false);
        setError('無法保留送出查證編號，這次尚未送出。請重新讀取作業後再試。');
        return;
      }
      journalSaved = true;
      operation.current = operationId;
      if (!current()) return;
      setPhase('sending');
      const attachments: string[] = [];
      for (const file of files) {
        if (!current()) return;
        setWorking(`正在上傳 ${file.name}…`);
        const stored = frozen.current.get(file.key)!;
        const uploaded = await client.upload(
          {
            courseId: homework.courseId,
            homeworkId: homework.id,
            revision,
            operationId,
            fileId: Crypto.randomUUID(),
            name: file.name,
          },
          stored.bytes,
          file.contentType,
          stored.sha256,
        );
        if (!current()) return;
        attachments.push(uploaded.fileId);
      }
      if (!current()) return;
      setWorking('正在送出作業並等待校方確認…');
      await accept(
        await client.submit({
          courseId: homework.courseId,
          homeworkId: homework.id,
          revision,
          operationId,
          content,
          attachments,
          confirmed: true,
        }),
      );
    } catch (failure) {
      if (!current()) return;
      setConfirmed(false);
      if (journalSaved) {
        frozen.current.clear();
        setPhase('unknown');
      }
      failed(failure);
    } finally {
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  async function check() {
    if (lock.current || !current() || !operation.current) return;
    lock.current = true;
    setWorking('正在查證原操作…');
    setError('');
    try {
      await reconcile(operation.current);
    } finally {
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  async function cancelPreparation() {
    if (lock.current || !current() || phase !== 'unknown' || !operation.current) return;
    const operationId = operation.current;
    const matches = () => current() && operation.current === operationId &&
      callbacks.current.isBindingCurrent();
    const expireIfNeeded = () => {
      if (current() && !callbacks.current.isBindingCurrent())
        callbacks.current.onConnectionLost(new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED'));
    };
    if (!matches()) {
      expireIfNeeded();
      return;
    }
    lock.current = true;
    setWorking('正在停止尚未送出的準備…');
    setError('');
    setNotice('');
    try {
      const cancellation = await client.cancelPreparation({
        courseId: homework.courseId,
        homeworkId: homework.id,
        revision,
        operationId,
      });
      if (!matches()) {
        expireIfNeeded();
        return;
      }
      if (cancellation.status !== 'cancelled') {
        setNotice('這次操作可能已進入正式送出，請繼續查詢原送出結果。');
        return;
      }
      try {
        await clearNativeTronClassPending(client.owner, homework.courseId, homework.id, operationId);
      } catch (failure) {
        if (matches()) setError(failure instanceof Error && failure.message === 'PENDING_OPERATION_CONFLICT'
          ? '裝置已有另一筆待查操作，請返回作業清單再開啟，先查證該筆紀錄。'
          : '已停止準備，但無法更新裝置紀錄。請再次停止準備後再編輯。');
        else expireIfNeeded();
        return;
      }
      if (!matches()) {
        expireIfNeeded();
        return;
      }
      operation.current = null;
      frozen.current.clear();
      setConfirmed(false);
      setResult(null);
      setPhase('editing');
      setNotice('已停止尚未送出的準備，文字與附件已保留。請重新預覽與確認後再繳交。');
    } catch (failure) {
      if (matches()) failed(failure);
      else expireIfNeeded();
    } finally {
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  async function downloadHistoryAttachment(
    entry: TronClassSubmissionHistoryEntry,
    file: TronClassSubmissionHistoryEntry['attachments'][number],
  ) {
    if (lock.current || !current() || !preparation || !client.downloadSubmissionAttachment) return;
    const target = nativeTronClassSubmissionDownloadTarget(preparation, entry, file, revision);
    if (!target) return;
    const expireIfNeeded = () => {
      if (current() && !callbacks.current.isBindingCurrent())
        callbacks.current.onConnectionLost(new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED'));
    };
    if (!callbacks.current.isBindingCurrent()) {
      expireIfNeeded();
      return;
    }
    const controller = new AbortController();
    pendingDownload.current = controller;
    lock.current = true;
    setWorking(`正在下載作業附件 ${file.name}…`);
    setError('');
    setNotice('');
    const matches = () => current() && !controller.signal.aborted && callbacks.current.isBindingCurrent();
    try {
      const downloaded = await client.downloadSubmissionAttachment(target, controller.signal);
      if (!matches()) {
        if (!controller.signal.aborted) expireIfNeeded();
        return;
      }
      await fileCache.share(downloaded, matches);
      if (matches()) setNotice('已開啟作業附件分享。');
    } catch (failure) {
      if (!matches()) {
        if (!controller.signal.aborted) expireIfNeeded();
        return;
      }
      failed(failure);
    } finally {
      if (pendingDownload.current === controller) pendingDownload.current = null;
      lock.current = false;
      if (current()) setWorking('');
    }
  }
  const source = safeTronClassSourceHref(homework.href);
  const details = preparation?.details?.status === 'available' ? preparation.details : null;
  const displayTitle = preparation ? preparation.title : homework.title;
  return (
    <View>
      <AICard title={displayTitle}>
        <Text style={body}>{homework.courseName}</Text>
        <Text selectable style={body}>
          {(preparation ? preparation.description : homework.description) ||
            '校方尚未提供文字說明。'}
        </Text>
        <Text style={body}>
          截止時間：{tronClassNativeTime(preparation ? preparation.deadline : homework.deadline)}
        </Text>
        <Text style={body}>
          目前清單狀態：
          {homework.submitted === true
            ? '已繳交'
            : homework.submitted === false
              ? '未繳交'
              : '尚未確認'}
        </Text>
        {details ? (
          <>
            <Text style={body}>
              作業類型：
              {details.submissionType === 'group'
                ? '小組'
                : details.submissionType === 'individual'
                  ? '個人'
                  : '尚未確認'}
            </Text>
            <Text style={body}>開放時間：{tronClassNativeTime(details.opensAt)}</Text>
            <Text style={body}>
              作業是否關閉：
              {details.isClosed === null ? '尚未確認' : details.isClosed ? '已關閉' : '尚未關閉'}
            </Text>
            <Text style={body}>
              已用次數：{details.attempts.used ?? '未提供'}；剩餘次數：
              {details.attempts.unlimited === true
                ? '校方未設上限'
                : (details.attempts.remaining ?? '未提供')}
            </Text>
            <Text style={body}>
              重交是否開放：
              {details.resubmissionOpen === null
                ? '尚未確認'
                : details.resubmissionOpen
                  ? '開放'
                  : '未開放'}
            </Text>
          </>
        ) : (
          <Text style={body}>尚未取得完整的開放時間、次數與重交規則。</Text>
        )}
        <AIButton label="返回作業清單" variant="ghost" disabled={!!busy} onPress={onClose} />
      </AICard>
      {busy ? (
        <AICard>
          <ActivityIndicator accessibilityLabel={busy} />
          <Text accessibilityLiveRegion="polite" style={body}>
            {busy}
          </Text>
        </AICard>
      ) : null}
      {prepareError ? (
        <AICard>
          <Text accessibilityRole="alert" style={body}>
            {prepareError}
          </Text>
        </AICard>
      ) : null}
      {error ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ ...body, color: aiTokens.danger }}>
            {error}
          </Text>
        </AICard>
      ) : null}
      {notice ? (
        <AICard>
          <Text accessibilityLiveRegion="polite" style={body}>
            {notice}
          </Text>
        </AICard>
      ) : null}
      {phase === 'unknown' ? (
        <AICard title="前次送出結果待確認">
          <Text style={body}>已保留原操作編號。再次查詢只會核對原紀錄，不會重送作業。</Text>
          <Text selectable style={body}>
            操作編號：{operation.current}
          </Text>
          <AIButton label="查詢原送出結果" disabled={!!busy} onPress={() => void check()} />
          <Text style={body}>只有尚未正式送出的準備可以停止；已進入送出的操作仍會保留查證。</Text>
          <AIButton label="停止準備並返回編輯" variant="ghost" disabled={!!busy}
            onPress={() => void cancelPreparation()} />
        </AICard>
      ) : null}
      {phase === 'finished' && result && result.status !== 'unknown' ? (
        <AICard title={result.status === 'confirmed' ? '已確認校方版本' : '校方已確認繳交'}>
          {result.status === 'confirmed' ? (
            <>
              <Text style={body}>校方版本：{result.confirmation.submissionId}</Text>
              <Text style={body}>
                確認時間：{tronClassNativeTime(result.confirmation.confirmedAt)}
              </Text>
              <Text style={body}>
                來源紀錄時間：{tronClassNativeTime(result.confirmation.sourceRecordedAt)}
              </Text>
            </>
          ) : (
            <>
              <Text style={body}>繳交編號：{result.receipt?.id}</Text>
              <Text style={body}>
                繳交時間：{tronClassNativeTime(result.receipt?.submittedAt ?? null)}
              </Text>
            </>
          )}
          <Text selectable style={body}>
            操作編號：{result.operationId}
          </Text>
        </AICard>
      ) : null}
      {phase === 'editing' || phase === 'preview' ? (
        <AICard title={phase === 'preview' ? '確認這次作業內容' : '整理作業'}>
          {!canSubmit ? (
            <Text style={body}>
              {preparation?.blockedReason || '目前可在 App 整理與預覽，校方可繳交狀態尚未確認。'}
            </Text>
          ) : null}
          <Text style={body}>
            {limits.confirmed
              ? `校方已確認：${limits.allowsText ? '接受文字' : '不接受文字'}，${limits.allowsAttachments ? '接受附件' : '不接受附件'}。`
              : '尚未確認校方格式要求；以下僅是本機草稿。'}
          </Text>
          <Text style={body}>
            附件最多 {limits.maxFiles} 個、每個 {nativeTronClassSize(limits.maxFileBytes)}、合計{' '}
            {nativeTronClassSize(limits.maxTotalBytes)}。
          </Text>
          {limits.contentTypes.length ? (
            <Text style={body}>接受格式：{limits.contentTypes.join('、')}</Text>
          ) : null}
          {phase === 'editing' ? (
            <>
              <TextInput
                accessibilityLabel="作業內容"
                multiline
                value={content}
                maxLength={20000}
                editable={!busy && limits.allowsText && !draftToRestore.current}
                onChangeText={(value) => {
                  if (!current() || lock.current) return;
                  setContent(value);
                  remember(value, files);
                  frozen.current.clear();
                }}
                placeholder="輸入作業內容"
                placeholderTextColor={aiTokens.muted}
                style={{
                  borderWidth: 1,
                  borderColor: aiTokens.border,
                  borderRadius: 12,
                  minHeight: 150,
                  padding: 12,
                  color: aiTokens.text,
                  textAlignVertical: 'top',
                }}
              />
              <AIButton
                label="選擇作業附件"
                variant="ghost"
                disabled={
                  !!busy ||
                  !limits.allowsAttachments ||
                  !limits.maxFiles ||
                  !!draftToRestore.current
                }
                onPress={() => void chooseFiles()}
              />
            </>
          ) : (
            <Text selectable style={body}>
              {content || '這次作業只有附件。'}
            </Text>
          )}
          {files.map((file) => (
            <View key={file.key} style={{ marginVertical: 8 }}>
              <Text style={body}>
                {file.name} · {nativeTronClassSize(file.size)}
              </Text>
              {phase === 'editing' ? (
                <AIButton
                  label={`移除 ${file.name}`}
                  variant="ghost"
                  disabled={!!busy}
                  onPress={() => {
                    if (!current() || lock.current) return;
                    const next = files.filter((value) => value.key !== file.key);
                    setFiles(next);
                    remember(content, next);
                    frozen.current.clear();
                  }}
                />
              ) : null}
            </View>
          ))}
          {phase === 'editing' ? (
            <>
              <AIButton
                label="預覽並重新核對"
                disabled={!!busy || !journalReady || !!draftToRestore.current}
                onPress={() => void preview()}
              />
              <AIButton
                label="重新讀取作業"
                variant="ghost"
                disabled={!!busy}
                onPress={() => void load()}
              />
              <AIButton
                label="丟棄本頁草稿"
                variant="ghost"
                disabled={!!busy}
                onPress={() => {
                  if (!current() || lock.current) return;
                  setContent('');
                  setFiles([]);
                  setConfirmed(false);
                  draftToRestore.current = undefined;
                  frozen.current.clear();
                  remember('', []);
                  setNotice('已清除本頁草稿。');
                }}
              />
            </>
          ) : (
            <>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 }}
              >
                <Switch
                  accessibilityLabel="我已確認要把這份作業送至校方"
                  value={confirmed}
                  disabled={!!busy || !canSubmit}
                  onValueChange={(value) => {
                    if (current() && !lock.current) setConfirmed(value);
                  }}
                />
                <Text style={{ ...body, flex: 1 }}>
                  我已確認課程、作業、內容與附件，要送至校方。
                </Text>
              </View>
              <AIButton
                label="確認並繳交至 TronClass"
                disabled={!!busy || !canSubmit || !confirmed}
                onPress={() => void submit()}
              />
              <AIButton
                label="返回編輯"
                variant="ghost"
                disabled={!!busy}
                onPress={() => {
                  setPhase('editing');
                  setConfirmed(false);
                  frozen.current.clear();
                }}
              />
            </>
          )}
          <Text style={{ ...body, marginTop: 12 }}>
            文字草稿只保留在本頁；附件使用 App 暫存副本，移除、丟棄、完成繳交或離頁時會清除。關閉
            App 後草稿不會恢復。
          </Text>
          {content ? (
            <AIButton
              label="複製作業文字"
              variant="ghost"
              disabled={!!busy}
              onPress={() => {
                if (!current()) return;
                void Clipboard.setStringAsync(content).then(
                  () => {
                    if (current()) setNotice('已複製作業文字。');
                  },
                  () => {
                    if (current()) setError('無法複製，請手動選取文字。');
                  },
                );
              }}
            />
          ) : null}
        </AICard>
      ) : null}
      {preparation?.receipt ? (
        <AICard title="先前已確認的繳交回條">
          <Text style={body}>編號：{preparation.receipt.id}</Text>
          <Text style={body}>繳交時間：{tronClassNativeTime(preparation.receipt.submittedAt)}</Text>
        </AICard>
      ) : null}
      {preparation?.history ? (
        <AICard title="校方歷次作業紀錄">
          <Text style={body}>
            {preparation.history.state === 'available'
              ? '歷次紀錄僅供參考，不代表這次草稿已送出。'
              : preparation.history.state === 'group-unsupported'
                ? '小組作業的個人歷次紀錄目前無法確認。'
                : '目前無法讀取歷次紀錄。'}
          </Text>
          {preparation.history.entries.map((entry) => (
            <View key={entry.id} style={{ marginVertical: 8 }}>
              <Text style={body}>
                版本 {entry.id}
                {entry.isLatest ? '（校方標示最新）' : ''} ·{' '}
                {
                  {
                    submitted: '已繳交',
                    draft: '草稿',
                    returned: '退回',
                    'teacher-marked': '教師標記',
                    unknown: '未確認',
                  }[entry.state]
                }
              </Text>
              <Text style={body}>來源紀錄時間：{tronClassNativeTime(entry.createdAt)}</Text>
              {entry.content ? (
                <Text selectable style={body}>
                  {entry.content}
                  {entry.contentTruncated ? '\n（內容已截短）' : ''}
                </Text>
              ) : null}
              {entry.attachments.map((file, index) => (
                <View key={index}>
                  <Text style={body}>
                    {file.name}
                    {file.size === null ? '' : ` · ${nativeTronClassSize(file.size)}`}
                  </Text>
                  {client.downloadSubmissionAttachment &&
                    nativeTronClassSubmissionDownloadTarget(preparation, entry, file, revision) ? (
                    <AIButton label={`下載並分享作業附件：${file.name}`} variant="ghost" disabled={!!busy}
                      onPress={() => void downloadHistoryAttachment(entry, file)} />
                  ) : null}
                </View>
              ))}
              {entry.hasOtherResources ? (
                <Text style={body}>另有校方資源，請至原頁查看。</Text>
              ) : null}
            </View>
          ))}
          {preparation.history.state === 'available' && !preparation.history.entries.length ? (
            <Text style={body}>校方目前未提供歷次紀錄。</Text>
          ) : null}
        </AICard>
      ) : null}
      {source ? (
        <AICard>
          <AIButton
            label="到校方原頁確認與繳交"
            variant="ghost"
            disabled={!!busy}
            onPress={() => {
              if (!current()) return;
              void Linking.openURL(source).catch(() => {
                if (current()) setError('無法開啟校方原頁，請稍後再試。');
              });
            }}
          />
        </AICard>
      ) : null}
    </View>
  );
}
