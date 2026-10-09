import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import * as Crypto from 'expo-crypto';
import { NuniError } from '@campus/shared/src/nuni';
import {
  loadMerchantOverview,
  parseMerchantApplication,
  validateMerchantApplicationInput,
  merchantApplicationStateLabel,
  merchantWorkspaceStateLabel,
  type NuniMerchantApplicationInput,
} from '@campus/shared/src/nuniMerchant';
import { useNuniSession } from '../../state/nuniSession';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';

type Overview = Awaited<ReturnType<typeof loadMerchantOverview>>;
type Draft = Omit<NuniMerchantApplicationInput, 'idempotencyKey'>;
const emptyDraft = (): Draft => ({
  tenantId: '',
  campusId: '',
  businessKind: 'company',
  legalName: '',
  brandName: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  locationName: '',
  operatingAddress: '',
  businessRegistrationNumber: '',
  foodBusinessRegistrationNumber: '',
  serviceModes: ['pickup'],
});
const fields = [
  ['legalName', '公司或商業名稱', 200],
  ['brandName', '品牌名稱', 200],
  ['businessRegistrationNumber', '統一編號（選填）', 40],
  ['foodBusinessRegistrationNumber', '食品業者登錄字號（選填）', 60],
  ['contactName', '聯絡人姓名', 120],
  ['contactEmail', '聯絡信箱', 254],
  ['contactPhone', '聯絡電話', 30],
  ['locationName', '門市名稱', 200],
  ['operatingAddress', '營業地址', 300],
] as const;
const kinds: [Draft['businessKind'], string][] = [
  ['company', '公司'],
  ['sole-proprietor', '獨資商號'],
  ['campus-stall', '校園攤位'],
  ['other', '其他'],
];
const modes: [Draft['serviceModes'][number], string][] = [
  ['pickup', '自取'],
  ['dine-in', '內用'],
  ['delivery', '外送'],
];
const requirementLabels: Record<string, string> = {
  settings: '確認營運設定與條款',
  menu: '建立菜單',
  'online-payment': '完成線上付款資格',
};
const expired = (error: unknown) =>
  error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');

function Action({
  children,
  onPress,
  disabled = false,
  selected = false,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={{ color: theme.colors.text }}>{children}</Text>
    </Pressable>
  );
}

export function NuniMerchant() {
  const styles = useThemeStyleSheet(createStyles);
  const auth = useNuniSession();
  if (auth.loading || !auth.session || auth.pendingLogout || auth.error) {
    return <Text style={styles.text}>請先確認 Campus One 帳號狀態。</Text>;
  }
  return (
    <MerchantAccount
      key={`${auth.session.platformAccountId}:${auth.session.context}`}
      context={auth.session.context}
    />
  );
}

function MerchantAccount({ context }: { context: string }) {
  const styles = useThemeStyleSheet(createStyles);
  const { request, refresh } = useNuniSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [invalidSession, setInvalidSession] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState<NuniMerchantApplicationInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [submitError, setSubmitError] = useState('');
  const alive = useRef(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const invalidate = useCallback(() => ++generation.current, []);
  const expire = useCallback(() => {
    ++generation.current;
    setInvalidSession(true);
    setOverview(null);
    setDraft(emptyDraft());
    setPending(null);
    void refresh();
  }, [refresh]);
  const load = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await loadMerchantOverview((path, input) => request(path, context, input));
      if (alive.current && run === generation.current) setOverview(result);
    } catch (error) {
      if (alive.current && run === generation.current) {
        if (expired(error)) expire();
        else setLoadError('目前無法確認店家資料，請重新載入。');
      }
    } finally {
      if (alive.current && run === generation.current) setLoading(false);
    }
  }, [request, context, expire]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      invalidate();
    };
  }, [load, invalidate]);

  async function submit() {
    if (!alive.current || lock.current || loading || loadError || invalidSession || !overview)
      return;
    setNotice('');
    setSubmitError('');
    let payload: NuniMerchantApplicationInput;
    try {
      payload =
        pending ??
        validateMerchantApplicationInput({
          ...draft,
          businessRegistrationNumber: draft.businessRegistrationNumber?.trim() || undefined,
          foodBusinessRegistrationNumber: draft.foodBusinessRegistrationNumber?.trim() || undefined,
          idempotencyKey: `merchant-apply-${Crypto.randomUUID()}`,
        });
      if (
        !overview.programs.some(
          (program) =>
            program.tenantId === payload.tenantId &&
            program.campuses.some((campus) => campus.id === payload.campusId),
        )
      ) {
        setSubmitError('請選擇目前開放的場域與營運區域。');
        return;
      }
    } catch {
      setSubmitError('請確認必填資料、聯絡方式，並至少選擇一種服務方式。');
      return;
    }
    lock.current = true;
    setBusy(true);
    setPending(payload);
    try {
      const receipt = parseMerchantApplication(
        await request('merchant-applications', context, payload),
      );
      if (
        receipt.tenantId !== payload.tenantId ||
        receipt.brandName !== payload.brandName ||
        receipt.locationName !== payload.locationName
      )
        throw new NuniError(502, 'INVALID_RESPONSE');
      if (!alive.current) return;
      setOverview((current) =>
        current
          ? {
              ...current,
              applications: [
                receipt,
                ...current.applications.filter(
                  (row) => row.applicationId !== receipt.applicationId,
                ),
              ],
            }
          : current,
      );
      setPending(null);
      setDraft(emptyDraft());
      setNotice('申請已收件。審核通過後仍需完成營運設定，才會開放店家服務。');
    } catch (error) {
      if (!alive.current) return;
      if (expired(error)) expire();
      else if (
        !pending &&
        error instanceof NuniError &&
        [400, 403, 404, 409, 422].includes(error.status)
      ) {
        setPending(null);
        setSubmitError(
          error.status === 409
            ? '申請已有紀錄或狀態已變更，請重新載入查看申請。'
            : '申請未被接受，請確認資料與場域是否仍開放後再試。',
        );
      } else setSubmitError('尚未確認是否收件。資料已保留，請重試同一份申請；重試不會另建一筆。');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const selected = overview?.programs.find((program) => program.tenantId === draft.tenantId);
  const locked = busy || Boolean(pending);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        店家合作
      </Text>
      <Text style={styles.text}>
        使用同一個 Campus One 帳號申請進駐。審核與營運權限依場域分開，不會取得學校管理權限。
      </Text>
      {invalidSession ? (
        <>
          <Text accessibilityRole="alert" style={styles.text}>
            帳號狀態已變更，請重新確認。
          </Text>
          <Action onPress={() => void refresh()}>確認帳號</Action>
        </>
      ) : loading ? (
        <Text style={styles.text}>正在確認店家資料…</Text>
      ) : loadError ? (
        <>
          <Text accessibilityRole="alert" style={styles.text}>
            {loadError}
          </Text>
          <Action onPress={() => void load()}>重新載入</Action>
        </>
      ) : (
        overview && (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              我的申請
            </Text>
            {overview.applications.length ? (
              overview.applications.map((application) => (
                <View key={application.applicationId} style={styles.row}>
                  <Text style={styles.title}>
                    {application.brandName} · {application.locationName}
                  </Text>
                  <Text style={styles.text}>
                    {merchantApplicationStateLabel(application.state)}
                  </Text>
                  {application.reviewerNote ? (
                    <Text style={styles.text}>審核說明：{application.reviewerNote}</Text>
                  ) : null}
                </View>
              ))
            ) : (
              <Text style={styles.text}>這個帳號尚未送出進駐申請。</Text>
            )}
            <Text accessibilityRole="header" style={styles.title}>
              我的門市
            </Text>
            {overview.workspaces.length ? (
              overview.workspaces.map((workspace) => (
                <View key={`${workspace.tenantId}:${workspace.locationId}`} style={styles.row}>
                  <Text style={styles.title}>{workspace.locationName}</Text>
                  <Text style={styles.text}>
                    {workspace.tenantName} · {workspace.campusName}
                  </Text>
                  <Text style={styles.text}>{merchantWorkspaceStateLabel(workspace)}</Text>
                  {workspace.missingRequirements.map((requirement) => (
                    <Text key={requirement} style={styles.text}>
                      {requirementLabels[requirement] ?? '請向場域管理者確認待完成項目'}
                    </Text>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.text}>核准後會在這裡顯示你有權管理的門市。</Text>
            )}
            <Action disabled={busy} onPress={() => void load()}>
              重新載入店家資料
            </Action>
            <Text accessibilityRole="header" style={styles.title}>
              申請進駐
            </Text>
            {!overview.programs.length ? (
              <Text style={styles.text}>目前沒有開放申請的場域，請稍後再查看。</Text>
            ) : (
              <>
                <Text style={styles.text}>進駐場域</Text>
                <View style={styles.choices}>
                  {overview.programs.map((program) => (
                    <Action
                      key={program.tenantId}
                      disabled={locked}
                      selected={draft.tenantId === program.tenantId}
                      onPress={() =>
                        setDraft((value) => ({
                          ...value,
                          tenantId: program.tenantId,
                          campusId: '',
                        }))
                      }
                    >
                      {program.name}
                    </Action>
                  ))}
                </View>
                {selected?.note ? <Text style={styles.text}>{selected.note}</Text> : null}
                <Text style={styles.text}>營運區域</Text>
                <View style={styles.choices}>
                  {selected?.campuses.map((campus) => (
                    <Action
                      key={campus.id}
                      disabled={locked}
                      selected={draft.campusId === campus.id}
                      onPress={() => setDraft((value) => ({ ...value, campusId: campus.id }))}
                    >
                      {campus.name}
                    </Action>
                  ))}
                </View>
                <Text style={styles.text}>商業類型</Text>
                <View style={styles.choices}>
                  {kinds.map(([kind, label]) => (
                    <Action
                      key={kind}
                      disabled={locked}
                      selected={draft.businessKind === kind}
                      onPress={() => setDraft((value) => ({ ...value, businessKind: kind }))}
                    >
                      {label}
                    </Action>
                  ))}
                </View>
                {fields.map(([field, label, limit]) => (
                  <View key={field} style={{ gap: 5 }}>
                    <Text style={styles.text}>{label}</Text>
                    <TextInput
                      accessibilityLabel={label}
                      value={draft[field]}
                      maxLength={limit}
                      editable={!locked}
                      autoCapitalize={field === 'contactEmail' ? 'none' : 'sentences'}
                      autoCorrect={field !== 'contactEmail'}
                      keyboardType={
                        field === 'contactEmail'
                          ? 'email-address'
                          : field === 'contactPhone'
                            ? 'phone-pad'
                            : 'default'
                      }
                      style={styles.input}
                      onChangeText={(value) =>
                        setDraft((current) => ({ ...current, [field]: value }))
                      }
                    />
                  </View>
                ))}
                <Text style={styles.text}>服務方式</Text>
                <View style={styles.choices}>
                  {modes.map(([mode, label]) => (
                    <Action
                      key={mode}
                      disabled={locked}
                      selected={draft.serviceModes.includes(mode)}
                      onPress={() =>
                        setDraft((value) => ({
                          ...value,
                          serviceModes: value.serviceModes.includes(mode)
                            ? value.serviceModes.filter((item) => item !== mode)
                            : [...value.serviceModes, mode],
                        }))
                      }
                    >
                      {label}
                    </Action>
                  ))}
                </View>
                <Text style={styles.text}>
                  資料將提供進駐場域的審核人員。請勿填入密碼、銀行帳號或身分證影本。
                </Text>
                <Action disabled={busy} onPress={() => void submit()}>
                  {busy ? '確認收件中…' : pending ? '重試同一份申請' : '送出進駐申請'}
                </Action>
              </>
            )}
            {submitError ? (
              <Text accessibilityRole="alert" style={styles.text}>
                {submitError}
              </Text>
            ) : null}
            {notice ? (
              <Text accessibilityRole="alert" style={styles.text}>
                {notice}
              </Text>
            ) : null}
          </>
        )
      )}
    </ScrollView>
  );
}
const createStyles = () =>
  StyleSheet.create({
    content: { padding: 20, paddingBottom: 48, gap: 14 },
    heading: { fontSize: 24, fontWeight: '700', color: theme.colors.text },
    title: { fontSize: 18, fontWeight: '600', color: theme.colors.text },
    text: { fontSize: 16, lineHeight: 24, color: theme.colors.text },
    row: { gap: 6, borderBottomWidth: 1, borderColor: theme.colors.border, paddingVertical: 12 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    button: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 44,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      padding: 12,
      minHeight: 48,
      fontSize: 16,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
    },
  });
