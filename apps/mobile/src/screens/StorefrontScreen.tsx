import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../ui/components';
import { AIDetailScreen } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme, theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { LoginRequiredLostFoundComments } from '../components/LoginRequiredLostFoundComments';
import {
  LOGIN_REQUIRED_COMMENTS_TEXT,
  isPermissionDeniedError,
} from '@campus/shared/src/signedInSocialReads';
import {
  addStorefrontComment,
  followStorefront,
  isFollowingStorefront,
  loadStorefront,
  loadStorefrontComments,
  loadStorefrontMenus,
  loadStorefrontPosts,
  toggleStorefrontLike,
  type StorefrontComment,
  type StorefrontMenuItem,
  type StorefrontPost,
  type StorefrontShop,
} from '../services/storefront';
import {
  MENU_STALE_TEXT,
  SHOWCASE_EXTERNAL_ORDER_HINT,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  isMenuStale,
  safeStorefrontUrl,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';
import {
  CAFETERIA_BACK_TO_LIST_TEXT,
  CAFETERIA_NOT_FOUND_TEXT,
  STOREFRONT_EMPTY_MENU_TEXT,
  STOREFRONT_PAGE_SUBTITLE,
  cafeteriaReviewNotice,
  cafeteriaShowsMenuAvailability,
} from '@campus/shared/src/cafeteriaCatalog';
import { SERVICE_PAUSED_TEXT } from '@campus/shared/src/loadFailureCopy';

type Props = {
  navigation?: {
    goBack?: () => void;
    canGoBack?: () => boolean;
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { cafeteriaId?: string; id?: string } };
};

export default function StorefrontScreen({ navigation, route }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const cafeteriaId = route?.params?.cafeteriaId || route?.params?.id || '';
  const auth = useAuth();
  const { school } = useSchool();
  return (
    <StorefrontContent
      key={`${school.id}:${cafeteriaId}:${auth.user?.uid ?? 'guest'}`}
      cafeteriaId={cafeteriaId}
      schoolId={school.id}
      auth={auth}
      navigation={navigation}
    />
  );
}

function StorefrontContent({
  cafeteriaId,
  schoolId,
  auth,
  navigation,
}: {
  cafeteriaId: string;
  schoolId: string;
  auth: ReturnType<typeof useAuth>;
  navigation: Props['navigation'];
}) {
  const { user, loading: authLoading } = auth;
  const signedIn = Boolean(user?.uid);
  const [shop, setShop] = useState<StorefrontShop | null | undefined>(undefined);
  const [menus, setMenus] = useState<StorefrontMenuItem[]>([]);
  const [posts, setPosts] = useState<StorefrontPost[]>([]);
  const [following, setFollowing] = useState(false);
  const [followingBusy, setFollowingBusy] = useState(false);
  const [followingReady, setFollowingReady] = useState(false);
  const [followReadError, setFollowReadError] = useState(false);
  const [socialBlocked, setSocialBlocked] = useState(false);
  const [error, setError] = useState('');
  const [menuError, setMenuError] = useState(false);
  const [postsError, setPostsError] = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [budget, setBudget] = useState(false);
  const [tab, setTab] = useState<'menu' | 'updates'>('menu');
  const live = useRef(true);
  const followLock = useRef(false);
  const styles = storefrontStyles();
  const canReadSocial = signedIn && !socialBlocked;
  const onSocialDenied = useCallback(() => setSocialBlocked(true), []);
  const goBack = () => {
    if (navigation?.goBack && navigation.canGoBack?.() !== false) navigation.goBack();
    else navigation?.navigate?.('Cafeteria');
  };
  const openLogin = () =>
    navigation?.navigate?.('SSOLogin', {
      returnTo:
        cafeteriaId && !cafeteriaId.includes('/') ? `/cafeteria/${cafeteriaId}` : '/cafeteria',
    });
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError('');
    setMenuError(false);
    setPostsError(false);
    setMenuLoading(true);
    setPostsLoading(true);
    setFollowReadError(false);
    setSocialBlocked(!authLoading && !signedIn);
    void loadStorefront(schoolId, cafeteriaId).then(
      (nextShop) => {
        if (active) setShop(nextShop);
      },
      () => {
        if (active) setError(SERVICE_PAUSED_TEXT);
      },
    );
    void loadStorefrontMenus(schoolId, cafeteriaId).then(
      (nextMenus) => {
        if (active) {
          setMenus(nextMenus);
          setMenuLoading(false);
        }
      },
      () => {
        if (active) {
          setMenuError(true);
          setMenuLoading(false);
        }
      },
    );
    void loadStorefrontPosts(schoolId, cafeteriaId, signedIn ? user?.uid : undefined).then(
      (nextPosts) => {
        if (active) {
          setPosts(nextPosts);
          setPostsLoading(false);
        }
      },
      (reason) => {
        if (!active) return;
        setPostsLoading(false);
        if (isPermissionDeniedError(reason)) setSocialBlocked(true);
        else setPostsError(true);
      },
    );
    if (signedIn && user?.uid) {
      void isFollowingStorefront(schoolId, cafeteriaId, user.uid).then(
        (nextFollowing) => {
          if (active) {
            setFollowing(nextFollowing);
            setFollowingReady(true);
          }
        },
        (reason) => {
          if (!active) return;
          if (isPermissionDeniedError(reason)) onSocialDenied();
          else setFollowReadError(true);
        },
      );
    }
    return () => {
      active = false;
    };
  }, [attempt, authLoading, cafeteriaId, onSocialDenied, schoolId, signedIn, user?.uid]);
  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
  const websiteUrl = safeStorefrontUrl(shop?.websiteUrl);
  const needle = search.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');
  const visibleMenus = menus.filter(
    (item) =>
      item.name.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(needle) &&
      (!budget ||
        (typeof item.price === 'number' &&
          Number.isFinite(item.price) &&
          item.price >= 0 &&
          item.price <= 100)),
  );
  const toggleFollow = async () => {
    if (!user?.uid || !canReadSocial || !followingReady || followLock.current) return;
    followLock.current = true;
    setFollowingBusy(true);
    setActionError('');
    try {
      await followStorefront(schoolId, cafeteriaId, user.uid, !following);
      if (live.current) setFollowing(!following);
    } catch (reason) {
      if (!live.current) return;
      if (isPermissionDeniedError(reason)) onSocialDenied();
      setActionError('追蹤狀態沒有更新，請稍後再試。');
    } finally {
      followLock.current = false;
      if (live.current) setFollowingBusy(false);
    }
  };
  return (
    <AIDetailScreen
      title={shop?.name || '店家資訊'}
      subtitle={STOREFRONT_PAGE_SUBTITLE}
      onBack={goBack}
    >
      <View style={styles.page}>
        {error ? (
          <View style={styles.panel}>
            <Text accessibilityRole="alert" style={styles.body}>
              {error}
            </Text>
            <Button text="重新讀取店家" onPress={() => setAttempt((value) => value + 1)} />
          </View>
        ) : null}
        {shop === undefined && !error ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.muted}>正在讀取店面…</Text>
          </View>
        ) : null}
        {shop === null && !error ? (
          <View style={styles.panel}>
            <Text style={styles.body}>{CAFETERIA_NOT_FOUND_TEXT}</Text>
            <Button
              text={CAFETERIA_BACK_TO_LIST_TEXT}
              onPress={() => {
                if (navigation?.navigate) navigation.navigate('Cafeteria');
                else navigation?.goBack?.();
              }}
            />
          </View>
        ) : null}
        {shop ? (
          <>
            <View style={styles.panel}>
              <View style={styles.identity}>
                <View style={styles.shopIcon} accessibilityElementsHidden>
                  <Ionicons name="restaurant-outline" size={28} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text accessibilityRole="header" style={styles.title}>
                    {shop.name}
                  </Text>
                  <Text style={styles.muted}>
                    {[shop.location, shop.openingHours].filter(Boolean).join(' · ') ||
                      '位置與營業時間尚未提供'}
                  </Text>
                </View>
              </View>
              {shop.intro ? <Text style={styles.body}>{shop.intro}</Text> : null}
              {cafeteriaReviewNotice(shop.reviewStatus) ? (
                <View testID="cafeteria-review-notice" style={styles.reviewNotice}>
                  <Text style={styles.muted}>{cafeteriaReviewNotice(shop.reviewStatus)}</Text>
                </View>
              ) : null}
              {action.kind === 'showcase' && shop.orderingUrl ? (
                <>
                  <Text style={styles.muted}>{SHOWCASE_EXTERNAL_ORDER_HINT}</Text>
                  <Button
                    text={SHOWCASE_ORDER_BUTTON_TEXT}
                    kind="primary"
                    fullWidth
                    onPress={() =>
                      navigation?.navigate?.('HonestOrder', {
                        cafeteriaId,
                        orderingUrl: shop.orderingUrl,
                      })
                    }
                  />
                  <Text style={styles.caption}>{SHOWCASE_ORDER_CAPTION}</Text>
                </>
              ) : null}
              {action.kind === 'native_closed' ? (
                <Text style={styles.muted}>{action.label}</Text>
              ) : null}
              <View style={styles.actions}>
                {websiteUrl ? (
                  <Button
                    text="店家網站"
                    kind="outline"
                    onPress={() => {
                      setActionError('');
                      void Linking.openURL(websiteUrl).catch(() => {
                        if (live.current) setActionError('暫時無法開啟店家網站，請稍後再試。');
                      });
                    }}
                  />
                ) : null}
                {canReadSocial && user?.uid ? (
                  <Button
                    text={following ? '取消追蹤' : '追蹤店家'}
                    kind="outline"
                    loading={followingBusy}
                    disabled={!followingReady}
                    onPress={() => void toggleFollow()}
                  />
                ) : null}
              </View>
              {followReadError && canReadSocial ? (
                <Button
                  text="重新確認追蹤狀態"
                  kind="outline"
                  onPress={() => setAttempt((value) => value + 1)}
                />
              ) : null}
              {actionError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {actionError}
                </Text>
              ) : null}
            </View>
            <View accessibilityRole="tablist" style={styles.tabs}>
              {(
                [
                  ['menu', '菜單'],
                  ['updates', '店家貼文'],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === value }}
                  onPress={() => setTab(value)}
                  style={[styles.tab, tab === value && styles.activeTab]}
                >
                  <Text style={[styles.tabText, tab === value && { color: theme.colors.accent }]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {tab === 'menu' ? (
              <View style={styles.panel}>
                {menus.length > 0 ? (
                  <>
                    <View style={styles.menuToolbar}>
                      <View style={styles.searchField}>
                        <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
                        <TextInput
                          accessibilityLabel="搜尋這間店的餐點"
                          placeholder="搜尋這間店的餐點"
                          placeholderTextColor={theme.colors.muted}
                          value={search}
                          onChangeText={setSearch}
                          maxLength={100}
                          returnKeyType="search"
                          style={styles.searchInput}
                        />
                        {search ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="清除菜單搜尋"
                            onPress={() => setSearch('')}
                            style={styles.clearButton}
                          >
                            <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                          </Pressable>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: budget }}
                        onPress={() => setBudget((current) => !current)}
                        style={[styles.budget, budget && styles.budgetSelected]}
                      >
                        <Text
                          style={{
                            color: budget ? theme.colors.accent : theme.colors.textSecondary,
                            fontWeight: '600',
                          }}
                        >
                          100 元內
                        </Text>
                      </Pressable>
                    </View>
                    <Text accessibilityLiveRegion="polite" style={styles.muted}>
                      {visibleMenus.length} 道餐點
                    </Text>
                  </>
                ) : null}
                {menuLoading ? <Text style={styles.muted}>正在讀取菜單…</Text> : null}
                {menuError ? (
                  <View style={{ gap: 8 }}>
                    <Text accessibilityRole="alert" style={styles.error}>
                      菜單暫時無法讀取，店家資訊仍可查看。
                    </Text>
                    <Button text="重新讀取菜單" onPress={() => setAttempt((value) => value + 1)} />
                  </View>
                ) : null}
                {!menuLoading && !menuError && menus.length === 0 ? (
                  <Text style={styles.muted}>{STOREFRONT_EMPTY_MENU_TEXT}</Text>
                ) : null}
                {menus.length > 0 && visibleMenus.length === 0 ? (
                  <View style={{ gap: 10 }}>
                    <Text style={styles.body}>找不到符合的餐點。</Text>
                    <Button
                      text="清除篩選"
                      kind="outline"
                      onPress={() => {
                        setSearch('');
                        setBudget(false);
                      }}
                    />
                  </View>
                ) : null}
                {visibleMenus.map((item) => (
                  <View key={item.id} style={styles.menuRow}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.menuName}>{item.name}</Text>
                      {cafeteriaShowsMenuAvailability(shop.reviewStatus) && item.soldOut ? (
                        <Text style={styles.soldOut}>已售完</Text>
                      ) : null}
                    </View>
                    <Text style={styles.price}>
                      {typeof item.price === 'number' &&
                      Number.isFinite(item.price) &&
                      item.price >= 0
                        ? `NT$${item.price.toLocaleString('zh-TW')}`
                        : '未標價'}
                    </Text>
                  </View>
                ))}
                {isMenuStale(shop.menuSyncedAt) && menus.length > 0 ? (
                  <Text style={styles.caption}>{MENU_STALE_TEXT}</Text>
                ) : null}
              </View>
            ) : null}
            <View
              style={{ gap: 14, display: tab === 'updates' ? 'flex' : 'none' }}
              accessibilityElementsHidden={tab !== 'updates'}
              importantForAccessibility={tab === 'updates' ? 'auto' : 'no-hide-descendants'}
            >
              {postsLoading ? <Text style={styles.muted}>正在讀取店家貼文…</Text> : null}
              {postsError ? (
                <View style={styles.panel}>
                  <Text accessibilityRole="alert" style={styles.error}>
                    店家貼文暫時無法讀取。
                  </Text>
                  <Button text="重新讀取貼文" onPress={() => setAttempt((value) => value + 1)} />
                </View>
              ) : null}
              {!postsLoading && !postsError && posts.length === 0 ? (
                <View style={styles.panel}>
                  <Text style={styles.muted}>還沒有貼文或優惠公告。</Text>
                </View>
              ) : null}
              {posts.map((post) => (
                <StorefrontPostCard
                  key={post.id}
                  schoolId={schoolId}
                  cafeteriaId={cafeteriaId}
                  uid={user?.uid}
                  canReadSocial={canReadSocial}
                  post={post}
                  onSocialDenied={onSocialDenied}
                />
              ))}
            </View>
            {!canReadSocial && !authLoading ? (
              <View accessibilityLabel="評論" style={styles.panel}>
                <LoginRequiredLostFoundComments
                  onLogin={openLogin}
                  text={LOGIN_REQUIRED_COMMENTS_TEXT}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </AIDetailScreen>
  );
}

function StorefrontPostCard({
  schoolId,
  cafeteriaId,
  uid,
  canReadSocial,
  post,
  onSocialDenied,
}: {
  schoolId: string;
  cafeteriaId: string;
  uid?: string;
  canReadSocial: boolean;
  post: StorefrontPost;
  onSocialDenied: () => void;
}) {
  const [liked, setLiked] = useState(post.liked);
  const [comments, setComments] = useState<StorefrontComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'like' | 'comment' | null>(null);
  const [error, setError] = useState('');
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  const live = useRef(true);
  const styles = storefrontStyles();
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!canReadSocial) return;
    setCommentsLoaded(false);
    void loadStorefrontComments(schoolId, cafeteriaId, post.id).then(
      (nextComments) => {
        if (active) {
          setComments(nextComments);
          setCommentsLoaded(true);
          setError('');
        }
      },
      (reason) => {
        if (!active) return;
        if (isPermissionDeniedError(reason)) onSocialDenied();
        else setError('留言暫時無法讀取，請稍後再試。');
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, canReadSocial, cafeteriaId, onSocialDenied, post.id, schoolId]);
  const mutate = async (kind: 'like' | 'comment') => {
    if (!uid || !canReadSocial || lock.current) return;
    const text = draft.trim();
    if (kind === 'comment' && !text) return;
    lock.current = true;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'like') {
        await toggleStorefrontLike(schoolId, cafeteriaId, post.id, uid, liked);
        if (live.current) setLiked(!liked);
      } else {
        await addStorefrontComment(schoolId, cafeteriaId, post.id, uid, text);
        if (!live.current) return;
        setDraft('');
        try {
          const nextComments = await loadStorefrontComments(schoolId, cafeteriaId, post.id);
          if (live.current) {
            setComments(nextComments);
            setCommentsLoaded(true);
          }
        } catch {
          if (live.current) {
            setCommentsLoaded(false);
            setError('留言已送出，重新整理後即可查看。');
          }
        }
      }
    } catch (reason) {
      if (!live.current) return;
      if (isPermissionDeniedError(reason)) onSocialDenied();
      setError(
        kind === 'comment' ? '留言沒有送出，內容已保留，請再試一次。' : '讚沒有更新，請再試一次。',
      );
    } finally {
      lock.current = false;
      if (live.current) setBusy(null);
    }
  };
  return (
    <View style={styles.panel}>
      <View style={styles.postHeading}>
        <Text style={styles.sectionTitle}>{post.title || '店家消息'}</Text>
        <Text style={styles.caption}>
          {post.kind === 'promo' ? '優惠' : post.kind === 'announcement' ? '公告' : '貼文'}
        </Text>
      </View>
      <Text style={styles.body}>{post.text}</Text>
      {canReadSocial && uid ? (
        <Button
          text={liked ? '收回讚' : '讚'}
          kind="outline"
          loading={busy === 'like'}
          disabled={Boolean(busy)}
          onPress={() => void mutate('like')}
        />
      ) : null}
      {canReadSocial
        ? comments.map((comment) => (
            <Text key={comment.id} style={styles.comment}>
              {comment.text}
            </Text>
          ))
        : null}
      {error ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          {!commentsLoaded && canReadSocial ? (
            <Button
              text="重新讀取留言"
              kind="outline"
              onPress={() => setAttempt((value) => value + 1)}
            />
          ) : null}
        </View>
      ) : null}
      {canReadSocial && uid ? (
        <>
          <TextInput
            accessibilityLabel="留言內容"
            value={draft}
            onChangeText={setDraft}
            placeholder="寫下留言"
            placeholderTextColor={theme.colors.muted}
            style={styles.commentField}
            maxLength={2000}
            multiline
            editable={!busy}
          />
          <Button
            text="送出留言"
            kind="primary"
            disabled={!draft.trim() || Boolean(busy)}
            loading={busy === 'comment'}
            onPress={() => void mutate('comment')}
          />
        </>
      ) : null}
    </View>
  );
}

function storefrontStyles() {
  return StyleSheet.create({
    page: { padding: theme.layout.screenHorizontalPadding, gap: 18 },
    panel: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 18,
      padding: 18,
      gap: 14,
    },
    loading: { alignItems: 'center', padding: 32, gap: 12 },
    identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    shopIcon: {
      backgroundColor: theme.colors.accentSoft,
      borderRadius: 16,
      width: 56,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 23,
      lineHeight: 30,
      letterSpacing: -0.4,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 18,
      lineHeight: 26,
      flex: 1,
    },
    body: { color: theme.colors.text, fontSize: 15, lineHeight: 24 },
    muted: { color: theme.colors.muted, fontSize: 13, lineHeight: 22 },
    caption: { color: theme.colors.muted, fontSize: 12, lineHeight: 20 },
    reviewNotice: {
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    error: { color: theme.colors.danger, fontSize: 14, lineHeight: 22 },
    tabs: {
      flexDirection: 'row',
      padding: 4,
      backgroundColor: theme.colors.surface2,
      borderRadius: 14,
      gap: 6,
    },
    tab: {
      flex: 1,
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 10,
    },
    activeTab: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tabText: { color: theme.colors.textSecondary, fontWeight: '600', fontSize: 15 },
    menuToolbar: { gap: 10 },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.bg,
      borderRadius: 12,
      paddingLeft: 12,
      minHeight: 48,
    },
    searchInput: { flex: 1, minWidth: 0, color: theme.colors.text, padding: 12, fontSize: 15 },
    clearButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    budget: {
      alignSelf: 'flex-start',
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 22,
      paddingHorizontal: 15,
      justifyContent: 'center',
    },
    budgetSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      paddingTop: 16,
      paddingBottom: 4,
      gap: 14,
    },
    menuName: { color: theme.colors.text, fontSize: 16, lineHeight: 24, fontWeight: '500' },
    price: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    soldOut: { color: theme.colors.warning, fontSize: 12, lineHeight: 20 },
    postHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    comment: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 22,
      backgroundColor: theme.colors.surfaceMuted,
      padding: 12,
      borderRadius: 10,
    },
    commentField: {
      minHeight: 72,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: 12,
      color: theme.colors.text,
      fontSize: 15,
      backgroundColor: theme.colors.bg,
      textAlignVertical: 'top',
    },
  });
}
