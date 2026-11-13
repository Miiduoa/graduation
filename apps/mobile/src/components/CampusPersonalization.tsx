import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import {
  buildCampusRecommendations,
  CAMPUS_FOCUS_OPTIONS,
  CAMPUS_GOAL_OPTIONS,
  CAMPUS_LIVING_OPTIONS,
  CAMPUS_PHASE_OPTIONS,
  CAMPUS_STAGE_OPTIONS,
  createDefaultCampusPreferences,
  normalizeCampusPreferences,
  type CampusPersonalizationPreferences,
} from '@campus/shared/src/campusPersonalization';
import { taipeiParts } from '@campus/shared/src/taipeiTime';
import { usePersonalImportScope } from '../state/personalImportScope';
import { useCampusPersonalization } from '../state/campusPersonalization';
import { campusRecommendationDestination } from '../services/campusPersonalizationNavigation';
import type { MobileAssistantAudience } from '../services/assistantServiceNavigation';
import { safeNavigate } from '../utils/safeNavigate';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

function dateInput(value: Date): string {
  const date = taipeiParts(value);
  return date
    ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
    : '';
}

export function CampusPersonalization({
  now: suppliedNow,
  active = true,
}: {
  now?: Date;
  active?: boolean;
}) {
  const scope = usePersonalImportScope();
  const state = useCampusPersonalization(scope, active);
  const navigation = React.useContext(NavigationContext);
  const [clock, setClock] = useState(() => new Date());
  const currentKey = useRef(state.scopeKey);
  currentKey.current = state.scopeKey;
  const s = useThemeStyleSheet(createStyles);
  useEffect(() => {
    if (suppliedNow || !active || !state.scopeKey) return;
    const tick = () => setClock(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    const app = AppState.addEventListener('change', (value) => {
      if (value === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      app.remove();
    };
  }, [suppliedNow, active, state.scopeKey]);
  const now = suppliedNow ?? clock;
  const recommendations = useMemo(
    () =>
      state.preferences
        ? buildCampusRecommendations({
            preferences: state.preferences,
            now,
            events: state.events,
            schoolId: scope?.schoolId ?? null,
          })
        : null,
    [state.preferences, now, state.events, scope?.schoolId],
  );
  if (!scope || !active) return null;
  if (!state.ready || !state.preferences || !recommendations)
    return state.error ? (
      <View style={s.panel}>
        <Text accessibilityRole="alert" style={s.error}>
          {state.error}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: state.saving }}
          disabled={state.saving}
          onPress={state.retry}
          style={s.secondaryButton}
        >
          <Text style={s.link}>重新讀取首頁偏好</Text>
        </Pressable>
        <Text style={s.note}>也可以重新設定此帳號、此校園的首頁偏好；課表與其他資料會保留。</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: state.saving, busy: state.saving }}
          disabled={state.saving}
          onPress={() => void state.reset()}
          style={s.secondaryButton}
        >
          <Text style={s.link}>{state.saving ? '重新設定中…' : '重新設定首頁偏好'}</Text>
        </Pressable>
      </View>
    ) : null;
  const key = state.scopeKey;
  const audience: MobileAssistantAudience = scope.owner.startsWith('nuni:')
    ? 'platform'
    : scope.owner.startsWith('firebase:')
      ? 'campus'
      : 'guest';
  return (
    <CampusPersonalizationContent
      key={key}
      now={now}
      preferences={state.preferences}
      recommendations={recommendations}
      saving={state.saving}
      error={state.error}
      eventsError={state.eventsError}
      onRetry={state.retry}
      onSave={state.save}
      audience={audience}
      navigation={navigation}
      isCurrent={() => currentKey.current === key}
    />
  );
}

type ContentProps = {
  now: Date;
  preferences: CampusPersonalizationPreferences;
  recommendations: ReturnType<typeof buildCampusRecommendations>;
  saving: boolean;
  error: string;
  eventsError: string;
  onRetry: () => void;
  onSave: (preferences: CampusPersonalizationPreferences) => Promise<boolean>;
  audience: MobileAssistantAudience;
  navigation: Parameters<typeof campusRecommendationDestination>[2];
  isCurrent: () => boolean;
};

function CampusPersonalizationContent(props: ContentProps) {
  const s = useThemeStyleSheet(createStyles);
  const [editing, setEditing] = useState(!props.preferences.configured);
  const [draft, setDraft] = useState(props.preferences);
  const [more, setMore] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async (candidate = draft) => {
    if (!mounted.current || !props.isCurrent() || props.saving) return;
    const normalized = normalizeCampusPreferences({ ...candidate, configured: true });
    if (candidate.phaseOverride && !normalized.phaseOverride) {
      setValidationError('請填入有效的開始與結束日期，結束日不能早於開始日，最長 90 天。');
      return;
    }
    setValidationError('');
    const saved = await props.onSave(normalized);
    if (saved && mounted.current && props.isCurrent()) setEditing(false);
  };
  const open = async (href: string) => {
    if (!mounted.current || !props.isCurrent() || openingRef.current) return;
    const destination = campusRecommendationDestination(href, props.audience, props.navigation);
    setOpenError('');
    if (!destination) {
      setOpenError('目前無法開啟這項安排，請稍後再試。');
      return;
    }
    if (destination.kind === 'native') {
      if (
        !safeNavigate(props.navigation, destination.route, destination.params, {
          fallbackMessage: null,
        })
      )
        setOpenError('目前無法開啟這項安排，請稍後再試。');
      return;
    }
    openingRef.current = true;
    setOpening(true);
    try {
      await Linking.openURL(destination.url);
    } catch {
      if (mounted.current && props.isCurrent()) setOpenError('無法開啟網頁，請確認連線後重試。');
    } finally {
      openingRef.current = false;
      if (mounted.current && props.isCurrent()) setOpening(false);
    }
  };
  const phase = draft.phaseOverride;
  const savedPhase = props.preferences.phaseOverride;
  const today = dateInput(props.now);
  const savedPhaseLabel = CAMPUS_PHASE_OPTIONS.find(
    (option) => option.value === savedPhase?.kind,
  )?.label;
  const inactivePhaseNotice =
    savedPhase && today && savedPhaseLabel
      ? today > savedPhase.endDate
        ? `你設定的${savedPhaseLabel}期間為 ${savedPhase.startDate} 至 ${savedPhase.endDate}，已結束；目前依個人行程與偏好推薦。`
        : today < savedPhase.startDate
          ? `你設定的${savedPhaseLabel}將於 ${savedPhase.startDate} 開始，${savedPhase.endDate} 結束；目前尚未套用。`
          : ''
      : '';
  return (
    <View style={s.panel} testID="campus-personalization">
      <View style={s.headingRow}>
        <Text accessibilityRole="header" style={s.heading}>
          {editing ? '讓今天更適合你' : '接下來可以做'}
        </Text>
        {!editing ? (
          <Pressable
            accessibilityRole="button"
            style={s.textButton}
            onPress={() => {
              setDraft(props.preferences);
              setValidationError('');
              setEditing(true);
            }}
          >
            <Text style={s.link}>調整偏好</Text>
          </Pressable>
        ) : null}
      </View>
      {editing ? (
        <>
          <Text style={s.body}>選擇目前階段與最近的重點，之後隨時可以更改。</Text>
          <ChoiceGroup
            label="目前就讀階段"
            options={CAMPUS_STAGE_OPTIONS}
            value={draft.stage}
            disabled={props.saving}
            onChange={(stage) => setDraft((value) => ({ ...value, stage }))}
          />
          <ChoiceGroup
            label="最近想優先安排"
            options={CAMPUS_FOCUS_OPTIONS}
            value={draft.focus}
            disabled={props.saving}
            onChange={(focus) => setDraft((value) => ({ ...value, focus }))}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: more }}
            style={s.textButton}
            onPress={() => setMore((value) => !value)}
          >
            <Text style={s.link}>{more ? '收起其他選擇' : '住宿、通勤與近期目標（選填）'}</Text>
          </Pressable>
          {more ? (
            <>
              <ChoiceGroup
                label="生活方式"
                options={CAMPUS_LIVING_OPTIONS}
                value={draft.living}
                disabled={props.saving}
                onChange={(living) => setDraft((value) => ({ ...value, living }))}
              />
              <View style={s.group}>
                <Text style={s.label}>近期目標，最多選 3 個</Text>
                <View style={s.choices}>
                  {CAMPUS_GOAL_OPTIONS.map((option) => {
                    const checked = draft.goals.includes(option.value);
                    const disabled = props.saving || (!checked && draft.goals.length >= 3);
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="checkbox"
                        accessibilityLabel={option.label}
                        accessibilityState={{ checked, disabled }}
                        disabled={disabled}
                        style={[s.choice, checked && s.selectedChoice, disabled && s.disabled]}
                        onPress={() =>
                          setDraft((value) => ({
                            ...value,
                            goals: checked
                              ? value.goals.filter((goal) => goal !== option.value)
                              : [...value.goals, option.value],
                          }))
                        }
                      >
                        <Text style={[s.choiceLabel, checked && s.selectedLabel]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <ChoiceGroup
                label="這段時間"
                options={[{ value: 'auto' as const, label: '依個人行程' }, ...CAMPUS_PHASE_OPTIONS]}
                value={phase?.kind ?? 'auto'}
                disabled={props.saving}
                onChange={(kind) =>
                  setDraft((value) => ({
                    ...value,
                    phaseOverride:
                      kind === 'auto'
                        ? null
                        : {
                            kind,
                            startDate: value.phaseOverride?.startDate ?? dateInput(props.now),
                            endDate:
                              value.phaseOverride?.endDate ??
                              [
                                dateInput(new Date(props.now.getTime() + 6 * 86_400_000)),
                                '2200-12-31',
                              ].sort()[0],
                          },
                  }))
                }
              />
              {phase ? (
                <View style={s.group}>
                  <Text style={s.note}>這段期間會優先提供相關安排，結束後自動改回依行程推薦。</Text>
                  <Text style={s.label}>開始日期</Text>
                  <TextInput
                    accessibilityLabel="階段開始日期"
                    value={phase.startDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.colors.muted}
                    style={s.input}
                    maxLength={10}
                    autoCorrect={false}
                    editable={!props.saving}
                    onChangeText={(startDate) =>
                      setDraft((value) => ({
                        ...value,
                        phaseOverride: value.phaseOverride
                          ? { ...value.phaseOverride, startDate }
                          : null,
                      }))
                    }
                  />
                  <Text style={s.label}>結束日期（包含當天）</Text>
                  <TextInput
                    accessibilityLabel="階段結束日期"
                    value={phase.endDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.colors.muted}
                    style={s.input}
                    maxLength={10}
                    autoCorrect={false}
                    editable={!props.saving}
                    onChangeText={(endDate) =>
                      setDraft((value) => ({
                        ...value,
                        phaseOverride: value.phaseOverride
                          ? { ...value.phaseOverride, endDate }
                          : null,
                      }))
                    }
                  />
                </View>
              ) : null}
            </>
          ) : null}
          <Text style={s.note}>此裝置記住你的選擇，依帳號與校園分開保存。</Text>
          {validationError ? (
            <Text accessibilityRole="alert" style={s.error}>
              {validationError}
            </Text>
          ) : null}
          <View style={s.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: props.saving, busy: props.saving }}
              disabled={props.saving}
              onPress={() => void save()}
              style={[s.primaryButton, props.saving && s.disabled]}
            >
              <Text style={s.primaryLabel}>{props.saving ? '儲存中…' : '儲存偏好'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: props.saving }}
              disabled={props.saving}
              style={s.secondaryButton}
              onPress={() => {
                if (props.preferences.configured) {
                  setEditing(false);
                  setValidationError('');
                } else void save(createDefaultCampusPreferences());
              }}
            >
              <Text style={s.link}>{props.preferences.configured ? '取消' : '先略過'}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={s.group}>
            <Text style={s.label}>{props.recommendations.phase.label}</Text>
            <Text style={s.note}>{props.recommendations.phase.reason}</Text>
            {inactivePhaseNotice ? <Text style={s.note}>{inactivePhaseNotice}</Text> : null}
          </View>
          {props.recommendations.recommendations.map((item) => {
            const destination = campusRecommendationDestination(
              item.href,
              props.audience,
              props.navigation,
            );
            return (
              <View key={item.id} style={s.recommendation}>
                <Text style={s.title}>{item.title}</Text>
                <Text style={s.body}>{item.description}</Text>
                <Text style={s.note}>{item.reason}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}，${destination?.kind === 'web' ? '在網頁開啟' : '開啟'}`}
                  accessibilityState={{ disabled: opening || !destination }}
                  disabled={opening || !destination}
                  style={s.textButton}
                  onPress={() => void open(item.href)}
                >
                  <Text style={s.link}>
                    {destination?.kind === 'web' ? '在網頁開啟' : '開啟'} →
                  </Text>
                </Pressable>
              </View>
            );
          })}
          <Text style={s.note}>此裝置記住你的選擇，依帳號與校園分開保存。</Text>
        </>
      )}
      {props.error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {props.error}
        </Text>
      ) : null}
      {props.eventsError ? (
        <View style={s.group}>
          <Text accessibilityRole="alert" style={s.note}>
            {props.eventsError}
          </Text>
          <Pressable accessibilityRole="button" style={s.textButton} onPress={props.onRetry}>
            <Text style={s.link}>重試讀取行程</Text>
          </Pressable>
        </View>
      ) : null}
      {openError ? (
        <Text accessibilityRole="alert" style={s.error}>
          {openError}
        </Text>
      ) : null}
    </View>
  );
}

function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  const s = useThemeStyleSheet(createStyles);
  return (
    <View style={s.group}>
      <Text style={s.label}>{label}</Text>
      <View style={s.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={`${label}：${option.label}`}
            accessibilityState={{ checked: option.value === value, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[s.choice, option.value === value && s.selectedChoice]}
          >
            <Text style={[s.choiceLabel, option.value === value && s.selectedLabel]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    panel: {
      gap: 16,
      padding: 20,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    headingRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    heading: { color: theme.colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' },
    title: { color: theme.colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' },
    body: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 23 },
    label: { color: theme.colors.text, fontSize: 14, lineHeight: 22, fontWeight: '600' },
    note: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 22 },
    group: { gap: 8 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choice: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.bg,
    },
    selectedChoice: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accent },
    choiceLabel: { color: theme.colors.text, fontSize: 14, lineHeight: 22 },
    selectedLabel: { color: theme.colors.onAccent, fontWeight: '600' },
    input: {
      minHeight: 48,
      padding: 12,
      color: theme.colors.text,
      backgroundColor: theme.colors.bg,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      fontSize: 16,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    primaryButton: {
      minHeight: 46,
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryLabel: { color: theme.colors.onAccent, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    secondaryButton: {
      minHeight: 46,
      paddingVertical: 12,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textButton: {
      minHeight: 44,
      paddingVertical: 10,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    link: { color: theme.colors.accent, fontSize: 14, lineHeight: 22, fontWeight: '600' },
    recommendation: {
      gap: 6,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    disabled: { opacity: 0.55 },
    error: { color: theme.colors.danger, fontSize: 14, lineHeight: 23 },
  });
