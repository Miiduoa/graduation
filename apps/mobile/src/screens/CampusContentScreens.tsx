import { EventRegistrationPanel } from '../components/EventRegistrationPanel';
import { useEventRegistrations } from '../hooks/useEventRegistrations';
import { eventRegistrationLabel } from '../services/eventRegistration';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AppState,
  Keyboard,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AIDetailScreen, AICard, AISection, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useCampusEvents } from '../hooks/useCampusEvents';
import {
  loadCampusAnnouncementFeed,
  loadCampusAnnouncement,
  loadCampusEvent,
} from '../services/publicCampusContent';
import {
  ANNOUNCEMENT_ALL_VIEW_LABEL,
  ANNOUNCEMENT_EMPTY_CONNECTED_TEXT,
  ANNOUNCEMENT_EMPTY_SCHOOL_TEXT,
  ANNOUNCEMENT_OFFICIAL_SITE_BUTTON,
  ANNOUNCEMENT_READ_FAILURE_TEXT,
  ANNOUNCEMENT_RETRY_TEXT,
  ANNOUNCEMENT_STUDENT_WALL_LABEL,
  announcementEmptyHeading,
  announcementEmptyKind,
  announcementViewPhase,
  formatStaleAnnouncementNotice,
  isAnnouncementSchoolVisibleToPublic,
  listAnnouncementCatalogLinks,
  staleAnnouncementUpdatedAt,
  SUMMARY_NOTICE,
  verifiedOfficialAnnouncementUrl,
} from '@campus/shared/src/campusAnnouncements';
import { getRawAppEnv } from '../services/release';
import { safeNavigate } from '../utils/safeNavigate';
import { exportAndShareICalFile } from '../services/ical';
import type { AnnouncementCategory } from '../data/types';
import { matchesCampusContent } from '../utils/campusContentList';
import {
  campusEventPhase,
  campusEventPhaseLabel,
  compareCampusEventTime,
} from '@campus/shared/src/campusEventTime';

type Props = {
  navigation?: {
    goBack?: () => void;
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { id?: string; announcementId?: string; eventId?: string; source?: string } };
};

function useContent<T>(
  loader: (schoolId: string, id: string) => Promise<T>,
  id = '',
  source = '',
  keepOnError = false,
) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id, id, source]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<{
    scope: string;
    value: T | null;
    error: string;
    loading: boolean;
  }>({ scope, value: null, error: '', loading: true });
  const current = () => mounted.current && activeScope.current === scope;
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setState((prev) => ({
      scope,
      value: keepOnError && prev.scope === scope ? prev.value : null,
      error: '',
      loading: !(keepOnError && prev.scope === scope && prev.value),
    }));
    try {
      const value = await loader(school.id, id);
      if (mounted.current && activeScope.current === scope && generation.current === request)
        setState({ scope, value, error: '', loading: false });
    } catch {
      if (mounted.current && activeScope.current === scope && generation.current === request)
        setState((prev) => ({
          scope,
          value: keepOnError && prev.scope === scope ? prev.value : null,
          error: keepOnError
            ? prev.scope === scope && prev.value
              ? 'stale'
              : 'failed'
            : '目前無法讀取，請確認網路連線後重試。',
          loading: false,
        }));
    }
  }, [loader, school.id, id, scope, keepOnError]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [reload]);
  return {
    ...(state.scope === scope ? state : { value: null, error: '', loading: true }),
    reload,
    current,
    scope,
  };
}

function useAnnouncementFeed() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<{
    scope: string;
    feed: Awaited<ReturnType<typeof loadCampusAnnouncementFeed>> | null;
    loading: boolean;
    stale: boolean;
    failed: boolean;
  }>({ scope, feed: null, loading: true, stale: false, failed: false });
  const current = () => mounted.current && activeScope.current === scope;
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setState((prev) => ({
      scope,
      feed: prev.scope === scope ? prev.feed : null,
      loading: !(prev.scope === scope && (prev.feed?.announcements.length ?? 0) > 0),
      stale: prev.scope === scope ? prev.stale : false,
      failed: false,
    }));
    try {
      const feed = await loadCampusAnnouncementFeed(school.id);
      if (mounted.current && activeScope.current === scope && generation.current === request)
        setState({ scope, feed, loading: false, stale: false, failed: false });
    } catch {
      if (mounted.current && activeScope.current === scope && generation.current === request) {
        setState((prev) => {
          const cached =
            prev.scope === scope && prev.feed && prev.feed.announcements.length > 0
              ? prev.feed
              : null;
          return {
            scope,
            feed: cached,
            loading: false,
            stale: Boolean(cached),
            failed: !cached,
          };
        });
      }
    }
  }, [school.id, scope]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [reload]);
  const scoped = state.scope === scope;
  const feed = scoped ? state.feed : null;
  const failed = scoped && !state.loading && state.failed;
  const loading = !scoped || state.loading || (feed == null && !failed);
  return {
    loading,
    failed,
    stale: scoped ? state.stale : false,
    reload,
    current,
    announcements: loading ? [] : (feed?.announcements ?? []),
    officialAnnouncements: loading ? [] : (feed?.officialAnnouncements ?? []),
    sources: loading ? [] : (feed?.sources ?? []),
  };
}

const categoryNames: Record<AnnouncementCategory, string> = {
  general: '校園',
  academic: '教務',
  event: '活動',
  emergency: '緊急',
  system: '系統',
};

function dateLabel(value?: string) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '時間尚未公布';
}

function ReadState({
  loading,
  error,
  empty,
  reload,
}: {
  loading: boolean;
  error: string;
  empty: string;
  reload: () => Promise<void>;
}) {
  return (
    <AICard title={loading ? '正在讀取' : error ? '無法讀取資料' : empty}>
      {!loading ? (
        <View style={{ gap: 12 }}>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
              {error}
            </Text>
          ) : null}
          <AIButton label={error ? '重新讀取' : '更新資料'} onPress={() => void reload()} />
        </View>
      ) : null}
    </AICard>
  );
}

function ContentFilter({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`篩選：${label}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        maxWidth: '100%',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: aiTokens.radius.pill,
        borderWidth: 1,
        borderColor: selected ? aiTokens.ai : aiTokens.border,
        backgroundColor: selected ? aiTokens.aiSoft : aiTokens.surface,
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: selected ? aiTokens.ai : aiTokens.text,
          fontSize: 14,
          fontWeight: selected ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ContentSearch({
  kind,
  value,
  onChange,
}: {
  kind: '公告' | '活動';
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: aiTokens.text, fontSize: 15, fontWeight: '600' }}>搜尋{kind}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          accessibilityLabel={`搜尋${kind}`}
          placeholder={kind === '公告' ? '標題、內容或發布單位' : '名稱、介紹、地點或主辦單位'}
          placeholderTextColor={aiTokens.muted}
          value={value}
          onChangeText={onChange}
          maxLength={160}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 48,
            padding: 12,
            color: aiTokens.text,
            backgroundColor: aiTokens.surface,
            borderWidth: 1,
            borderColor: aiTokens.border,
            borderRadius: aiTokens.radius.sm,
            fontSize: 16,
          }}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`清除${kind}搜尋`}
            onPress={() => onChange('')}
            style={{
              minHeight: 44,
              minWidth: 44,
              padding: 8,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: aiTokens.ai, fontSize: 14 }}>清除</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ContentRow({
  title,
  subtitle,
  preview,
  labels = [],
  first,
  kind,
  onPress,
}: {
  title: string;
  subtitle: string;
  preview?: string;
  labels?: Array<string | undefined>;
  first: boolean;
  kind: '公告' | '活動';
  onPress: () => void;
}) {
  const tags = labels.filter((label): label is string => Boolean(label));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, ...tags, subtitle].filter(Boolean).join('，')}
      accessibilityHint={`開啟${kind}詳情`}
      onPress={() => {
        Keyboard.dismiss();
        onPress();
      }}
      style={({ pressed }) => ({
        gap: 8,
        minHeight: 64,
        padding: 16,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: aiTokens.border,
        backgroundColor: pressed ? aiTokens.panel : 'transparent',
      })}
    >
      {tags.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {tags.map((label) => (
            <Text
              key={label}
              style={{ color: aiTokens.ai, fontSize: 12, lineHeight: 18, fontWeight: '600' }}
            >
              {label}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={{ color: aiTokens.text, fontSize: 17, lineHeight: 25, fontWeight: '600' }}>
        {title}
      </Text>
      <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 20 }}>{subtitle}</Text>
      {preview ? (
        <Text
          numberOfLines={2}
          style={{ color: aiTokens.textSecondary, fontSize: 14, lineHeight: 22 }}
        >
          {preview}
        </Text>
      ) : null}
    </Pressable>
  );
}

const ANNOUNCEMENTS_PER_PAGE = 30;

export function CampusAnnouncementsScreen(props: Props) {
  const { school } = useSchool();
  const { user } = useAuth();
  return <CampusAnnouncementsContent key={JSON.stringify([user?.uid, school.id])} {...props} />;
}

function CampusAnnouncementsContent({ navigation }: Props) {
  const { school } = useSchool();
  const schoolVisible = isAnnouncementSchoolVisibleToPublic(
    { schoolId: school.id },
    getRawAppEnv(),
  );
  const content = useAnnouncementFeed();
  const [category, setCategory] = useState<AnnouncementCategory | 'all'>('all');
  const [listView, setListView] = useState<'student' | 'all'>('student');
  const [search, setSearch] = useState('');
  const [displayLimit, setDisplayLimit] = useState(ANNOUNCEMENTS_PER_PAGE);
  const [linkError, setLinkError] = useState('');
  const openOfficial = async (url: string) => {
    if (!content.current()) return;
    setLinkError('');
    try {
      await Linking.openURL(url);
    } catch {
      if (content.current()) setLinkError('無法開啟校方公告，請稍後再試。');
    }
  };
  const student = content.announcements;
  const official = content.officialAnnouncements;
  const rows = listView === 'all' ? official : student;
  const sources = content.sources;
  const showFeed = official.length > 0 || student.length > 0;
  const visible = rows.filter(
    (row) =>
      (category === 'all' || row.category === category) &&
      matchesCampusContent(search, [row.title, row.summary, row.body, row.source, row.office]),
  );
  const shown = visible.slice(0, displayLimit);
  const resetFilters = () => {
    setSearch('');
    setCategory('all');
    setDisplayLimit(ANNOUNCEMENTS_PER_PAGE);
  };
  const changeView = (nextView: 'student' | 'all') => {
    setListView(nextView);
    setCategory('all');
    setDisplayLimit(ANNOUNCEMENTS_PER_PAGE);
  };
  const filtered = Boolean(search.trim()) || category !== 'all';
  const down = sources.filter((item) => item.status === 'unavailable');
  const downLinks = down.filter((item) => item.listUrl);
  const officialUrl = verifiedOfficialAnnouncementUrl(school.id);
  const catalogLinks = officialUrl ? listAnnouncementCatalogLinks(school.id) : [];
  const phase = announcementViewPhase(content.loading, student, sources, content.failed);
  const showStaleNotice = rows.length > 0 && (content.stale || down.length > 0);
  const staleSources =
    content.stale && !down.length
      ? [{ status: 'unavailable' as const, lastSuccessAt: undefined }]
      : sources;
  if (!schoolVisible) {
    return (
      <AIDetailScreen
        title="公告"
        subtitle="公開處室公告的摘要與原文連結。一般帳號即可查看。"
        onBack={() => navigation?.goBack?.()}
      >
        <AICard title="目前沒有公告">{null}</AICard>
      </AIDetailScreen>
    );
  }
  return (
    <AIDetailScreen
      title="公告"
      subtitle="公開處室公告的摘要與原文連結。一般帳號即可查看。"
      onBack={() => navigation?.goBack?.()}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {phase === 'loading' ? (
        <ReadState loading error="" empty="目前沒有公告" reload={content.reload} />
      ) : phase === 'failed' ? (
        <AICard title={ANNOUNCEMENT_READ_FAILURE_TEXT}>
          <AIButton label={ANNOUNCEMENT_RETRY_TEXT} onPress={() => void content.reload()} />
        </AICard>
      ) : !showFeed && phase === 'source_down' ? (
        <AICard title={ANNOUNCEMENT_READ_FAILURE_TEXT}>
          <View style={{ gap: 12 }}>
            <AIButton label={ANNOUNCEMENT_RETRY_TEXT} onPress={() => void content.reload()} />
            {officialUrl ? (
              <AIButton
                label={ANNOUNCEMENT_OFFICIAL_SITE_BUTTON}
                variant="ghost"
                onPress={() => void openOfficial(officialUrl)}
              />
            ) : null}
            {(downLinks.length ? downLinks : catalogLinks).map((item) => (
              <AIButton
                key={item.sourceId}
                label={item.office}
                variant="ghost"
                onPress={() => void openOfficial(item.listUrl!)}
              />
            ))}
          </View>
        </AICard>
      ) : !showFeed ? (
        <AICard
          title={
            announcementEmptyHeading(announcementEmptyKind(student, sources)) ??
            ANNOUNCEMENT_EMPTY_SCHOOL_TEXT
          }
        >
          <View style={{ gap: 12 }}>
            {officialUrl ? (
              <AIButton
                label={ANNOUNCEMENT_OFFICIAL_SITE_BUTTON}
                onPress={() => void openOfficial(officialUrl)}
              />
            ) : null}
            {catalogLinks.map((item) => (
              <AIButton
                key={item.sourceId}
                label={item.office}
                onPress={() => void openOfficial(item.listUrl)}
              />
            ))}
            <AIButton label="更新公告" variant="ghost" onPress={() => void content.reload()} />
          </View>
        </AICard>
      ) : (
        <>
          {showStaleNotice ? (
            <AICard
              title={formatStaleAnnouncementNotice(
                staleAnnouncementUpdatedAt(staleSources, rows),
                content.stale ? 'firestore' : 'source_down',
              )}
            >
              {null}
            </AICard>
          ) : null}
          <View style={{ gap: 16, margin: aiTokens.space.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <ContentFilter
                label={ANNOUNCEMENT_STUDENT_WALL_LABEL}
                selected={listView === 'student'}
                onPress={() => changeView('student')}
              />
              <ContentFilter
                label={ANNOUNCEMENT_ALL_VIEW_LABEL}
                selected={listView === 'all'}
                onPress={() => changeView('all')}
              />
            </View>
            <ContentSearch
              kind="公告"
              value={search}
              onChange={(value) => {
                setSearch(value);
                setDisplayLimit(ANNOUNCEMENTS_PER_PAGE);
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <ContentFilter
                label={`全部 ${rows.length}`}
                selected={category === 'all'}
                onPress={() => {
                  setCategory('all');
                  setDisplayLimit(ANNOUNCEMENTS_PER_PAGE);
                }}
              />
              {(Object.keys(categoryNames) as AnnouncementCategory[])
                .filter((key) => rows.some((row) => row.category === key))
                .map((key) => (
                  <ContentFilter
                    key={key}
                    label={categoryNames[key]}
                    selected={category === key}
                    onPress={() => {
                      setCategory(key);
                      setDisplayLimit(ANNOUNCEMENTS_PER_PAGE);
                    }}
                  />
                ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: aiTokens.muted, flex: 1, minWidth: 160, lineHeight: 21 }}
              >
                {filtered ? `找到 ${visible.length} 則` : `${visible.length} 則公告`}
                {visible.length > shown.length ? `，顯示前 ${shown.length} 則` : ''}
                。搜尋與篩選適用已載入的公告。
              </Text>
              {filtered ? (
                <AIButton label="清除公告篩選" variant="ghost" onPress={resetFilters} />
              ) : null}
            </View>
          </View>
          <AISection
            title={listView === 'all' ? ANNOUNCEMENT_ALL_VIEW_LABEL : '學校公告'}
            subtitle={listView === 'all' ? '含教師向與資安轉知等正式公告' : '各處室公開公告'}
          >
            {visible.length ? (
              shown.map((row, index) => (
                <ContentRow
                  key={row.id}
                  first={index === 0}
                  kind="公告"
                  title={row.title}
                  subtitle={[row.source || row.office, dateLabel(row.publishedAt)]
                    .filter(Boolean)
                    .join(' · ')}
                  preview={row.summary || row.body}
                  labels={[row.pinned ? '置頂' : undefined, categoryNames[row.category]]}
                  onPress={() => {
                    if (content.current()) safeNavigate(navigation, '公告詳情', { id: row.id });
                  }}
                />
              ))
            ) : listView === 'student' && student.length === 0 ? (
              <AICard title={ANNOUNCEMENT_EMPTY_CONNECTED_TEXT}>
                <Text>教師向、資安轉知等正式公告可到「{ANNOUNCEMENT_ALL_VIEW_LABEL}」查看。</Text>
              </AICard>
            ) : (
              <AICard title={search.trim() ? '找不到符合的公告' : '這個分類目前沒有公告'}>
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                  試著改用其他關鍵字，或清除篩選查看目前的公告。
                </Text>
              </AICard>
            )}
          </AISection>
          {shown.length < visible.length ? (
            <AIButton
              label={`顯示更多公告（還有 ${visible.length - shown.length} 則）`}
              variant="ghost"
              style={{ margin: aiTokens.space.md }}
              onPress={() => setDisplayLimit((value) => value + ANNOUNCEMENTS_PER_PAGE)}
            />
          ) : null}
          <AIButton
            label="更新公告"
            variant="ghost"
            style={{ margin: aiTokens.space.md }}
            onPress={() => void content.reload()}
          />
        </>
      )}
      {linkError ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
            {linkError}
          </Text>
        </AICard>
      ) : null}
    </AIDetailScreen>
  );
}

export function CampusAnnouncementDetailScreen({ navigation, route }: Props) {
  const id = route?.params?.id ?? route?.params?.announcementId ?? '';
  const content = useContent(loadCampusAnnouncement, id, '', true);
  const announcement = content.value;
  const [actionError, setActionError] = useState<{ scope: string; text: string } | null>(null);
  const openAttachment = async (url: string) => {
    if (!content.current()) return;
    setActionError(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (content.current())
        setActionError({ scope: content.scope, text: '無法開啟附件，請稍後重試。' });
    }
  };
  return (
    <AIDetailScreen title="公告詳情" onBack={() => navigation?.goBack?.()}>
      {content.loading ? (
        <ReadState {...content} empty="找不到這則公告，可能已移除或不屬於目前學校。" />
      ) : content.error === 'failed' ||
        (content.error && content.error !== 'stale' && !announcement) ? (
        <AICard title={ANNOUNCEMENT_READ_FAILURE_TEXT}>
          <AIButton label={ANNOUNCEMENT_RETRY_TEXT} onPress={() => void content.reload()} />
        </AICard>
      ) : !announcement ? (
        <ReadState {...content} empty="找不到這則公告，可能已移除或不屬於目前學校。" />
      ) : (
        <>
          {content.error === 'stale' ? (
            <AICard
              title={formatStaleAnnouncementNotice(
                staleAnnouncementUpdatedAt(
                  [{ status: 'unavailable', lastSuccessAt: announcement.publishedAt }],
                  [announcement],
                ),
                'firestore',
              )}
            >
              {null}
            </AICard>
          ) : null}
          <AICard title={announcement.title}>
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              {[announcement.source, dateLabel(announcement.publishedAt)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </AICard>
          <AICard title="公告內容">
            <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
              {announcement.body?.trim() || announcement.summary?.trim() || '此公告沒有提供內文。'}
            </Text>
            {announcement.originalUrl ||
            (!announcement.body?.trim() && announcement.summary?.trim()) ? (
              <Text style={{ color: aiTokens.muted, lineHeight: 22, marginTop: 8 }}>
                {announcement.originalUrl ? SUMMARY_NOTICE : '目前僅提供摘要。'}
              </Text>
            ) : null}
          </AICard>
          {announcement.originalUrl ? (
            <AIButton
              label="看原文"
              onPress={() => void openAttachment(announcement.originalUrl!)}
            />
          ) : null}
          {announcement.attachments?.length ? (
            <AISection title="附件">
              {announcement.attachments.map((attachment) => (
                <AIRow
                  key={attachment.id}
                  title={attachment.name}
                  onPress={() => void openAttachment(attachment.url)}
                />
              ))}
            </AISection>
          ) : null}
          {actionError?.scope === content.scope ? (
            <AICard>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {actionError.text}
              </Text>
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}

export function CampusEventsScreen(props: Props) {
  const { school } = useSchool();
  const { user } = useAuth();
  return <CampusEventsContent key={JSON.stringify([user?.uid, school.id])} {...props} />;
}

function CampusEventsContent({ navigation }: Props) {
  const content = useCampusEvents();
  const registrations = useEventRegistrations(
    content.items
      .filter((event) => event.source === 'school-club-events' && event.appRegistrationConfigured)
      .map((event) => event.id),
  );
  const [period, setPeriod] = useState<'all' | 'ongoing' | 'upcoming' | 'past' | 'undated'>('all');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    const interval = setInterval(updateTime, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateTime();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
  const filtered = period !== 'all' || Boolean(search.trim());
  const resetFilters = () => {
    setPeriod('all');
    setSearch('');
  };
  const visible = content.items
    .filter((row) => {
      if (!matchesCampusContent(search, [row.title, row.description, row.location, row.organizer]))
        return false;
      const phase = campusEventPhase(row, now);
      if (period === 'all') return true;
      if (period === 'undated') return phase === 'unscheduled';
      if (period === 'past') return phase === 'started' || phase === 'ended';
      return phase === period;
    })
    .sort(
      (a, b) =>
        compareCampusEventTime(a, b, now) ||
        `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`),
    );
  return (
    <AIDetailScreen
      title="活動"
      subtitle="查看時間、地點與主辦單位資訊。"
      onBack={() => navigation?.goBack?.()}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {!content.loaded && !content.items.length ? (
        <ReadState
          loading={content.loading}
          error={content.error}
          reload={content.reload}
          empty="目前沒有活動資訊"
        />
      ) : (
        <>
          <View style={{ gap: 16, margin: aiTokens.space.md }}>
            <ContentSearch kind="活動" value={search} onChange={setSearch} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <ContentFilter
                label="全部"
                selected={period === 'all'}
                onPress={() => setPeriod('all')}
              />
              <ContentFilter
                label="進行中"
                selected={period === 'ongoing'}
                onPress={() => setPeriod('ongoing')}
              />
              <ContentFilter
                label="未來活動"
                selected={period === 'upcoming'}
                onPress={() => setPeriod('upcoming')}
              />
              <ContentFilter
                label="已開始／過往"
                selected={period === 'past'}
                onPress={() => setPeriod('past')}
              />
              <ContentFilter
                label="時間待公告"
                selected={period === 'undated'}
                onPress={() => setPeriod('undated')}
              />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Text
                accessibilityLiveRegion="polite"
                style={{ flex: 1, minWidth: 160, color: aiTokens.muted, lineHeight: 21 }}
              >
                {filtered ? `找到 ${visible.length} 場` : `${visible.length} 場活動`}
              </Text>
              {filtered ? (
                <AIButton label="清除活動篩選" variant="ghost" onPress={resetFilters} />
              ) : null}
            </View>
          </View>
          <AISection
            title="學校活動"
            subtitle={`已載入 ${content.items.length} 場；篩選與日期排序僅適用已載入的活動。`}
          >
            {visible.length ? (
              visible.map((row, index) => (
                <ContentRow
                  key={`${row.source}:${row.id}`}
                  first={index === 0}
                  kind="活動"
                  labels={[
                    campusEventPhaseLabel(campusEventPhase(row, now)),
                    row.source === 'school-club-events' && row.appRegistrationConfigured
                      ? registrations.uid
                        ? eventRegistrationLabel(
                            registrations.states.find((state) => state.eventId === row.id),
                          )
                        : '登入確認報名'
                      : undefined,
                  ]}
                  title={row.title}
                  subtitle={[dateLabel(row.startsAt), row.location, row.organizer]
                    .filter(Boolean)
                    .join(' · ')}
                  preview={row.description}
                  onPress={() => {
                    if (content.current())
                      safeNavigate(navigation, '活動詳情', { id: row.id, source: row.source });
                  }}
                />
              ))
            ) : (
              <AICard
                title={content.items.length ? '已載入的活動中沒有符合項目' : '目前沒有活動資訊'}
              >
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                  {content.cursor
                    ? '可以繼續載入活動，或調整搜尋與篩選。'
                    : filtered
                      ? '試著改用其他關鍵字，或清除篩選。'
                      : '主辦單位發布後會顯示在這裡。'}
                </Text>
              </AICard>
            )}
          </AISection>
          {content.error ? (
            <AICard>
              <View style={{ gap: 12 }}>
                <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                  {content.error}
                </Text>
                <AIButton
                  label="重試載入"
                  disabled={content.loading}
                  onPress={() => void content.retry()}
                />
              </View>
            </AICard>
          ) : null}
          {registrations.error ? (
            <AICard>
              <Text style={{ color: aiTokens.danger }}>無法確認目前的報名狀態。</Text>
              <AIButton label="重試報名狀態" onPress={() => void registrations.reload()} />
            </AICard>
          ) : null}
          <View style={{ gap: 12, margin: aiTokens.space.md }}>
            {content.cursor ? (
              <AIButton
                label={content.loading ? '正在載入…' : '載入更多活動'}
                disabled={content.loading}
                onPress={() => void content.loadMore()}
              />
            ) : null}
            <AIButton
              label={content.loading && !content.cursor ? '正在更新…' : '更新活動'}
              variant="ghost"
              disabled={content.loading}
              onPress={() => void content.reload()}
            />
          </View>
        </>
      )}
    </AIDetailScreen>
  );
}

export function CampusEventDetailScreen({ navigation, route }: Props) {
  const id = route?.params?.id ?? route?.params?.eventId ?? '';
  const source = route?.params?.source;
  const loader = useCallback(
    (schoolId: string, eventId: string) => loadCampusEvent(schoolId, eventId, source),
    [source],
  );
  const content = useContent(loader, id, source);
  const event = content.value;
  const actionLock = useRef(false);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ scope: string; text: string } | null>(null);
  const run = async (action: 'share' | 'calendar') => {
    if (!event || !content.current() || actionLock.current) return;
    actionLock.current = true;
    setBusyScope(content.scope);
    setActionError(null);
    try {
      if (action === 'share') {
        await Share.share({
          title: event.title,
          message: [
            event.title,
            dateLabel(event.startsAt),
            event.location,
            event.organizer,
            event.description,
          ]
            .filter(Boolean)
            .join('\n'),
        });
      } else {
        if (!content.current() || !event.startsAt) return;
        const startDate = new Date(event.startsAt);
        const endDate = event.endsAt ? new Date(event.endsAt) : undefined;
        if (!Number.isFinite(startDate.getTime())) return;
        await exportAndShareICalFile(
          [
            {
              id: `campus-event-${event.schoolId}-${event.source}-${event.id}`,
              title: event.title,
              description: event.description,
              location: event.location,
              startDate,
              endDate: endDate && endDate > startDate ? endDate : undefined,
            },
          ],
          'campus-event.ics',
          'Campus One 活動',
        );
      }
    } catch {
      if (content.current())
        setActionError({
          scope: content.scope,
          text:
            action === 'share'
              ? '無法開啟分享，請稍後重試。'
              : '無法匯出行事曆，請確認裝置支援檔案分享後重試。',
        });
    } finally {
      actionLock.current = false;
      if (content.current()) setBusyScope(null);
    }
  };
  return (
    <AIDetailScreen title="活動詳情" onBack={() => navigation?.goBack?.()}>
      {content.loading || content.error || !event ? (
        <ReadState {...content} empty="找不到這場活動，可能已移除或不屬於目前學校。" />
      ) : (
        <>
          <AICard title={event.title}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: aiTokens.text, lineHeight: 22 }}>
                {dateLabel(event.startsAt)}
                {event.endsAt ? ` 至 ${dateLabel(event.endsAt)}` : ''}
              </Text>
              <Text style={{ color: aiTokens.muted }}>地點：{event.location || '尚未公布'}</Text>
              <Text style={{ color: aiTokens.muted }}>主辦：{event.organizer || '尚未公布'}</Text>
              {event.fee != null ? (
                <Text style={{ color: aiTokens.muted }}>
                  費用：{event.fee === 0 ? '免費' : `NT$ ${event.fee}`}
                </Text>
              ) : null}
            </View>
          </AICard>
          <AICard title="活動介紹">
            <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
              {event.description || '主辦單位尚未提供活動介紹。'}
            </Text>
          </AICard>
          {event.source === 'school-club-events' && event.appRegistrationConfigured ? (
            <EventRegistrationPanel eventId={event.id} />
          ) : (
            <AICard title="報名方式">
              <View style={{ gap: 8 }}>
                {event.registrationDeadline ? (
                  <Text style={{ color: aiTokens.text }}>
                    報名截止：{dateLabel(event.registrationDeadline)}
                  </Text>
                ) : null}
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                  請依活動介紹中的方式向主辦單位報名。目前此頁提供活動資訊，不受理報名或付款。
                </Text>
              </View>
            </AICard>
          )}
          <AICard title="安排參加">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                將活動分享給朋友，或匯出檔案後加入自己的行事曆。加入行事曆不代表完成報名。
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <AIButton
                  label="分享活動"
                  disabled={busyScope === content.scope}
                  onPress={() => void run('share')}
                />
                <AIButton
                  label="匯出行事曆"
                  variant="ghost"
                  disabled={
                    busyScope === content.scope ||
                    !Number.isFinite(Date.parse(event.startsAt ?? ''))
                  }
                  onPress={() => void run('calendar')}
                />
              </View>
            </View>
          </AICard>
          {actionError?.scope === content.scope ? (
            <AICard>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {actionError.text}
              </Text>
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}
