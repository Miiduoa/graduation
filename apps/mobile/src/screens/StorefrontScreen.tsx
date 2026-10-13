import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { LoginRequiredLostFoundComments } from '../components/LoginRequiredLostFoundComments';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import {
  addStorefrontComment,
  followStorefront,
  isFollowingStorefront,
  loadStorefront,
  loadStorefrontComments,
  loadStorefrontPosts,
  toggleStorefrontLike,
  type StorefrontComment,
  type StorefrontPost,
  type StorefrontShop,
} from '../services/storefront';
import {
  MENU_STALE_TEXT,
  PRICE_DISCLAIMER,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  isMenuStale,
  safeStorefrontUrl,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';

type Props = {
  navigation?: { goBack?: () => void; navigate?: (screen: string, params?: Record<string, unknown>) => void };
  route?: { params?: { cafeteriaId?: string; id?: string } };
};

export default function StorefrontScreen({ navigation, route }: Props) {
  const cafeteriaId = route?.params?.cafeteriaId || route?.params?.id || '';
  const { user, loading: authLoading } = useAuth();
  const { school } = useSchool();
  const signedIn = Boolean(user?.uid);
  const [shop, setShop] = useState<StorefrontShop | null>(null);
  const [posts, setPosts] = useState<StorefrontPost[]>([]);
  const [following, setFollowing] = useState(false);
  const [socialBlocked, setSocialBlocked] = useState(false);
  const [error, setError] = useState('');
  const canReadSocial = signedIn && !socialBlocked;
  const openLogin = () => navigation?.navigate?.('SSOLogin');
  useEffect(() => {
    let active = true;
    setSocialBlocked(!authLoading && !signedIn);
    Promise.all([
      loadStorefront(school.id, cafeteriaId),
      loadStorefrontPosts(school.id, cafeteriaId, signedIn ? user?.uid : undefined),
    ]).then(
      ([nextShop, nextPosts]) => {
        if (!active) return;
        setShop(nextShop);
        setPosts(nextPosts);
      },
      () => {
        if (active) setError('暫時讀不到這間店。');
      },
    );
    if (signedIn && user?.uid) {
      isFollowingStorefront(school.id, cafeteriaId, user.uid).then(
        (nextFollowing) => {
          if (active) setFollowing(nextFollowing);
        },
        (reason) => {
          if (!active) return;
          if (isPermissionDeniedError(reason)) setSocialBlocked(true);
        },
      );
    } else {
      setFollowing(false);
    }
    return () => {
      active = false;
    };
  }, [authLoading, school.id, cafeteriaId, signedIn, user?.uid]);
  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
  const websiteUrl = safeStorefrontUrl(shop?.websiteUrl);
  return (
    <Screen title={shop?.name || '店面'} subtitle="店家自己的主頁。一般帳號即可查看、追蹤與留言。">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}>
        {error ? <Text style={{ color: theme.colors.text }}>{error}</Text> : null}
        {!shop && !error ? <Text style={{ color: theme.colors.muted }}>正在讀取店面…</Text> : null}
        {shop ? (
          <>
            {shop.intro ? <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{shop.intro}</Text> : null}
            <Text style={{ color: theme.colors.muted }}>
              {[shop.location, shop.openingHours].filter(Boolean).join(' · ') || '位置與營業時間尚未提供'}
            </Text>
            <Text style={{ color: theme.colors.muted }}>{PRICE_DISCLAIMER}</Text>
            {isMenuStale(shop.menuSyncedAt) ? (
              <Text style={{ color: theme.colors.muted }}>{MENU_STALE_TEXT}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {action.kind === 'showcase' && shop.orderingUrl ? (
                <Button
                  text={SHOWCASE_ORDER_BUTTON_TEXT}
                  onPress={() =>
                    navigation?.navigate?.('HonestOrder', { cafeteriaId, orderingUrl: shop.orderingUrl })
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
              ) : authLoading ? null : (
                <LoginRequiredLostFoundComments onLogin={openLogin} />
              )}
            </View>
            {action.kind === 'showcase' && shop.orderingUrl ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>{SHOWCASE_ORDER_CAPTION}</Text>
            ) : null}
            {websiteUrl ? (
              <Pressable onPress={() => void Linking.openURL(websiteUrl)}>
                <Text style={{ color: theme.colors.accent }}>店家網站</Text>
              </Pressable>
            ) : null}
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
                  onSocialDenied={() => setSocialBlocked(true)}
                />
              ))
            )}
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
  const onSocialDeniedRef = useRef(onSocialDenied);
  onSocialDeniedRef.current = onSocialDenied;
  useEffect(() => {
    if (!canReadSocial) {
      setComments([]);
      return;
    }
    void loadStorefrontComments(schoolId, cafeteriaId, post.id).then(setComments, (reason) => {
      if (isPermissionDeniedError(reason)) onSocialDeniedRef.current();
    });
  }, [canReadSocial, schoolId, cafeteriaId, post.id]);
  return (
    <View style={{ gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.separator, paddingBottom: 10 }}>
      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{post.title || '店家消息'}</Text>
      <Text style={{ color: theme.colors.muted }}>
        {post.kind === 'promo' ? '優惠' : post.kind === 'announcement' ? '公告' : '貼文'}
      </Text>
      <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{post.text}</Text>
      {canReadSocial && uid ? (
        <Button
          text={liked ? '收回讚' : '讚'}
          onPress={() =>
            void toggleStorefrontLike(schoolId, cafeteriaId, post.id, uid, liked).then(() => setLiked(!liked))
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
          <TextInput value={draft} onChangeText={setDraft} placeholder="留言" style={field} maxLength={2000} />
          <Button
            text="送出留言"
            onPress={() => {
              if (!draft.trim()) return;
              void addStorefrontComment(schoolId, cafeteriaId, post.id, uid, draft).then(() => {
                setComments((current) => [...current, { id: `local-${Date.now()}`, authorId: uid, text: draft }]);
                setDraft('');
              });
            }}
          />
        </>
      ) : null}
    </View>
  );
}

const field = {
  borderWidth: 1,
  borderColor: theme.colors.separator,
  borderRadius: 10,
  padding: 12,
  color: theme.colors.text,
};
