import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { AIDetailScreen, AICard, AIButton, AIChip } from '../ui/aiFirst';
import QRCode from 'react-native-qrcode-svg';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { buildAddFriendDeepLink } from '../utils/campusFriendLink';
import { safeNavigate } from '../utils/safeNavigate';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import { joinCampusGroupFromQr, parseCampusQrAction } from '../features/qrActions';

type Props = {
  navigation?: Parameters<typeof safeNavigate>[0] & {
    goBack?: () => void;
    setOptions?: (options: { headerShown: boolean }) => void;
  };
  route?: { params?: { openScanMode?: boolean } };
};

export function QRCodeScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const { school } = useSchool();
  useLayoutEffect(() => navigation?.setOptions?.({ headerShown: false }), [navigation]);
  return (
    <QrWorkspace
      key={JSON.stringify([user?.uid, school.id])}
      uid={user?.uid}
      schoolId={school.id}
      navigation={navigation}
      openScanMode={Boolean(route?.params?.openScanMode)}
    />
  );
}

function QrWorkspace({
  uid,
  schoolId,
  navigation,
  openScanMode,
}: {
  uid?: string;
  schoolId: string;
  navigation: Props['navigation'];
  openScanMode: boolean;
}) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'profile' | 'scan' | 'text'>(openScanMode ? 'scan' : 'profile');
  const [cameraActive, setCameraActive] = useState(false);
  const [draft, setDraft] = useState('');
  const [scan, setScan] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState<{ groupId: string; name: string } | null>(null);
  const active = useRef(true);
  const operation = useRef(false);
  const scanned = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      revision.current += 1;
    };
  }, []);
  useEffect(() => {
    if (openScanMode) setMode('scan');
  }, [openScanMode]);
  const action = useMemo(() => parseCampusQrAction(scan), [scan]);
  const generated = mode === 'profile' ? (uid ? buildAddFriendDeepLink(uid) : '') : content.trim();
  const body = { ...theme.typography.bodySmall, color: theme.colors.muted };
  const inputStyle = {
    ...theme.typography.body,
    color: theme.colors.text,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    minHeight: 48,
  };
  const go = (screen: string, params?: Record<string, unknown>) =>
    safeNavigate(navigation, screen, params);
  const setResult = (raw: string) => {
    revision.current += 1;
    setScan(raw.trim());
    setError('');
    setJoined(null);
    setCameraActive(false);
  };
  const startScan = async () => {
    if (operation.current || !active.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const next = permission?.granted ? permission : await requestPermission();
      if (!active.current) return;
      if (!next?.granted) {
        setError('尚未取得相機權限。你可以在裝置設定開啟，或貼上 QR 碼內容。');
        return;
      }
      scanned.current = false;
      setCameraActive(true);
    } catch {
      if (active.current) setError('無法開啟相機，請稍後重試或貼上 QR 碼內容。');
    } finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  };
  const join = async () => {
    if (operation.current || !active.current || action.kind !== 'group' || joined) return;
    if (!uid) {
      setError('請先登入，再確認是否加入這個群組。');
      return;
    }
    const request = revision.current;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await joinCampusGroupFromQr({ uid, schoolId, joinCode: action.joinCode });
      if (active.current && request === revision.current) setJoined(result);
    } catch {
      if (active.current && request === revision.current)
        setError('尚未確認已加入群組。請到群組列表確認，或檢查登入、學校與邀請碼後重試。');
    } finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  };
  const openLink = async () => {
    if (operation.current || !active.current || action.kind !== 'link') return;
    const request = revision.current;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const opened = await linkingOpenWithPuTronClassGate(action.url);
      if (!opened && active.current && request === revision.current)
        setError('未開啟連結。請確認登入狀態、網路與網址後再試。');
    } catch {
      if (active.current && request === revision.current)
        setError('無法開啟這個連結，請稍後重試。');
    } finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  };
  const share = async () => {
    if (!generated || operation.current || !active.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await Share.share({ message: generated });
    } catch {
      if (active.current) Alert.alert('無法分享', '請稍後再試。');
    } finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <AIDetailScreen
      title="QR 碼"
      subtitle="分享聯絡方式，或掃描後確認要執行的操作。"
      onBack={() => navigation?.goBack?.()}
    >
      <AICard>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
          {(
            [
              ['profile', '我的名片'],
              ['scan', '掃描 QR 碼'],
              ['text', '分享內容'],
            ] as const
          ).map(([key, label]) => (
            <AIChip
              key={key}
              label={label}
              active={mode === key}
              onPress={
                busy
                  ? undefined
                  : () => {
                      setMode(key);
                      setCameraActive(false);
                      setError('');
                    }
              }
            />
          ))}
        </View>
      </AICard>
      {mode !== 'scan' ? (
        <AICard title={mode === 'profile' ? '我的加好友連結' : '要分享的內容'}>
          <View style={{ gap: theme.space.md }}>
            {mode === 'profile' ? (
              <Text style={body}>
                {uid
                  ? '對方掃描後會進入加好友頁，仍需確認邀請。這不是簽到憑證。'
                  : '登入後即可產生自己的加好友 QR 碼。'}
              </Text>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="要分享的文字或網址"
                  placeholder="輸入文字或網址"
                  placeholderTextColor={theme.colors.muted}
                  value={content}
                  onChangeText={setContent}
                  maxLength={500}
                  multiline
                  style={inputStyle}
                />
                <Text style={body}>分享文字或網址，不代表活動簽到或群組邀請。</Text>
              </>
            )}
            {generated ? (
              <>
                <View
                  style={{
                    padding: 12,
                    backgroundColor: '#fff',
                    alignSelf: 'center',
                    borderRadius: theme.radius.md,
                  }}
                >
                  <QRCode value={generated} size={180} color="#173F31" backgroundColor="#fff" />
                </View>
                <AIButton label="分享連結或內容" disabled={busy} onPress={() => void share()} />
              </>
            ) : mode === 'profile' ? (
              <AIButton label="前往登入" onPress={() => go('SSOLogin')} />
            ) : null}
          </View>
        </AICard>
      ) : (
        <>
          <AICard title="掃描或貼上內容">
            <View style={{ gap: theme.space.md }}>
              {cameraActive ? (
                <>
                  <View style={{ height: 280, overflow: 'hidden', borderRadius: theme.radius.md }}>
                    <CameraView
                      testID="qr-camera"
                      style={{ flex: 1 }}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={(result) => {
                        if (scanned.current || !active.current) return;
                        scanned.current = true;
                        setResult(result.data);
                      }}
                      onMountError={() => {
                        setCameraActive(false);
                        setError('相機目前無法使用，請貼上 QR 碼內容或稍後重試。');
                      }}
                    />
                  </View>
                  <AIButton
                    label="關閉相機"
                    variant="ghost"
                    onPress={() => setCameraActive(false)}
                  />
                </>
              ) : (
                <AIButton
                  label={busy ? '處理中…' : '開啟相機掃描'}
                  disabled={busy}
                  onPress={() => void startScan()}
                />
              )}
              <TextInput
                accessibilityLabel="QR 碼內容"
                placeholder="貼上 QR 碼中的網址或文字"
                placeholderTextColor={theme.colors.muted}
                value={draft}
                onChangeText={setDraft}
                maxLength={4096}
                editable={!busy}
                multiline
                style={inputStyle}
              />
              <AIButton
                label="查看內容"
                disabled={busy || !draft.trim()}
                variant="ghost"
                onPress={() => setResult(draft)}
              />
              <Text style={body}>掃描不會自動加入群組或完成簽到。</Text>
            </View>
          </AICard>
          {scan ? (
            <AICard title="掃描結果">
              <View style={{ gap: theme.space.md }}>
                {action.kind === 'group' ? (
                  joined ? (
                    <>
                      <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                        已加入群組：{joined.name}
                      </Text>
                      <AIButton
                        label="開啟群組"
                        onPress={() => go('GroupDetail', { groupId: joined.groupId })}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={body}>
                        群組邀請碼：{action.joinCode}
                        。確認後會由群組服務檢查目前帳號與學校的加入資格。
                      </Text>
                      <AIButton
                        label={busy ? '正在確認加入結果…' : '加入這個群組'}
                        disabled={busy}
                        onPress={() => void join()}
                      />
                    </>
                  )
                ) : action.kind === 'friend' ? (
                  <>
                    <Text style={body}>
                      這是加好友連結。開啟後請確認對方資料，再決定是否送出邀請。
                    </Text>
                    <AIButton
                      label="查看對方資料"
                      onPress={() => go('FriendSearch', { presetUid: action.uid })}
                    />
                  </>
                ) : action.kind === 'link' ? (
                  <>
                    <Text
                      selectable
                      style={{ ...theme.typography.bodySmall, color: theme.colors.text }}
                    >
                      {action.url}
                    </Text>
                    <AIButton
                      label="開啟這個網址"
                      disabled={busy}
                      onPress={() => void openLink()}
                    />
                  </>
                ) : action.kind === 'text' ? (
                  <Text selectable style={{ ...theme.typography.body, color: theme.colors.text }}>
                    {action.text}
                  </Text>
                ) : (
                  <Text style={body}>
                    {action.kind === 'unsupported' && action.purpose === 'attendance'
                      ? '無法確認這個簽到碼的課程、有效期與授權，尚未完成簽到。請從課程簽到入口使用老師提供的驗證方式；活動簽到請向主辦單位確認。'
                      : action.kind === 'unsupported' && action.purpose === 'group'
                        ? '這個群組碼沒有可確認的加入碼或格式不受支援，尚未加入群組。請向群組管理者取得有效的加入碼。'
                        : '無法確認這個 QR 碼的用途或格式。沒有執行加入、簽到或其他帳號操作。'}
                  </Text>
                )}
              </View>
            </AICard>
          ) : null}
        </>
      )}
      {error ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.danger }}>
            {error}
          </Text>
        </AICard>
      ) : null}
      <AICard title="需要加入群組或簽到？">
        <View style={{ gap: theme.space.md }}>
          <Text style={body}>
            群組加入碼由管理者提供；課程簽到須由老師開啟。這裡不產生簽到憑證或群組邀請碼。
          </Text>
          <AIButton label="開啟群組與加入碼" variant="ghost" onPress={() => go('Groups')} />
          <AIButton label="開啟課程簽到" variant="ghost" onPress={() => go('Attendance')} />
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
