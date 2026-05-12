/* eslint-disable */
/**
 * 💬 校園社交 — Campus Social Screen
 *
 * 靜宜大學專屬社交空間：
 * 匿名討論 + 告白牆 + 二手市場 + 投票 + 美食評價
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  Platform,
  TextInput,
  Modal,
  FlatList,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useThemeMode } from '../../state/theme';
import {
  getSocialFeed,
  createPost,
  toggleLike,
  votePoll,
  getComments,
  addComment,
  getSocialStats,
  toggleBookmark,
  getCategoryLabel,
  getCategoryIcon,
  getCategoryColor,
  type SocialPost,
  type PostCategory,
  type SocialComment,
  type SocialStats,
  type PollOption,
} from '../../services/campusSocialEngine';
import { earnXP } from '../../services/gamificationEngine';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ALL_CATEGORIES: (PostCategory | 'all')[] = [
  'all',
  'course_discussion',
  'confession',
  'vent',
  'marketplace',
  'food_review',
  'question',
  'poll',
  'lost_found',
  'club_recruit',
];

// ─── Main Screen ─────────────────────────────────────────

export function CampusSocialPanel() {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [stats, setStats] = useState<SocialStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PostCategory | 'all'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'popular' | 'trending'>('trending');
  const [showCompose, setShowCompose] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);

  const load = useCallback(async () => {
    try {
      const [feedResult, statsResult] = await Promise.all([
        getSocialFeed({
          category: activeCategory === 'all' ? undefined : activeCategory,
          sortBy,
        }),
        getSocialStats(),
      ]);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPosts(feedResult.posts);
      setStats(statsResult);
    } catch (e) {
      console.warn('[CampusSocial] load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeCategory, sortBy]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleLike = useCallback(async (postId: string) => {
    await toggleLike(postId, 'like');
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: p.likes + 1 } : p)));
  }, []);

  const handleBookmark = useCallback(async (postId: string) => {
    const result = await toggleBookmark(postId);
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, bookmarked: result } : p)));
  }, []);

  const handleVote = useCallback(async (postId: string, optionId: string) => {
    await votePoll(postId, optionId);
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId || !p.pollOptions) return p;
        return {
          ...p,
          pollOptions: p.pollOptions.map((o) =>
            o.id === optionId ? { ...o, votes: o.votes + 1, votedByMe: true } : o,
          ),
        };
      }),
    );
  }, []);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: theme.space.md }}>
          載入社群動態...
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.md }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>
              校園社群
            </Text>
            <Pressable
              onPress={() => setShowCompose(true)}
              style={({ pressed }) => ({
                backgroundColor: theme.colors.accent,
                borderRadius: theme.radius.full,
                width: 40,
                height: 40,
                justifyContent: 'center',
                alignItems: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="add" size={24} color="#fff" />
            </Pressable>
          </View>
          {stats && (
            <View style={{ flexDirection: 'row', gap: theme.space.md, marginTop: theme.space.sm }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                {stats.onlineUsers} 人在線
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                今日 {stats.activePosts24h} 則貼文
              </Text>
            </View>
          )}
        </View>

        {/* Category Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.space.lg,
            gap: 6,
            marginBottom: theme.space.md,
          }}
        >
          {ALL_CATEGORIES.map((cat) => {
            const active = activeCategory === cat;
            const color = cat === 'all' ? theme.colors.accent : getCategoryColor(cat);
            return (
              <Pressable
                key={cat}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setActiveCategory(cat);
                }}
                style={{
                  backgroundColor: active ? color : theme.colors.surface,
                  borderRadius: theme.radius.full,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: active ? color : theme.colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {cat !== 'all' && (
                  <Ionicons
                    name={getCategoryIcon(cat) as any}
                    size={14}
                    color={active ? '#fff' : color}
                  />
                )}
                <Text
                  style={{
                    color: active ? '#fff' : theme.colors.textSecondary,
                    fontSize: 12,
                    fontWeight: active ? '700' : '500',
                  }}
                >
                  {cat === 'all' ? '全部' : getCategoryLabel(cat)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Sort Tabs */}
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: theme.space.lg,
            gap: theme.space.md,
            marginBottom: theme.space.md,
          }}
        >
          {[
            { key: 'trending' as const, label: '熱門', icon: 'flame-outline' },
            { key: 'latest' as const, label: '最新', icon: 'time-outline' },
            { key: 'popular' as const, label: '人氣', icon: 'heart-outline' },
          ].map((s) => (
            <Pressable
              key={s.key}
              onPress={() => setSortBy(s.key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons
                name={s.icon as any}
                size={14}
                color={sortBy === s.key ? theme.colors.accent : theme.colors.textSecondary}
              />
              <Text
                style={{
                  color: sortBy === s.key ? theme.colors.accent : theme.colors.textSecondary,
                  fontSize: 13,
                  fontWeight: sortBy === s.key ? '700' : '500',
                }}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Trending Tags */}
        {stats && stats.trendingTags.length > 0 && activeCategory === 'all' && (
          <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.md }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {stats.trendingTags.slice(0, 6).map((t) => (
                <View
                  key={t.tag}
                  style={{
                    backgroundColor: theme.colors.accentSoft,
                    borderRadius: theme.radius.sm,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 11 }}>#{t.tag}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Posts */}
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onLike={() => handleLike(post.id)}
            onBookmark={() => handleBookmark(post.id)}
            onVote={(optId) => handleVote(post.id, optId)}
            onComment={() => setSelectedPost(post)}
          />
        ))}

        {posts.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: theme.space.xxl }}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} />
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: theme.space.md }}
            >
              這個分類還沒有貼文，來發第一篇吧！
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Compose Modal */}
      <ComposeModal
        visible={showCompose}
        onClose={() => setShowCompose(false)}
        onSubmit={async (data) => {
          const result = await createPost(data);
          if (result.success && result.post) {
            setPosts((prev) => [result.post!, ...prev]);
            earnXP('write_review').catch(() => {});
          }
          setShowCompose(false);
        }}
      />

      {/* Comments Modal */}
      {selectedPost && <CommentsModal post={selectedPost} onClose={() => setSelectedPost(null)} />}
    </View>
  );
}

// ─── Post Card ──────────────────────────────────────────

function PostCard({
  post,
  onLike,
  onBookmark,
  onVote,
  onComment,
}: {
  post: SocialPost;
  onLike: () => void;
  onBookmark: () => void;
  onVote: (optionId: string) => void;
  onComment: () => void;
}) {
  const catColor = getCategoryColor(post.category);
  const timeAgo = formatTimeAgo(post.createdAt);
  const hasVoted = post.pollOptions?.some((o) => o.votedByMe);
  const totalVotes = post.pollOptions?.reduce((s, o) => s + o.votes, 0) || 0;

  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.lg,
        borderWidth: 1,
        borderColor: post.pinned ? theme.colors.accent + '40' : theme.colors.border,
      }}
    >
      {/* Author & Category */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: catColor + '20',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons name={getCategoryIcon(post.category) as any} size={16} color={catColor} />
          </View>
          <View>
            <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
              {post.authorAlias}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {post.authorDept && (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 10 }}>
                  {post.authorDept}
                </Text>
              )}
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{timeAgo}</Text>
            </View>
          </View>
        </View>
        <View
          style={{
            backgroundColor: catColor + '15',
            borderRadius: theme.radius.sm,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color: catColor, fontSize: 10, fontWeight: '600' }}>
            {getCategoryLabel(post.category)}
          </Text>
        </View>
      </View>

      {/* Content */}
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
        {post.title}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 14,
          lineHeight: 20,
          marginBottom: theme.space.sm,
        }}
      >
        {post.content}
      </Text>

      {/* Marketplace info */}
      {post.category === 'marketplace' && post.price != null && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            backgroundColor: theme.colors.bg,
            borderRadius: theme.radius.md,
            padding: theme.space.sm,
            marginBottom: theme.space.sm,
          }}
        >
          <Text style={{ color: '#10B981', fontSize: 20, fontWeight: '800' }}>${post.price}</Text>
          {post.condition && (
            <View
              style={{
                backgroundColor: theme.colors.accentSoft,
                borderRadius: theme.radius.sm,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 11 }}>
                {post.condition === 'new'
                  ? '全新'
                  : post.condition === 'like_new'
                    ? '近全新'
                    : post.condition === 'good'
                      ? '良好'
                      : post.condition === 'fair'
                        ? '普通'
                        : '堪用'}
              </Text>
            </View>
          )}
          {post.sold && (
            <View
              style={{
                backgroundColor: '#EF444420',
                borderRadius: theme.radius.sm,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '600' }}>已售出</Text>
            </View>
          )}
        </View>
      )}

      {/* Poll */}
      {post.pollOptions && (
        <View style={{ marginBottom: theme.space.sm }}>
          {post.pollOptions.map((opt) => {
            const pct = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;
            return (
              <Pressable
                key={opt.id}
                onPress={() => !hasVoted && onVote(opt.id)}
                disabled={!!hasVoted}
                style={{
                  backgroundColor: theme.colors.bg,
                  borderRadius: theme.radius.md,
                  padding: theme.space.sm,
                  marginBottom: 4,
                  borderWidth: 1,
                  borderColor: opt.votedByMe ? theme.colors.accent : theme.colors.border,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {hasVoted && (
                  <View
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${pct}%` as any,
                      backgroundColor: opt.votedByMe
                        ? theme.colors.accent + '20'
                        : theme.colors.border + '40',
                      borderRadius: theme.radius.md,
                    }}
                  />
                )}
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    zIndex: 1,
                  }}
                >
                  <Text
                    style={{
                      color: opt.votedByMe ? theme.colors.accent : theme.colors.text,
                      fontSize: 13,
                      fontWeight: opt.votedByMe ? '700' : '500',
                    }}
                  >
                    {opt.text}
                  </Text>
                  {hasVoted && (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                      {pct.toFixed(0)}%
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            {totalVotes} 票
            {post.pollEndsAt && post.pollEndsAt > Date.now()
              ? ` · 剩 ${Math.ceil((post.pollEndsAt - Date.now()) / (24 * 60 * 60 * 1000))} 天`
              : ''}
          </Text>
        </View>
      )}

      {/* Tags */}
      {post.tags.length > 0 && (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: theme.space.sm }}
        >
          {post.tags.map((tag) => (
            <Text key={tag} style={{ color: theme.colors.accent, fontSize: 11 }}>
              #{tag}
            </Text>
          ))}
        </View>
      )}

      {/* Action Bar */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          paddingTop: theme.space.sm,
        }}
      >
        <Pressable onPress={onLike} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="heart-outline" size={18} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{post.likes}</Text>
        </Pressable>
        <Pressable
          onPress={onComment}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Ionicons name="chatbubble-outline" size={18} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            {post.commentCount}
          </Text>
        </Pressable>
        <Pressable onPress={onBookmark}>
          <Ionicons
            name={post.bookmarked ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={post.bookmarked ? theme.colors.accent : theme.colors.textSecondary}
          />
        </Pressable>
        <Pressable>
          <Ionicons name="share-social-outline" size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Compose Modal ──────────────────────────────────────

function ComposeModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: Parameters<typeof createPost>[0]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<PostCategory>('course_discussion');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;
    onSubmit({
      category,
      title: title.trim(),
      content: content.trim(),
      tags: tags.split(/[,，\s]+/).filter(Boolean),
    });
    setTitle('');
    setContent('');
    setTags('');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
      >
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: theme.space.lg }}>
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.space.lg,
            }}
          >
            <Pressable onPress={onClose}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 16 }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
              發佈貼文
            </Text>
            <Pressable
              onPress={handleSubmit}
              disabled={!title.trim() || !content.trim()}
              style={({ pressed }) => ({
                backgroundColor:
                  title.trim() && content.trim() ? theme.colors.accent : theme.colors.disabledBg,
                borderRadius: theme.radius.md,
                paddingHorizontal: 16,
                paddingVertical: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: title.trim() && content.trim() ? '#fff' : theme.colors.disabledText,
                  fontSize: 14,
                  fontWeight: '600',
                }}
              >
                發佈
              </Text>
            </Pressable>
          </View>

          {/* Category Picker */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, marginBottom: theme.space.md }}
          >
            {(
              [
                'course_discussion',
                'confession',
                'vent',
                'marketplace',
                'food_review',
                'question',
                'poll',
                'lost_found',
              ] as PostCategory[]
            ).map((cat) => {
              const active = category === cat;
              const color = getCategoryColor(cat);
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={{
                    backgroundColor: active ? color : theme.colors.surface,
                    borderRadius: theme.radius.full,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: active ? color : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: active ? '#fff' : theme.colors.textSecondary,
                      fontSize: 12,
                      fontWeight: active ? '700' : '500',
                    }}
                  >
                    {getCategoryLabel(cat)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Title */}
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="標題"
            placeholderTextColor={theme.colors.muted}
            style={{
              color: theme.colors.text,
              fontSize: 18,
              fontWeight: '700',
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              paddingVertical: theme.space.sm,
              marginBottom: theme.space.sm,
            }}
          />

          {/* Content */}
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="說些什麼..."
            placeholderTextColor={theme.colors.muted}
            multiline
            style={{
              color: theme.colors.text,
              fontSize: 15,
              minHeight: 120,
              textAlignVertical: 'top',
              marginBottom: theme.space.md,
            }}
          />

          {/* Tags */}
          <TextInput
            value={tags}
            onChangeText={setTags}
            placeholder="標籤（用逗號分隔）"
            placeholderTextColor={theme.colors.muted}
            style={{
              color: theme.colors.text,
              fontSize: 14,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              padding: theme.space.sm,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Comments Modal ─────────────────────────────────────

function CommentsModal({ post, onClose }: { post: SocialPost; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');

  useEffect(() => {
    getComments(post.id).then((c) => {
      setComments(c);
      setLoading(false);
    });
  }, [post.id]);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    const result = await addComment(post.id, input.trim());
    if (result.success && result.comment) {
      setComments((prev) => [...prev, result.comment!]);
      setInput('');
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + 8 }}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: theme.space.lg,
            paddingBottom: theme.space.sm,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
            留言 ({comments.length})
          </Text>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        {/* Comments List */}
        <ScrollView style={{ flex: 1, paddingHorizontal: theme.space.lg }}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: theme.space.xl }} color={theme.colors.accent} />
          ) : (
            comments.map((c) => (
              <View
                key={c.id}
                style={{
                  paddingVertical: theme.space.md,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text
                    style={{
                      color: c.isOP ? theme.colors.accent : theme.colors.text,
                      fontSize: 13,
                      fontWeight: '600',
                    }}
                  >
                    {c.authorAlias} {c.isOP ? '(原PO)' : ''}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    {formatTimeAgo(c.createdAt)}
                  </Text>
                </View>
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 14,
                    marginTop: 4,
                    lineHeight: 20,
                  }}
                >
                  {c.content}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Input */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: theme.space.lg,
              paddingVertical: theme.space.sm,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              paddingBottom: insets.bottom + theme.space.sm,
              gap: theme.space.sm,
            }}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="寫留言..."
              placeholderTextColor={theme.colors.muted}
              style={{
                flex: 1,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.full,
                paddingHorizontal: 16,
                paddingVertical: 10,
                fontSize: 14,
              }}
            />
            <Pressable onPress={handleSubmit} disabled={!input.trim()}>
              <Ionicons
                name="send"
                size={24}
                color={input.trim() ? theme.colors.accent : theme.colors.muted}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Helpers ────────────────────────────────────────────

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins}分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小時前`;
  return `${Math.floor(hours / 24)}天前`;
}
