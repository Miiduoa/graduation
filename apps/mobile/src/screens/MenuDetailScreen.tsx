/* eslint-disable */
import React, { useMemo, useState, useEffect } from 'react';
import { ScrollView, Text, View, Pressable, Share, Alert, TextInput, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove,
  increment,
} from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { buildSchoolCollectionPath } from '@campus/shared/src';
import { findById } from '../data';
import { useAsyncList } from '../hooks/useAsyncList';
import { useDataSource } from '../hooks/useDataSource';
import {
  Screen,
  Card,
  Pill,
  Button,
  LoadingState,
  ErrorState,
  AnimatedCard,
  StatusBadge,
  InfoRow,
  RatingStars,
  FeatureHighlight,
  Divider,
  Avatar,
  ProgressRing,
  SegmentedControl,
} from '../ui/components';
import { useFavorites } from '../state/favorites';
import { useAuth } from '../state/auth';
import { getDb } from '../firebase';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { isFeatureEnabled } from '../services/release';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import {
  formatDateTime,
  isOpenNow,
  getTimeUntilClose,
  formatDuration,
  formatRelativeTime,
  toDate,
} from '../utils/format';

type NutritionInfo = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sodium: number;
};

type CafeteriaStatus = {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  waitTime: number;
  queueLength: number;
  lastUpdated: Date;
};

type Review = {
  id: string;
  uid: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  rating: number;
  comment: string;
  imageUrls?: string[];
  createdAt?: any;
  helpful: number;
  helpfulBy?: string[];
  tags?: string[];
};

type UserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

type PriceHistory = {
  price: number;
  date: any;
};

function generateMockNutrition(price: number): NutritionInfo {
  const base = price * 5;
  return {
    calories: Math.floor(base + Math.random() * 200),
    protein: Math.floor(10 + Math.random() * 20),
    carbs: Math.floor(30 + Math.random() * 40),
    fat: Math.floor(5 + Math.random() * 15),
    sodium: Math.floor(300 + Math.random() * 500),
  };
}

function generateMockStatus(): CafeteriaStatus {
  const hour = new Date().getHours();
  const isLunchTime = hour >= 11 && hour <= 14;
  const isDinnerTime = hour >= 17 && hour <= 19;

  return {
    isOpen: hour >= 7 && hour <= 20,
    openTime: '07:00',
    closeTime: '20:00',
    waitTime:
      isLunchTime || isDinnerTime
        ? Math.floor(Math.random() * 15) + 5
        : Math.floor(Math.random() * 5),
    queueLength:
      isLunchTime || isDinnerTime
        ? Math.floor(Math.random() * 20) + 10
        : Math.floor(Math.random() * 5),
    lastUpdated: new Date(),
  };
}

function generateMockReviews(): Review[] {
  const names = ['小明', '學姐', '阿華', '小美', '大雄', '靜香'];
  const comments = [
    '份量很大，CP值很高！',
    '味道不錯，但要排很久',
    '價格實惠，學生的好朋友',
    '今天的肉有點老',
    '每天都來吃，好吃！',
    '醬料可以自己加，很讚',
  ];
  const tags = [['份量大', 'CP值高'], ['排隊長'], ['便宜'], [], ['好吃'], ['自助式']];

  return Array.from({ length: 4 }).map((_, i) => ({
    id: `review-${i}`,
    uid: `user-${i}`,
    displayName: names[i % names.length],
    rating: 3 + Math.floor(Math.random() * 3),
    comment: comments[i % comments.length],
    createdAt: { toDate: () => new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) },
    helpful: Math.floor(Math.random() * 10),
    helpfulBy: [],
    tags: tags[i % tags.length],
  }));
}

const REVIEW_TAGS = [
  '份量大',
  'CP值高',
  '好吃',
  '新鮮',
  '服務好',
  '環境乾淨',
  '排隊長',
  '偏鹹',
  '偏油',
  '份量少',
];

export function MenuDetailScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const paymentsEnabled = isFeatureEnabled('payments');
  const id: string | undefined = props?.route?.params?.id;
  const fav = useFavorites();
  const auth = useAuth();
  const db = getDb();

  const [status, setStatus] = useState<CafeteriaStatus | null>(null);
  const [mockReviews, setMockReviews] = useState<Review[]>([]);
  const [userRating, setUserRating] = useState(0);
  const [userComment, setUserComment] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'with_photo' | 'with_comment'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'helpful' | 'rating'>('recent');

  const ds = useDataSource();
  const {
    items: raw,
    error: loadError,
    reload,
  } = useAsyncList<any>(() => ds.listMenus(school.id), [ds, school.id]);

  const item = useMemo(() => findById(raw, id), [raw, id]);

  // Fetch Firebase reviews
  const {
    items: firebaseReviews,
    loading: reviewsLoading,
    reload: reloadReviews,
  } = useAsyncList<Review>(async () => {
    if (!id) return [];
    try {
      const canonicalRef = school.id
        ? collection(db, buildSchoolCollectionPath(school.id, 'menus', id, 'reviews').join('/'))
        : null;
      const legacyRef = collection(db, 'menus', id, 'reviews');
      const refs = canonicalRef ? [canonicalRef, legacyRef] : [legacyRef];

      for (const ref of refs) {
        const qy = query(ref, orderBy('createdAt', 'desc'));
        const snap = await getDocs(qy);
        if (!snap.empty || ref === legacyRef) {
          return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Review[];
        }
      }

      return [];
    } catch {
      return [];
    }
  }, [db, id, school.id]);

  // Fetch user profiles for reviews
  const { items: userProfiles } = useAsyncList<UserProfile>(async () => {
    const allReviews = [...firebaseReviews, ...mockReviews];
    const uids = new Set(allReviews.map((r) => r.uid).filter(Boolean));
    const profiles: UserProfile[] = [];
    for (const uid of uids) {
      if (uid.startsWith('user-')) continue; // Skip mock users
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          profiles.push({ uid, ...(snap.data() as any) });
        }
      } catch {}
    }
    return profiles;
  }, [db, firebaseReviews.map((r) => r.uid).join(',')]);

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) map[p.uid] = p;
    return map;
  }, [userProfiles]);

  // Combine and sort reviews
  const reviews = useMemo(() => {
    let all = [...firebaseReviews, ...mockReviews];

    // Filter
    if (reviewFilter === 'with_photo') {
      all = all.filter((r) => r.imageUrls && r.imageUrls.length > 0);
    } else if (reviewFilter === 'with_comment') {
      all = all.filter((r) => r.comment && r.comment.length > 10);
    }

    // Sort
    if (sortBy === 'helpful') {
      all.sort((a, b) => (b.helpful ?? 0) - (a.helpful ?? 0));
    } else if (sortBy === 'rating') {
      all.sort((a, b) => b.rating - a.rating);
    }
    // "recent" is default sort from query

    return all;
  }, [firebaseReviews, mockReviews, reviewFilter, sortBy]);

  const myReview = useMemo(() => {
    if (!auth.user) return null;
    return firebaseReviews.find((r) => r.uid === auth.user?.uid) ?? null;
  }, [firebaseReviews, auth.user?.uid]);

  const nutrition = useMemo(() => {
    if (!item?.price) return null;
    return generateMockNutrition(item.price);
  }, [item?.price]);

  const otherMenus = useMemo(() => {
    if (!item) return [];
    return raw.filter((m: any) => m.id !== item.id && m.cafeteria === item.cafeteria).slice(0, 4);
  }, [raw, item]);

  const handleOpenPayment = () => {
    nav?.getParent?.()?.navigate?.('我的', { screen: 'Payment' });
  };

  const handleOpenNotificationSettings = () => {
    nav?.getParent?.()?.navigate?.('我的', { screen: 'NotificationSettings' });
  };

  const handleOpenMenuSubscription = () => {
    nav?.navigate?.('MenuSubscription');
  };

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  const ratingDistribution = useMemo(() => {
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) {
      dist[r.rating] = (dist[r.rating] || 0) + 1;
    }
    return dist;
  }, [reviews]);

  const popularTags = useMemo(() => {
    const tagCount: Record<string, number> = {};
    for (const r of reviews) {
      for (const tag of r.tags ?? []) {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }
    return Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag]) => tag);
  }, [reviews]);

  useEffect(() => {
    setStatus(generateMockStatus());
    setMockReviews(generateMockReviews());

    const interval = setInterval(() => {
      setStatus(generateMockStatus());
    }, 60000);

    return () => clearInterval(interval);
  }, [item?.id]);

  const handleShare = async () => {
    if (!item) return;
    const message = `【${item.name ?? item.cafeteria}】\n\n價格：$${item.price ?? '-'}\n餐廳：${item.cafeteria ?? '-'}\n\n${avgRating > 0 ? `評分：${avgRating.toFixed(1)} 顆星 (${reviews.length}則評價)` : ''}`;
    try {
      await Share.share({ message, title: item.name ?? item.cafeteria });
    } catch {}
  };

  // Pick images for review
  const handlePickImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: 3,
      });
      if (!result.canceled) {
        const uris = result.assets.map((a) => a.uri).slice(0, 3);
        setSelectedImages((prev) => [...prev, ...uris].slice(0, 3));
      }
    } catch (e: any) {
      setErr('選擇圖片失敗');
    }
  };

  // Submit review to Firebase
  const handleSubmitReview = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) {
      setErr('請先登入');
      return;
    }
    if (userRating === 0) {
      setErr('請先點擊星星給予評分');
      return;
    }
    if (!id) return;

    setSubmittingReview(true);
    try {
      await setDoc(
        doc(
          db,
          buildSchoolCollectionPath(school.id, 'menus', id, 'reviews', auth.user.uid).join('/'),
        ),
        {
          uid: auth.user.uid,
          displayName: auth.profile?.displayName ?? null,
          avatarUrl: auth.profile?.avatarUrl ?? null,
          email: auth.user.email ?? null,
          rating: userRating,
          comment: userComment.trim(),
          tags: selectedTags,
          imageUrls: selectedImages, // In production, upload to Storage first
          createdAt: serverTimestamp(),
          helpful: 0,
          helpfulBy: [],
        },
      );

      setShowReviewForm(false);
      setUserRating(0);
      setUserComment('');
      setSelectedTags([]);
      setSelectedImages([]);
      reloadReviews();
      setSuccessMsg('評價已送出，感謝你的回饋！');
    } catch (e: any) {
      setErr(e?.message ?? '送出評價失敗');
    } finally {
      setSubmittingReview(false);
    }
  };

  // Mark review as helpful
  const handleHelpful = async (reviewId: string, alreadyHelpful: boolean) => {
    if (!auth.user || !id) return;
    try {
      const reviewRef = doc(
        db,
        buildSchoolCollectionPath(school.id, 'menus', id, 'reviews', reviewId).join('/'),
      );
      if (alreadyHelpful) {
        await updateDoc(reviewRef, {
          helpfulBy: arrayRemove(auth.user.uid),
          helpful: increment(-1),
        });
      } else {
        await updateDoc(reviewRef, {
          helpfulBy: arrayUnion(auth.user.uid),
          helpful: increment(1),
        });
      }
      reloadReviews();
    } catch {}
  };

  const handleReportSoldOut = () => {
    Alert.alert('回報售完', '確定要回報這道餐點已售完嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定',
        onPress: () => {
          Alert.alert('感謝回報', '我們已收到你的回報，會通知其他使用者');
          // In production: update Firestore
        },
      },
    ]);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 5),
    );
  };

  if (loadError) {
    return (
      <ErrorState
        title="餐點"
        subtitle="讀取失敗"
        hint={loadError}
        actionText="重試"
        onAction={reload}
      />
    );
  }
  if (!item) {
    return <LoadingState title="餐點" subtitle="載入中..." rows={2} />;
  }

  const isFav = fav.isFavorite('menu', item.id);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* Error/Success Messages */}
        {err && (
          <AnimatedCard>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                backgroundColor: `${theme.colors.danger}15`,
                borderRadius: theme.radius.md,
              }}
            >
              <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
              <Text style={{ flex: 1, color: theme.colors.danger }}>{err}</Text>
              <Pressable onPress={() => setErr(null)}>
                <Ionicons name="close" size={20} color={theme.colors.danger} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}
        {successMsg && (
          <AnimatedCard>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                backgroundColor: `${theme.colors.success}15`,
                borderRadius: theme.radius.md,
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
              <Text style={{ flex: 1, color: theme.colors.success }}>{successMsg}</Text>
              <Pressable onPress={() => setSuccessMsg(null)}>
                <Ionicons name="close" size={20} color={theme.colors.success} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}

        {/* Main Info Card */}
        <AnimatedCard title={item.name ?? item.cafeteria ?? '餐點'} subtitle="">
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 12,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: theme.colors.accentSoft,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '900', fontSize: 20 }}>
                ${item.price ?? '-'}
              </Text>
            </View>
            {isFav && <Pill text="已收藏" kind="accent" />}
            {status && (
              <StatusBadge
                status={status.isOpen ? 'success' : 'default'}
                label={status.isOpen ? '營業中' : '已打烊'}
              />
            )}
          </View>

          {/* Rating Summary */}
          {reviews.length > 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                padding: 14,
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.md,
                marginBottom: 14,
              }}
            >
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 32 }}>
                  {avgRating.toFixed(1)}
                </Text>
                <RatingStars rating={avgRating} size={14} />
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                  {reviews.length} 則
                </Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = ratingDistribution[star] || 0;
                  const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                  return (
                    <View key={star} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 10, width: 10 }}>
                        {star}
                      </Text>
                      <Ionicons name="star" size={10} color="#F59E0B" />
                      <View
                        style={{
                          flex: 1,
                          height: 6,
                          backgroundColor: theme.colors.surface,
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            backgroundColor: '#F59E0B',
                            borderRadius: 3,
                          }}
                        />
                      </View>
                      <Text style={{ color: theme.colors.muted, fontSize: 10, width: 20 }}>
                        {count}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Popular Tags */}
          {popularTags.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {popularTags.map((tag) => (
                <View
                  key={tag}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    backgroundColor: theme.colors.accentSoft,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ gap: 8, marginBottom: 14 }}>
            <InfoRow icon="restaurant-outline" label="餐廳" value={item.cafeteria ?? '-'} />
            <InfoRow
              icon="calendar-outline"
              label="供應日期"
              value={formatDateTime(item.availableOn)}
            />
            {status && status.isOpen && (
              <>
                <InfoRow
                  icon="time-outline"
                  label="預估等候"
                  value={status.waitTime > 0 ? `${status.waitTime} 分鐘` : '無需等候'}
                />
                <InfoRow
                  icon="people-outline"
                  label="目前排隊"
                  value={`約 ${status.queueLength} 人`}
                />
              </>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button
              text={isFav ? '取消收藏' : '收藏'}
              kind={isFav ? 'secondary' : 'primary'}
              onPress={() => fav.toggleFavorite('menu', item.id)}
            />
            <Button text="分享" onPress={handleShare} />
            <Button text="回報售完" onPress={handleReportSoldOut} />
          </View>
        </AnimatedCard>

        {status && (
          <AnimatedCard title="餐廳狀態" subtitle={item.cafeteria ?? '餐廳資訊'} delay={100}>
            <View style={{ alignItems: 'center', padding: 16 }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: status.isOpen
                    ? `${theme.colors.success}20`
                    : `${theme.colors.danger}20`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <Ionicons
                  name={status.isOpen ? 'storefront' : 'storefront-outline'}
                  size={36}
                  color={status.isOpen ? theme.colors.success : theme.colors.danger}
                />
              </View>
              <Text
                style={{
                  color: status.isOpen ? theme.colors.success : theme.colors.danger,
                  fontWeight: '900',
                  fontSize: 20,
                }}
              >
                {status.isOpen ? '營業中' : '已打烊'}
              </Text>
              <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
                營業時間：{status.openTime} - {status.closeTime}
              </Text>
              {status.isOpen && (
                <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
                  距離打烊還有 {formatDuration(getTimeUntilClose(status.closeTime))}
                </Text>
              )}
            </View>

            {status.isOpen && status.waitTime > 5 && (
              <View
                style={{
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${theme.colors.danger}15`,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
                <Text style={{ color: theme.colors.danger, flex: 1 }}>
                  目前人潮較多，預估等候 {status.waitTime} 分鐘
                </Text>
              </View>
            )}

            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 11,
                textAlign: 'center',
                marginTop: 12,
              }}
            >
              最後更新：{status.lastUpdated.toLocaleTimeString()}
            </Text>
          </AnimatedCard>
        )}

        {nutrition && (
          <AnimatedCard title="營養資訊" subtitle="每份估計值" delay={200}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {[
                { label: '熱量', value: `${nutrition.calories}`, unit: 'kcal', color: '#F59E0B' },
                { label: '蛋白質', value: `${nutrition.protein}`, unit: 'g', color: '#EF4444' },
                { label: '碳水', value: `${nutrition.carbs}`, unit: 'g', color: '#3B82F6' },
                { label: '脂肪', value: `${nutrition.fat}`, unit: 'g', color: '#10B981' },
                { label: '鈉', value: `${nutrition.sodium}`, unit: 'mg', color: '#8B5CF6' },
              ].map((n) => (
                <View
                  key={n.label}
                  style={{
                    width: '30%',
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: theme.radius.sm,
                    backgroundColor: `${n.color}15`,
                  }}
                >
                  <Text style={{ color: n.color, fontWeight: '900', fontSize: 18 }}>{n.value}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{n.unit}</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 12, marginTop: 4 }}>
                    {n.label}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 12 }}>
              * 營養數值為估計值，實際可能因食材與烹調方式而異
            </Text>
          </AnimatedCard>
        )}

        {/* Reviews Section */}
        <AnimatedCard title="評價" subtitle={`共 ${reviews.length} 則評價`} delay={300}>
          {/* Write Review Button or Form */}
          {!showReviewForm ? (
            <View style={{ marginBottom: 14 }}>
              {myReview ? (
                <View
                  style={{
                    padding: 12,
                    backgroundColor: theme.colors.accentSoft,
                    borderRadius: theme.radius.md,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                    <Text style={{ color: theme.colors.success, fontSize: 13 }}>
                      你已評價此餐點
                    </Text>
                  </View>
                </View>
              ) : (
                <Button
                  text={auth.user ? '撰寫評價' : '登入後撰寫評價'}
                  kind="primary"
                  disabled={!auth.user}
                  onPress={() => setShowReviewForm(true)}
                />
              )}
            </View>
          ) : (
            <View
              style={{
                gap: 14,
                marginBottom: 16,
                padding: 14,
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.md,
              }}
            >
              {/* Rating Stars */}
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: theme.colors.muted, marginBottom: 10 }}>你的評分</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Pressable key={star} onPress={() => setUserRating(star)}>
                      <Ionicons
                        name={star <= userRating ? 'star' : 'star-outline'}
                        size={32}
                        color="#F59E0B"
                      />
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Tags */}
              <View>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
                  選擇標籤（最多5個）
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {REVIEW_TAGS.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <Pressable
                        key={tag}
                        onPress={() => toggleTag(tag)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 16,
                          backgroundColor: isSelected ? theme.colors.accent : theme.colors.surface,
                          borderWidth: 1,
                          borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                        }}
                      >
                        <Text
                          style={{ color: isSelected ? '#fff' : theme.colors.text, fontSize: 12 }}
                        >
                          {tag}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Comment */}
              <TextInput
                value={userComment}
                onChangeText={setUserComment}
                placeholder="分享你的用餐體驗..."
                placeholderTextColor={theme.colors.muted}
                multiline
                style={{
                  minHeight: 80,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  color: theme.colors.text,
                  textAlignVertical: 'top',
                }}
              />

              {/* Images */}
              <View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    上傳照片（最多3張）
                  </Text>
                  <Pressable
                    onPress={handlePickImages}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  >
                    <Ionicons name="camera" size={16} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
                      新增
                    </Text>
                  </Pressable>
                </View>
                {selectedImages.length > 0 && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {selectedImages.map((uri, idx) => (
                      <View key={idx} style={{ position: 'relative' }}>
                        <Image
                          source={{ uri }}
                          style={{ width: 70, height: 70, borderRadius: 8 }}
                        />
                        <Pressable
                          onPress={() =>
                            setSelectedImages((prev) => prev.filter((_, i) => i !== idx))
                          }
                          style={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: theme.colors.danger,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons name="close" size={14} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Submit Buttons */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  text={submittingReview ? '送出中...' : '送出評價'}
                  kind="primary"
                  disabled={submittingReview || userRating === 0}
                  onPress={handleSubmitReview}
                />
                <Button
                  text="取消"
                  onPress={() => {
                    setShowReviewForm(false);
                    setSelectedTags([]);
                    setSelectedImages([]);
                    setUserRating(0);
                    setUserComment('');
                  }}
                />
              </View>
            </View>
          )}

          {/* Filter & Sort */}
          {reviews.length > 0 && (
            <View style={{ marginBottom: 14 }}>
              <SegmentedControl
                options={[
                  { key: 'all', label: '全部' },
                  { key: 'with_photo', label: '有圖' },
                  { key: 'with_comment', label: '有留言' },
                ]}
                selected={reviewFilter}
                onChange={(k) => setReviewFilter(k as any)}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                <Pressable
                  onPress={() =>
                    setSortBy((prev) =>
                      prev === 'recent' ? 'helpful' : prev === 'helpful' ? 'rating' : 'recent',
                    )
                  }
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    排序：
                    {sortBy === 'recent' ? '最新' : sortBy === 'helpful' ? '最有幫助' : '評分最高'}
                  </Text>
                  <Ionicons name="swap-vertical" size={14} color={theme.colors.muted} />
                </Pressable>
              </View>
            </View>
          )}

          <Divider text="用戶評價" />

          {/* Review List */}
          <View style={{ gap: 12 }}>
            {reviewsLoading && reviews.length === 0 && (
              <Text style={{ color: theme.colors.muted, textAlign: 'center', paddingVertical: 20 }}>
                載入中...
              </Text>
            )}
            {reviews.map((review, idx) => {
              const profile = profilesById[review.uid];
              const displayName = profile?.displayName || review.displayName || '用戶';
              const avatarUrl = profile?.avatarUrl ?? review.avatarUrl ?? undefined;
              const alreadyHelpful = auth.user && review.helpfulBy?.includes(auth.user.uid);
              const reviewDate = toDate(review.createdAt?.toDate?.() ?? review.createdAt);

              return (
                <AnimatedCard key={review.id} delay={idx * 20}>
                  <View
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor:
                        review.uid === auth.user?.uid ? theme.colors.accent : theme.colors.border,
                    }}
                  >
                    {/* Header */}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {avatarUrl ? (
                          <Avatar name={displayName} size={36} imageUrl={avatarUrl} />
                        ) : (
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              backgroundColor: theme.colors.accentSoft,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>
                              {displayName[0]?.toUpperCase() ?? '?'}
                            </Text>
                          </View>
                        )}
                        <View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                              {displayName}
                            </Text>
                            {review.uid === auth.user?.uid && (
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  backgroundColor: theme.colors.accentSoft,
                                  borderRadius: 4,
                                }}
                              >
                                <Text
                                  style={{
                                    color: theme.colors.accent,
                                    fontSize: 10,
                                    fontWeight: '600',
                                  }}
                                >
                                  你
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                            {reviewDate ? formatRelativeTime(reviewDate) : ''}
                          </Text>
                        </View>
                      </View>
                      <RatingStars rating={review.rating} size={14} />
                    </View>

                    {/* Tags */}
                    {review.tags && review.tags.length > 0 && (
                      <View
                        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}
                      >
                        {review.tags.map((tag) => (
                          <View
                            key={tag}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              backgroundColor: theme.colors.surface,
                              borderRadius: 8,
                            }}
                          >
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Comment */}
                    {review.comment && (
                      <Text style={{ color: theme.colors.text, lineHeight: 20 }}>
                        {review.comment}
                      </Text>
                    )}

                    {/* Images */}
                    {review.imageUrls && review.imageUrls.length > 0 && (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        {review.imageUrls.map((uri, i) => (
                          <Image
                            key={i}
                            source={{ uri }}
                            style={{ width: 60, height: 60, borderRadius: 8 }}
                          />
                        ))}
                      </View>
                    )}

                    {/* Actions */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                      <Pressable
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        onPress={() => auth.user && handleHelpful(review.id, !!alreadyHelpful)}
                        disabled={!auth.user}
                      >
                        <Ionicons
                          name={alreadyHelpful ? 'thumbs-up' : 'thumbs-up-outline'}
                          size={16}
                          color={alreadyHelpful ? theme.colors.accent : theme.colors.muted}
                        />
                        <Text
                          style={{
                            color: alreadyHelpful ? theme.colors.accent : theme.colors.muted,
                            fontSize: 12,
                          }}
                        >
                          有幫助{(review.helpful ?? 0) > 0 ? ` (${review.helpful})` : ''}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </AnimatedCard>
              );
            })}

            {reviews.length === 0 && !reviewsLoading && (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, marginTop: 10 }}>
                  還沒有評價，成為第一個評價的人！
                </Text>
              </View>
            )}
          </View>
        </AnimatedCard>

        {otherMenus.length > 0 && (
          <AnimatedCard title="同餐廳其他餐點" subtitle="你可能也喜歡" delay={400}>
            <View style={{ gap: 10 }}>
              {otherMenus.map((menu) => (
                <Pressable
                  key={menu.id}
                  onPress={() => nav?.push?.('MenuDetail', { id: menu.id })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{menu.name}</Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      {formatDateTime(menu.availableOn)}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>
                    ${menu.price ?? '-'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </AnimatedCard>
        )}

        <AnimatedCard title="更多功能" subtitle="相關功能捷徑" delay={500}>
          <View style={{ gap: 10 }}>
            {paymentsEnabled ? (
              <FeatureHighlight
                icon="card-outline"
                title="校園支付"
                description="使用學生證或校園錢包快速付款"
                color={theme.colors.accent}
              />
            ) : null}
            <FeatureHighlight
              icon="notifications-outline"
              title="到號提醒"
              description="點餐後收到取餐通知"
              color={theme.colors.success}
            />
            <FeatureHighlight
              icon="calendar-outline"
              title="每日菜單訂閱"
              description="每天推播今日菜單資訊"
              color="#F59E0B"
            />
          </View>
          <View style={{ gap: 10, marginTop: 14 }}>
            {paymentsEnabled ? (
              <Button text="前往校園支付" kind="primary" onPress={handleOpenPayment} />
            ) : null}
            <Button text="設定取餐提醒" onPress={handleOpenNotificationSettings} />
            <Button text="管理菜單訂閱" onPress={handleOpenMenuSubscription} />
          </View>
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
