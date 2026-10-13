import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
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
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  isMenuStale,
  safeStorefrontUrl,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';
import {
  CAFETERIA_BACK_TO_LIST_TEXT,
  CAFETERIA_NOT_FOUND_TEXT,
  STOREFRONT_PAGE_SUBTITLE,
  cafeteriaReviewNotice,
} from '@campus/shared/src/cafeteriaCatalog';

type Props = {
  navigation?: {
    goBack?: () => void;
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { cafeteriaId?: string; id?: string } };
};

export default function StorefrontScreen({ navigation, route }: Props) {
  const cafeteriaId = route?.params?.cafeteriaId || route?.params?.id || '';
  const { user, loading: authLoading } = useAuth();
  const { school } = useSchool();
  const signedIn = Boolean(user?.uid);
  const [shop, setShop] = useState<StorefrontShop | null | undefined>(undefined);
  const [menus, setMenus] = useState<StorefrontMenuItem[]>([]);
  const [posts, setPosts] = useState<StorefrontPost[]>([]);
  const [following, setFollowing] = useState(false);
  const [socialBlocked, setSocialBlocked] = useState(false);
  const [error, setError] = useState('');
  const canReadSocial = signedIn && !socialBlocked;
  const onSocialDenied = useCallback(() => setSocialBlocked(true), []);
  const openLogin = () =>
    navigation?.navigate?.('SSOLogin', {
      returnTo: cafeteriaId && !cafeteriaId.includes('/') ? `/cafeteria/${cafeteriaId}` : '/cafeteria',
    });
  useEffect(() => {
    let active = true;
    setError('');
    setShop(undefined);
    setMenus([]);
    setSocialBlocked(!authLoading && !signedIn);
    void loadStorefront(school.id, cafeteriaId).then(
      (nextShop) => {
        if (active) setShop(nextShop);
      },
      () => {
        if (active) setError('暫時讀不到這間店。');
      },
    );
    void loadStorefrontMenus(school.id, cafeteriaId).then(
      (nextMenus) => {
        if (active) setMenus(nextMenus);
      },
      () => {
        if (active) setMenus([]);
      },
    );
    void loadStorefrontPosts(school.id, cafeteriaId, signedIn ? user?.uid : undefined).then(
      (nextPosts) => {
        if (active) setPosts(nextPosts);
      },
      (reason) => {
        if (!active) return;
        if (isPermissionDeniedError(reason)) setSocialBlocked(true);
      },
    );
    if (signedIn && user?.uid) {
      isFollowingStorefront(school.id, cafeteriaId, user.uid).then(
        (nextFollowing) => {
          if (active) setFollowing(nextFollowing);
        },
        (reason) => {
          if (!active) return;
          if (isPermissionDeniedError(reason)) onSocialDenied();
        },
      );
    } else {
      setFollowing(false);
    }
    return () => {
      active = false;
    };
  }, [authLoading, cafeteriaId, onSocialDenied, school.id, signedIn, user?.uid]);
  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
  const websiteUrl = safeStorefrontUrl(shop?.websiteUrl);
  return (
    <Screen title={shop?.name || '店面'} subtitle={STOREFRONT_PAGE_SUBTITLE}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}>
        {error ? <Text style={{ color: theme.colors.text }}>{error}</Text> : null}
        {shop === undefined && !error ? (
          <Text style={{ color: theme.colors.muted }}>正在讀取店面…</Text>
        ) : null}
        {shop === null && !error ? (
          <>
            <Text style={{ color: theme.colors.text }}>{CAFETERIA_NOT_FOUND_TEXT}</Text>
            <Button
              text={CAFETERIA_BACK_TO_LIST_TEXT}
              onPress={() => {
                if (navigation?.navigate) navigation.navigate('Cafeteria');
                else navigation?.goBack?.();
              }}
            />
          </>
        ) : null}
        {shop ? (
          <>
            {cafeteriaReviewNotice(shop.reviewStatus) ? (
              <View testID="cafeteria-review-notice" style={reviewNoticeBox}>
                <Text style={{ color: theme.colors.text, lineHeight: 22 }}>
                  {cafeteriaReviewNotice(shop.reviewStatus)}
                </Text>
              </View>
            ) : null}
            {shop.intro ? (
              <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{shop.intro}</Text>
            ) : null}
            <Text style={{ color: theme.colors.muted }}>
              {[shop.location, shop.openingHours].filter(Boolean).join(' · ') ||
                '位置與營業時間尚未提供'}
            </Text>
            {isMenuStale(shop.menuSyncedAt) ? (
              <Text style={{ color: theme.colors.muted }}>{MENU_STALE_TEXT}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {action.kind === 'showcase' && shop.orderingUrl ? (
                <Button
                  text={SHOWCASE_ORDER_BUTTON_TEXT}
                  onPress={() =>
                    navigation?.navigate?.('HonestOrder', {
                      cafeteriaId,
                      orderingUrl: shop.orderingUrl,
                    })
                  }
                />
              ) : null}
              {action.kind === 'native_closed' ? (
                <Text style={{ color: theme.colors.muted }}>{action.label}</Text>
              ) : null}
              {canReadSocial && user?.uid ? (
                <Button
                  text={following ? '取消追蹤' : '追蹤店家'}
                  onPress={() =>
                    void followStorefront(school.id, cafeteriaId, user.uid, !following).then(() =>
                      setFollowing(!following),
                    )
                  }
                />
              ) : null}
            </View>
            {action.kind === 'showcase' && shop.orderingUrl ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                {SHOWCASE_ORDER_CAPTION}
              </Text>
            ) : null}
            {websiteUrl ? (
              <Pressable onPress={() => void Linking.openURL(websiteUrl)}>
                <Text style={{ color: theme.colors.accent }}>店家網站</Text>
              </Pressable>
            ) : null}
            <Text style={{ color: theme.colors.text, fontWeight: '700' }}>菜單</Text>
            {menus.length === 0 ? (
              <Text style={{ color: theme.colors.muted }}>還沒有菜單。沒串接的店也可以只放訂餐連結。</Text>
            ) : (
              menus.map((item) => (
                <Text key={item.id} style={{ color: theme.colors.text }}>
                  {item.name}
                  {typeof item.price === 'number' ? ` · NT$${item.price}` : ''}
                  {item.soldOut ? '（售完）' : ''}
                </Text>
              ))
            )}
            <Text style={{ color: theme.colors.text, fontWeight: '700' }}>店家貼文</Text>
            {posts.length === 0 ? (
              <Text style={{ color: theme.colors.muted }}>還沒有貼文或優惠公告。</Text>
            ) : (
              posts.map((post) => (
                <StorefrontPostCard
                  key={post.id}
                  schoolId={school.id}
                  cafeteriaId={cafeteriaId}
                  uid={user?.uid}
                  canReadSocial={canReadSocial}
                  post={post}
                  onSocialDenied={onSocialDenied}
                />
              ))
            )}
            {!canReadSocial && !authLoading ? (
              <View accessibilityLabel="評論">
                <LoginRequiredLostFoundComments onLogin={openLogin} text={LOGIN_REQUIRED_COMMENTS_TEXT} />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
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
  useEffect(() => {
    if (!canReadSocial) return;
    void loadStorefrontComments(schoolId, cafeteriaId, post.id).then(setComments, (reason) => {
      if (isPermissionDeniedError(reason)) onSocialDenied();
    });
  }, [canReadSocial, cafeteriaId, onSocialDenied, post.id, schoolId]);
  return (
    <View
      style={{
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.separator,
        paddingBottom: 10,
      }}
    >
      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
        {post.title || '店家消息'}
      </Text>
      <Text style={{ color: theme.colors.muted }}>
        {post.kind === 'promo' ? '優惠' : post.kind === 'announcement' ? '公告' : '貼文'}
      </Text>
      <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{post.text}</Text>
      {canReadSocial && uid ? (
        <Button
          text={liked ? '收回讚' : '讚'}
          onPress={() =>
            void toggleStorefrontLike(schoolId, cafeteriaId, post.id, uid, liked).then(() =>
              setLiked(!liked),
            )
          }
        />
      ) : null}
      {canReadSocial
        ? comments.map((comment) => (
            <Text key={comment.id} style={{ color: theme.colors.muted }}>
              {comment.text}
            </Text>
          ))
        : null}
      {canReadSocial && uid ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="留言"
            style={field}
            maxLength={2000}
          />
          <Button
            text="送出留言"
            onPress={() => {
              if (!draft.trim()) return;
              void addStorefrontComment(schoolId, cafeteriaId, post.id, uid, draft).then(() => {
                setComments((current) => [
                  ...current,
                  { id: `local-${Date.now()}`, authorId: uid, text: draft },
                ]);
                setDraft('');
              });
            }}
          />
        </>
      ) : null}
    </View>
  );
}

const reviewNoticeBox = {
  backgroundColor: theme.colors.surfaceMuted,
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: theme.radius.sm,
  paddingVertical: 12,
  paddingHorizontal: 14,
};

const field = {
  borderWidth: 1,
  borderColor: theme.colors.separator,
  borderRadius: 10,
  padding: 12,
  color: theme.colors.text,
};
