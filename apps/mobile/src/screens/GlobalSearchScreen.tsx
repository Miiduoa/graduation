import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { Screen } from '../ui/components';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { useTheme } from '../state/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { useSearchHistory, POPULAR_SEARCHES } from '../state/searchHistory';
import { useDataSource } from '../hooks/useDataSource';
import { useAsyncList } from '../hooks/useAsyncList';
import { formatDateTime } from '../utils/format';
import { safeNavigate } from '../utils/safeNavigate';
import { navigateFromInboxTask } from '../services/inboxActions';
import { isTeachingRole } from '../utils/campusOs';
import { getDb } from '../firebase';
import { getMobileQuickActions, getMobileActionsForDestinations } from '../services/quickCampusActions';
import { interpretMobileCampusRequest } from '../services/campusIntentClient';
import type { InboxTask } from '../data/types';

type Category =
  | 'all'
  | 'services'
  | 'announcements'
  | 'events'
  | 'courses'
  | 'pois'
  | 'menus'
  | 'groups';
type ResultKind =
  | 'service'
  | 'announcement'
  | 'event'
  | 'course'
  | 'poi'
  | 'menu'
  | 'post'
  | 'assignment';
type Navigation = Parameters<typeof safeNavigate>[0];
type SearchResult = {
  id: string;
  type: ResultKind;
  title: string;
  subtitle: string;
  excerpt?: string;
  screen: string;
  params?: Record<string, unknown>;
  task?: InboxTask;
};
type GroupContent = {
  id: string;
  groupId: string;
  title?: string;
  body?: string;
  description?: string;
  authorName?: string;
  dueAt?: unknown;
  type?: string;
  kind?: string;
  category?: string;
  isExam?: boolean;
};
type GroupState = {
  posts: GroupContent[];
  assignments: GroupContent[];
  loading: boolean;
  error: boolean;
  limited: boolean;
};

const PAGE_SIZE = 30;
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'services', label: '工具' },
  { key: 'announcements', label: '公告' },
  { key: 'events', label: '活動' },
  { key: 'courses', label: '課程' },
  { key: 'pois', label: '地點' },
  { key: 'menus', label: '餐點' },
  { key: 'groups', label: '群組與作業' },
];
const TYPE_LABEL: Record<ResultKind, string> = {
  service: '工具',
  announcement: '公告',
  event: '活動',
  course: '課程',
  poi: '地點',
  menu: '餐點',
  post: '群組貼文',
  assignment: '作業',
};
const TYPE_ICON: Record<ResultKind, React.ComponentProps<typeof Ionicons>['name']> = {
  service: 'grid-outline',
  announcement: 'megaphone-outline',
  event: 'calendar-outline',
  course: 'school-outline',
  poi: 'location-outline',
  menu: 'restaurant-outline',
  post: 'chatbubble-outline',
  assignment: 'document-text-outline',
};
const TOOLS: Array<SearchResult & { keywords: string }> = [
  {
    id: 'timetable',
    type: 'service',
    title: '我的課表',
    subtitle: '一週課程、空堂與分享',
    screen: 'PersonalTimetable',
    keywords: '課表 時間表 空堂 timetable',
  },
  {
    id: 'import',
    type: 'service',
    title: '匯入我的資料',
    subtitle: '匯入課表、成績與行事曆',
    screen: 'PersonalImport',
    keywords: '匯入 截圖 檔案 成績',
  },
  {
    id: 'calendar',
    type: 'service',
    title: '個人行事曆',
    subtitle: '查看行程與新增安排',
    screen: 'PersonalCalendar',
    keywords: '行事曆 行程 日曆 提醒',
  },
  {
    id: 'catalog',
    type: 'service',
    title: '課綱查詢',
    subtitle: '搜尋課程內容與授課資訊',
    screen: 'CourseCatalog',
    keywords: '課綱 選課 課號 老師 教師 課程',
  },
  {
    id: 'dining',
    type: 'service',
    title: '校園餐廳',
    subtitle: '找餐廳、看菜單',
    screen: '餐廳總覽',
    keywords: '餐廳 菜單 點餐 食堂 吃飯',
  },
  {
    id: 'library',
    type: 'service',
    title: '圖書館',
    subtitle: '館藏查詢與圖書館資訊',
    screen: 'Library',
    keywords: '圖書館 借書 還書 館藏 自習',
  },
  {
    id: 'bus',
    type: 'service',
    title: '校園公車',
    subtitle: '查路線、站牌與到站時間',
    screen: 'BusV2',
    keywords: '公車 校車 搭車 交通 到站',
  },
  {
    id: 'map',
    type: 'service',
    title: '校園地圖',
    subtitle: '找大樓與校園設施',
    screen: 'MapV2',
    keywords: '地圖 教室 大樓 導航 設施',
  },
  {
    id: 'events',
    type: 'service',
    title: '校園活動',
    subtitle: '活動內容與報名方式',
    screen: '活動總覽',
    keywords: '活動 社團 講座 報名',
  },
  {
    id: 'lost',
    type: 'service',
    title: '失物招領',
    subtitle: '找失物、刊登撿到的物品',
    screen: 'LostFound',
    keywords: '失物 遺失 招領 撿到',
  },
];
const EMPTY_GROUPS: GroupState = {
  posts: [],
  assignments: [],
  loading: false,
  error: false,
  limited: false,
};

function matches(text: string, keyword: string) {
  return text.toLocaleLowerCase().includes(keyword);
}

export function GlobalSearchScreen({ navigation }: { navigation?: Navigation }) {
  const auth = useAuth();
  const { school } = useSchool();
  const scopeKey = JSON.stringify([
    school.id,
    auth.user?.uid,
    auth.loading,
    auth.profileLoading,
    auth.tokenExpired,
    auth.profile?.uid,
    auth.profile?.role,
  ]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return (
    <SearchWorkspace
      key={scopeKey}
      navigation={navigation}
      scopeKey={scopeKey}
      activeScope={activeScope}
    />
  );
}

function SearchWorkspace({
  navigation,
  scopeKey,
  activeScope,
}: {
  navigation?: Navigation;
  scopeKey: string;
  activeScope: React.MutableRefObject<string>;
}) {
  const theme = useTheme();
  const bottomPadding = useTabBarContentBottomPadding();
  const { school } = useSchool();
  const auth = useAuth();
  const ds = useDataSource();
  const history = useSearchHistory();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [focused, setFocused] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [groupAttempt, setGroupAttempt] = useState(0);
  const [groups, setGroups] = useState<GroupState>(EMPTY_GROUPS);
  const [understanding, setUnderstanding] = useState<{
    phrase: string;
    status: 'loading' | 'ready' | 'error';
    result?: CampusSemanticResult;
  } | null>(null);
  const semanticSequence = useRef(0);
  useEffect(() => () => { semanticSequence.current += 1; }, []);
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<SearchResult>>(null);
  const keyword = text.trim().toLocaleLowerCase();
  const searching = Boolean(keyword);
  const uid = auth.user?.uid;
  const privateReady = Boolean(
    uid && !auth.loading && !auth.profileLoading && !auth.tokenExpired && auth.profile?.uid === uid,
  );

  const announcements = useAsyncList(
    () => (searching ? ds.listAnnouncements(school.id) : Promise.resolve([])),
    [ds, school.id, searching],
  );
  const events = useAsyncList(
    () => (searching ? ds.listEvents(school.id) : Promise.resolve([])),
    [ds, school.id, searching],
  );
  const courses = useAsyncList(
    () => (searching ? ds.listCourses(school.id) : Promise.resolve([])),
    [ds, school.id, searching],
  );
  const pois = useAsyncList(
    () => (searching ? ds.listPois(school.id) : Promise.resolve([])),
    [ds, school.id, searching],
  );
  const menus = useAsyncList(
    () => (searching ? ds.listMenus(school.id) : Promise.resolve([])),
    [ds, school.id, searching],
  );

  useEffect(() => {
    if (!searching || !privateReady || !uid) return;
    let cancelled = false;
    const isCurrent = () => !cancelled && activeScope.current === scopeKey;
    setGroups({ ...EMPTY_GROUPS, loading: true });
    async function load() {
      try {
        const db = getDb();
        const memberships = await getDocs(
          query(
            collection(db, 'users', uid!, 'groups'),
            where('schoolId', '==', school.id),
            where('status', '==', 'active'),
            limit(21),
          ),
        );
        if (!isCurrent()) return;
        const groupIds = Array.from(
          new Set(
            memberships.docs
              .map((doc) => {
                const data = doc.data();
                return typeof data.groupId === 'string' ? data.groupId : doc.id;
              })
              .filter(Boolean),
          ),
        ).slice(0, 20);
        const pages = await Promise.all(
          groupIds.map(async (groupId) => {
            const [posts, assignments] = await Promise.allSettled([
              getDocs(
                query(
                  collection(db, 'groups', groupId, 'posts'),
                  orderBy('createdAt', 'desc'),
                  limit(31),
                ),
              ),
              getDocs(
                query(
                  collection(db, 'groups', groupId, 'assignments'),
                  orderBy('createdAt', 'desc'),
                  limit(21),
                ),
              ),
            ]);
            return { groupId, posts, assignments };
          }),
        );
        if (!isCurrent()) return;
        const next: GroupState = {
          ...EMPTY_GROUPS,
          posts: [],
          assignments: [],
          limited: memberships.docs.length > 20,
        };
        for (const page of pages) {
          for (const [key, maximum] of [
            ['posts', 30],
            ['assignments', 20],
          ] as const) {
            const result = page[key];
            if (result.status === 'fulfilled') {
              next.limited ||= result.value.docs.length > maximum;
              next[key].push(
                ...result.value.docs.slice(0, maximum).map((doc) => ({
                  ...doc.data(),
                  id: doc.id,
                  groupId: page.groupId,
                })),
              );
            } else next.error = true;
          }
        }
        setGroups(next);
      } catch {
        if (isCurrent()) setGroups({ ...EMPTY_GROUPS, error: true });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeScope, groupAttempt, privateReady, school.id, scopeKey, searching, uid]);

  const results = useMemo<SearchResult[]>(() => {
    if (!keyword) return [];
    const output: SearchResult[] = [];
    const includes = (value: Category) => category === 'all' || category === value;
    const belongsHere = (row: { schoolId?: string }) =>
      !row.schoolId || toPublicSchoolId(row.schoolId) === toPublicSchoolId(school.id);
    if (includes('services'))
      output.push(...TOOLS.filter((tool) => matches(`${tool.title} ${tool.keywords}`, keyword)));
    if (includes('announcements'))
      announcements.items.filter(belongsHere).forEach((row) => {
        if (
          !matches(
            `${row.title} ${row.body} ${row.summary ?? ''} ${row.source ?? ''} ${row.office ?? ''}`,
            keyword,
          )
        )
          return;
        output.push({
          id: row.id,
          type: 'announcement',
          title: row.title || '未命名公告',
          subtitle: [row.source, formatDateTime(row.publishedAt)].filter(Boolean).join(' · '),
          excerpt: row.body || row.summary,
          screen: '公告詳情',
          params: { id: row.id },
        });
      });
    if (includes('events'))
      events.items.filter(belongsHere).forEach((row) => {
        if (!matches(`${row.title} ${row.description} ${row.location ?? ''}`, keyword)) return;
        const source = 'source' in row && typeof row.source === 'string' ? row.source : undefined;
        output.push({
          id: `${source ?? ''}:${row.id}`,
          type: 'event',
          title: row.title || '未命名活動',
          subtitle: [formatDateTime(row.startsAt), row.location].filter(Boolean).join(' · '),
          excerpt: row.description,
          screen: '活動詳情',
          params: { id: row.id, ...(source ? { source } : {}) },
        });
      });
    if (includes('courses'))
      courses.items.filter(belongsHere).forEach((row) => {
        if (
          !matches(
            `${row.code} ${row.name} ${row.instructor} ${row.teacher ?? ''} ${row.department ?? ''} ${row.description ?? ''}`,
            keyword,
          )
        )
          return;
        output.push({
          id: row.id,
          type: 'course',
          title: [row.code, row.name].filter(Boolean).join(' · ') || '未命名課程',
          subtitle: [
            row.instructor || row.teacher,
            row.semester,
            row.schedule?.[0]?.location || row.location,
          ]
            .filter(Boolean)
            .join(' · '),
          excerpt: row.description,
          screen: 'CourseCatalog',
          params: {
            filter: {
              keyword: row.code || row.name,
              ...(/^\d{3}[12]$/.test(row.semester) ? { semester: row.semester } : {}),
            },
          },
        });
      });
    if (includes('pois'))
      pois.items.filter(belongsHere).forEach((row) => {
        if (
          !matches(
            `${row.name} ${row.description ?? ''} ${row.building ?? ''} ${row.category}`,
            keyword,
          )
        )
          return;
        output.push({
          id: row.id,
          type: 'poi',
          title: row.name || '未命名地點',
          subtitle: row.building || school.name,
          excerpt: row.description,
          screen: 'PoiDetail',
          params: { id: row.id },
        });
      });
    if (includes('menus'))
      menus.items.filter(belongsHere).forEach((row) => {
        if (!matches(`${row.name} ${row.cafeteria} ${row.description ?? ''}`, keyword)) return;
        output.push({
          id: `${row.cafeteriaId ?? ''}:${row.id}`,
          type: 'menu',
          title: row.name || '未命名餐點',
          subtitle: [
            row.cafeteria,
            typeof row.price === 'number' && Number.isFinite(row.price)
              ? `NT$ ${row.price}`
              : '價格依店家公告',
          ]
            .filter(Boolean)
            .join(' · '),
          excerpt: row.description,
          screen: row.cafeteriaId ? 'Storefront' : '餐廳總覽',
          params: row.cafeteriaId ? { cafeteriaId: row.cafeteriaId } : undefined,
        });
      });
    if (includes('groups') && privateReady) {
      groups.posts.forEach((row) => {
        if (!matches(`${row.title ?? ''} ${row.body ?? ''} ${row.authorName ?? ''}`, keyword))
          return;
        output.push({
          id: `${row.groupId}:${row.id}`,
          type: 'post',
          title: row.title || row.body?.slice(0, 50) || '群組貼文',
          subtitle: row.authorName || '我的群組',
          excerpt: row.body,
          screen: 'GroupPost',
          params: { groupId: row.groupId, postId: row.id },
        });
      });
      groups.assignments.forEach((row) => {
        if (!matches(`${row.title ?? ''} ${row.description ?? ''}`, keyword)) return;
        const title = row.title || '未命名作業';
        const subtitle = row.dueAt ? `截止：${formatDateTime(row.dueAt)}` : '未設定截止時間';
        output.push({
          id: `${row.groupId}:${row.id}`,
          type: 'assignment',
          title,
          subtitle,
          excerpt: row.description,
          screen: 'AssignmentDetail',
          params: { groupId: row.groupId, assignmentId: row.id },
          task: {
            id: `search:${row.groupId}:${row.id}`,
            kind:
              row.type === 'quiz' ||
              row.kind === 'quiz' ||
              row.category === 'exam' ||
              row.isExam === true
                ? 'quiz'
                : 'assignment',
            groupId: row.groupId,
            groupName: '課程',
            title,
            subtitle,
            priority: 3,
            assignmentId: row.id,
          },
        });
      });
    }
    return output;
  }, [
    keyword,
    category,
    school.id,
    school.name,
    announcements.items,
    events.items,
    courses.items,
    pois.items,
    menus.items,
    groups,
    privateReady,
  ]);

  const sources = [
    { category: 'announcements', label: '公告', ...announcements },
    { category: 'events', label: '活動', ...events },
    { category: 'courses', label: '課程', ...courses },
    { category: 'pois', label: '地點', ...pois },
    { category: 'menus', label: '餐點', ...menus },
    ...(privateReady
      ? [
          {
            category: 'groups',
            label: '群組與作業',
            ...groups,
            reload: () => setGroupAttempt((value) => value + 1),
          },
        ]
      : []),
  ].filter((source) => category === 'all' || category === source.category);
  const pending = searching && sources.some((source) => source.loading);
  const failed = sources.filter((source) => source.error);
  const limitedGroups =
    privateReady && groups.limited && (category === 'all' || category === 'groups');
  const groupLoginNeeded = category === 'groups' && !privateReady;
  const recent = history.recentSearches('all', 8);
  const activeUnderstanding = understanding?.phrase === text.trim() ? understanding : null;
  const semantic = activeUnderstanding?.status === 'ready' ? activeUnderstanding.result : undefined;
  const quickActions = searching && category === 'all'
    ? semantic?.status === 'understood'
      ? getMobileActionsForDestinations(semantic.destinations)
      : getMobileQuickActions(text)
    : [];

  async function analyze(raw: string) {
    const utterance = raw.trim().slice(0, 120);
    if (!uid || !privateReady || !utterance) return;
    const request = ++semanticSequence.current;
    setUnderstanding({ phrase: utterance, status: 'loading' });
    try {
      const result = await interpretMobileCampusRequest({
        uid,
        schoolId: school.id,
        utterance,
        isCurrent: () => activeScope.current === scopeKey && semanticSequence.current === request,
      });
      if (activeScope.current === scopeKey && semanticSequence.current === request) {
        setUnderstanding({ phrase: utterance, status: 'ready', result });
      }
    } catch {
      if (activeScope.current === scopeKey && semanticSequence.current === request) {
        setUnderstanding({ phrase: utterance, status: 'error' });
      }
    }
  }

  const changeText = (value: string) => {
    semanticSequence.current += 1;
    setUnderstanding(null);
    setText(value);
    setVisibleCount(PAGE_SIZE);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const chooseCategory = (value: Category) => {
    setCategory(value);
    setVisibleCount(PAGE_SIZE);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const remember = () => {
    if (activeScope.current === scopeKey && text.trim()) history.addSearch(text.trim(), 'all');
  };
  const open = (result: SearchResult) => {
    if (activeScope.current !== scopeKey) return;
    if ((result.type === 'post' || result.type === 'assignment') && !privateReady) return;
    remember();
    Keyboard.dismiss();
    if (
      result.task &&
      navigateFromInboxTask(navigation, result.task, {
        role: auth.profile?.role,
        isTeachingRole: isTeachingRole(auth.profile?.role),
      })
    )
      return;
    safeNavigate(navigation, result.screen, result.params, {
      fallbackMessage: '目前無法開啟這筆內容，請回到所屬服務再試一次。',
    });
  };
  const retry = () => {
    if (activeScope.current !== scopeKey) return;
    failed.forEach((source) => source.reload());
  };
  const renderResult = ({ item }: { item: SearchResult }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_LABEL[item.type]}：${item.title}`}
      onPress={() => open(item)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.bg,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={TYPE_ICON[item.type]} size={20} color={theme.colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
          {TYPE_LABEL[item.type]}
        </Text>
        <Text
          numberOfLines={2}
          style={{ ...theme.typography.body, fontWeight: '600', color: theme.colors.text }}
        >
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text
            numberOfLines={2}
            style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}
          >
            {item.subtitle}
          </Text>
        ) : null}
        {item.excerpt ? (
          <Text
            numberOfLines={2}
            style={{ ...theme.typography.caption, color: theme.colors.muted }}
          >
            {item.excerpt}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={theme.colors.muted}
        style={{ marginTop: 12 }}
      />
    </Pressable>
  );
  const pill = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: theme.radius.full,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
      })}
    >
      <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen noPadding>
      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: 12,
          gap: 12,
        }}
      >
        <Text numberOfLines={1} style={{ ...theme.typography.caption, color: theme.colors.muted }}>
          {school.name} · 校園搜尋
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minHeight: 52,
            borderWidth: 1,
            borderColor: focused ? theme.colors.accent : theme.colors.border,
            borderRadius: theme.radius.lg,
            paddingLeft: 14,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
          <TextInput
            ref={input}
            accessibilityLabel="搜尋校園內容"
            value={text}
            onChangeText={changeText}
            placeholder="例如：我想交作業，或搜尋課號"
            placeholderTextColor={theme.colors.muted}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              remember();
              Keyboard.dismiss();
              if (privateReady) void analyze(text);
            }}
            returnKeyType="search"
            maxLength={120}
            autoCorrect={false}
            style={{
              flex: 1,
              minHeight: 50,
              paddingVertical: 12,
              color: theme.colors.text,
              ...theme.typography.body,
            }}
          />
          {text ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除搜尋"
              onPress={() => {
                changeText('');
                input.current?.focus();
              }}
              style={{
                minHeight: 48,
                minWidth: 48,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close-circle" size={20} color={theme.colors.muted} />
            </Pressable>
          ) : (
            <View style={{ width: 12 }} />
          )}
        </View>
        {searching && privateReady && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="用 AI 理解校園搜尋"
            accessibilityState={{ disabled: activeUnderstanding?.status === 'loading' }}
            disabled={activeUnderstanding?.status === 'loading'}
            onPress={() => {
              Keyboard.dismiss();
              void analyze(text);
            }}
            style={{
              minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center',
              borderRadius: 11, backgroundColor: theme.colors.accent,
              opacity: activeUnderstanding?.status === 'loading' ? 0.6 : 1,
              paddingHorizontal: 15,
            }}
          >
            <Text style={{ ...theme.typography.bodySmall, fontWeight: '700', color: theme.colors.onAccent }}>
              {activeUnderstanding?.status === 'loading' ? 'AI 正在理解…' : '用 AI 理解校園需求'}
            </Text>
          </Pressable>
        )}
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8, paddingBottom: 2 }}
          >
            {CATEGORIES.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityLabel={`搜尋分類：${item.label}`}
                accessibilityState={{ selected: category === item.key }}
                onPress={() => chooseCategory(item.key)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 15,
                  paddingVertical: 9,
                  borderRadius: theme.radius.full,
                  borderWidth: 1,
                  borderColor: category === item.key ? theme.colors.accent : theme.colors.border,
                  backgroundColor:
                    category === item.key
                      ? theme.colors.accentSoft
                      : pressed
                        ? theme.colors.surface2
                        : theme.colors.bg,
                })}
              >
                <Text
                  style={{
                    ...theme.typography.bodySmall,
                    color: category === item.key ? theme.colors.accent : theme.colors.textSecondary,
                    fontWeight: category === item.key ? '600' : '400',
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {searching ? (
          <FlatList
            ref={list}
            data={results.slice(0, visibleCount)}
            keyExtractor={(item) => `${item.type}:${item.id}`}
            renderItem={renderResult}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: bottomPadding, flexGrow: 1 }}
            ListHeaderComponent={
              <View style={{ gap: 12, paddingVertical: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {pending ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.accent}
                      accessibilityLabel="讀取搜尋內容"
                    />
                  ) : null}
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}
                  >
                    {pending
                      ? `已找到 ${results.length} 筆 · 繼續讀取中`
                      : `已載入內容中找到 ${results.length} 筆`}
                  </Text>
                </View>
                {semantic?.source === 'model' && (
                  <View style={{
                    padding: 14, gap: 7,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: 12,
                  }}>
                    <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>
                      {semantic.status === 'clarify' ? '需要再確認' : 'AI 理解的需求'}
                    </Text>
                    <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text }}>
                      {semantic.summary}
                    </Text>
                    {semantic.clarifyingQuestion && (
                      <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                        {semantic.clarifyingQuestion}
                      </Text>
                    )}
                  </View>
                )}
                {(activeUnderstanding?.status === 'error' || semantic?.status === 'unavailable') && (
                  <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
                    AI 暫時無法理解。下方僅顯示基本關鍵字捷徑。
                  </Text>
                )}
                {quickActions.length > 0 ? (
                  <View
                    style={{
                      gap: 9,
                      padding: 14,
                      backgroundColor: theme.colors.surface,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>
                      {semantic?.status === 'understood' ? 'AI 建議直接開啟' : '直接開啟'}
                    </Text>
                    {quickActions.map((action) => (
                      <Pressable
                        key={action.destination}
                        accessibilityRole="button"
                        accessibilityLabel={'前往' + action.label}
                        onPress={() => {
                          if (activeScope.current !== scopeKey) return;
                          remember();
                          Keyboard.dismiss();
                          safeNavigate(navigation, action.route, action.params);
                        }}
                        style={({ pressed }) => ({
                          minHeight: 52,
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 12,
                          gap: 10,
                          borderRadius: 10,
                          backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
                        })}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ ...theme.typography.body, fontWeight: '600', color: theme.colors.text }}>
                            {action.label}
                          </Text>
                          <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
                            {action.description}
                          </Text>
                          {semantic?.previews?.filter((preview) => preview.destination === action.destination).map((preview) => (
                            <View key={preview.destination} style={{
                              marginTop: 7, paddingTop: 8,
                              borderTopWidth: 1, borderTopColor: theme.colors.border, gap: 3,
                            }}>
                              <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
                                {preview.source === 'campus-platform' ? 'Campus One 資料' : '接通狀態'}：{preview.message}
                              </Text>
                              {preview.items.map((item, index) => (
                                <Text key={index} style={{ ...theme.typography.caption, color: theme.colors.text }}>
                                  {item.title}{item.detail ? ' · ' + item.detail : ''}
                                </Text>
                              ))}
                            </View>
                          ))}
                        </View>
                        <Ionicons name="arrow-forward" size={18} color={theme.colors.accent} />
                      </Pressable>
                    ))}
                    <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
                      只會開啟服務，正式操作仍需自行確認。
                    </Text>
                  </View>
                ) : null}
                {failed.length ? (
                  <View
                    accessibilityRole="alert"
                    style={{
                      padding: 14,
                      gap: 8,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text }}>
                      {failed.map((source) => source.label).join('、')}
                      暫時讀不到，其他結果仍可開啟。
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={retry}
                      style={{
                        minHeight: 44,
                        justifyContent: 'center',
                        alignSelf: 'flex-start',
                        paddingRight: 16,
                      }}
                    >
                      <Text
                        style={{
                          ...theme.typography.bodySmall,
                          color: theme.colors.accent,
                          fontWeight: '600',
                        }}
                      >
                        重試未載入內容
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {limitedGroups ? (
                  <View style={{ gap: 4 }}>
                    <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
                      群組搜尋只包含最近的貼文與作業；較早內容請到所屬群組查看。
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => safeNavigate(navigation, 'Groups')}
                      style={{ minHeight: 44, justifyContent: 'center' }}
                    >
                      <Text style={{ ...theme.typography.bodySmall, color: theme.colors.accent }}>
                        前往我的群組
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <View style={{ paddingVertical: 36, gap: 10 }}>
                <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>
                  {groupLoginNeeded
                    ? '登入後搜尋自己的群組'
                    : pending
                      ? '正在尋找符合的內容'
                      : failed.length
                        ? '部分內容尚未載入'
                        : quickActions.length
                          ? '可使用上方推薦的服務'
                          : '沒有符合的結果'}
                </Text>
                <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                  {groupLoginNeeded
                    ? '公開公告、活動與工具仍可使用。'
                    : pending
                      ? '讀取完成後，結果會直接顯示在這裡。'
                      : failed.length
                        ? '保留這次搜尋，稍後可重試讀取。'
                        : quickActions.length
                          ? '依需求選擇上方入口，或改用較短的關鍵字搜尋校園內容。'
                          : `試試較短的關鍵字${category === 'all' ? '，或改用課號、教師姓名。' : '，或查看全部分類。'}`}
                </Text>
                {groupLoginNeeded
                  ? pill('前往登入', () => safeNavigate(navigation, 'SSOLogin'))
                  : null}
                {!pending && category !== 'all'
                  ? pill('查看全部分類', () => chooseCategory('all'))
                  : null}
                {privateReady && category === 'all' && !pending
                  ? pill('改問校園助理', () => {
                      Keyboard.dismiss();
                      safeNavigate(navigation, 'AIChat', { prompt: text.trim() });
                    })
                  : null}
              </View>
            }
            ListFooterComponent={
              results.length > visibleCount ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  style={{
                    minHeight: 52,
                    marginTop: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.md,
                  }}
                >
                  <Text
                    style={{
                      ...theme.typography.bodySmall,
                      fontWeight: '600',
                      color: theme.colors.accent,
                    }}
                  >
                    顯示更多（還有 {results.length - visibleCount} 筆）
                  </Text>
                </Pressable>
              ) : null
            }
          />
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: bottomPadding, gap: 24 }}
          >
            <View style={{ gap: 8 }}>
              <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>直接開啟</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TOOLS.filter((tool) =>
                  ['timetable', 'dining', 'library', 'bus'].includes(tool.id),
                ).map((tool) => pill(tool.title, () => open(tool)))}
              </View>
            </View>
            {recent.length ? (
              <View style={{ gap: 10 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>最近搜尋</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清除搜尋紀錄"
                    onPress={history.clearHistory}
                    style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 16 }}
                  >
                    <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                      清除
                    </Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {recent.map((item) =>
                    pill(item.query, () => {
                      changeText(item.query);
                      Keyboard.dismiss();
                    }),
                  )}
                </View>
              </View>
            ) : null}
            <View style={{ gap: 10 }}>
              <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>試著搜尋</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {POPULAR_SEARCHES.all.map((term) =>
                  pill(term, () => {
                    changeText(term);
                    Keyboard.dismiss();
                  }),
                )}
              </View>
            </View>
            <Text style={{ ...theme.typography.caption, color: theme.colors.muted }}>
              搜尋目前學校已載入的公開內容；登入後也可查看自己的群組與作業。
            </Text>
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}
