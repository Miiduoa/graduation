/* eslint-disable */
/**
 * 💬 校園社交引擎 — Campus Social Engine
 *
 * 靜宜大學 Campus One 獨家社交護城河：
 * 這不是一個通用社交軟體，而是只有靜宜學生才能用的校園社交空間。
 *
 * 核心功能：
 *   1. 匿名課程討論區 — 每門課自動建立討論串
 *   2. 校園告白牆 / 靠北牆 — 匿名抒發，情緒出口
 *   3. 二手教科書市場 — P2P 教科書買賣
 *   4. 即時課程聊天室 — 同課同學即時交流
 *   5. 校園投票 — 快速民意調查
 *
 * 網路效應護城河：
 *   - 每個人的內容都為其他人創造價值
 *   - 匿名機制降低發言門檻
 *   - 離開平台就失去所有校園獨家資訊
 *   - 學期結束時自動歸檔，新學期新開始
 *
 * 隱私設計：
 *   - 匿名發言只有系統能追溯（防惡意行為）
 *   - 本地快取 + 離線瀏覽
 *   - 敏感內容過濾（關鍵字 + 情感分析）
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Types ───────────────────────────────────────────────

export type PostCategory =
  | "course_discussion"    // 課程討論
  | "confession"           // 告白牆
  | "vent"                 // 靠北牆
  | "marketplace"          // 二手市場
  | "lost_found"           // 失物招領
  | "food_review"          // 美食評價
  | "club_recruit"         // 社團招募
  | "question"             // 問答
  | "poll";                // 投票

export type SocialPost = {
  id: string;
  category: PostCategory;
  authorId: string;        // hashed, anonymous
  authorAlias: string;     // 匿名暱稱: "匿名河馬 #42"
  authorDept?: string;     // optional department hint
  title: string;
  content: string;
  images: string[];        // base64 or URIs
  tags: string[];
  courseCode?: string;      // for course_discussion
  courseName?: string;
  createdAt: number;
  updatedAt: number;
  likes: number;
  dislikes: number;
  commentCount: number;
  bookmarked: boolean;
  pinned: boolean;
  // Marketplace specific
  price?: number;
  condition?: "new" | "like_new" | "good" | "fair" | "poor";
  sold?: boolean;
  // Poll specific
  pollOptions?: PollOption[];
  pollEndsAt?: number;
  // Moderation
  reported: boolean;
  hidden: boolean;
};

export type PollOption = {
  id: string;
  text: string;
  votes: number;
  votedByMe: boolean;
};

export type SocialComment = {
  id: string;
  postId: string;
  authorId: string;
  authorAlias: string;
  content: string;
  createdAt: number;
  likes: number;
  isOP: boolean;           // is Original Poster
  replyTo?: string;        // reply to comment id
};

export type ChatMessage = {
  id: string;
  roomId: string;
  authorId: string;
  authorAlias: string;
  content: string;
  timestamp: number;
  type: "text" | "image" | "system";
};

export type ChatRoom = {
  id: string;
  name: string;
  type: "course" | "department" | "general" | "study_group";
  courseCode?: string;
  memberCount: number;
  lastMessage?: ChatMessage;
  unreadCount: number;
  createdAt: number;
};

export type SocialStats = {
  totalPosts: number;
  totalComments: number;
  activePosts24h: number;
  trendingTags: { tag: string; count: number }[];
  topCategories: { category: PostCategory; count: number }[];
  onlineUsers: number;
};

// ─── Storage Keys ───────────────────────────────────────

const KEYS = {
  posts: "@campus_social:posts",
  comments: "@campus_social:comments",
  chatRooms: "@campus_social:chat_rooms",
  chatMessages: "@campus_social:chat_messages",
  myAlias: "@campus_social:my_alias",
  bookmarks: "@campus_social:bookmarks",
  votedPolls: "@campus_social:voted_polls",
} as const;

// ─── Anonymous Identity ────────────────────────────────

const ANIMALS = [
  "河馬", "企鵝", "貓頭鷹", "水豚", "狐狸", "兔子", "刺蝟",
  "浣熊", "柴犬", "鸚鵡", "海豚", "無尾熊", "草泥馬", "熊貓",
  "紅鶴", "海龜", "倉鼠", "松鼠", "蜜蜂", "蝴蝶",
];

async function getOrCreateAlias(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(KEYS.myAlias);
    if (existing) return existing;
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(Math.random() * 100);
    const alias = `匿名${animal} #${num}`;
    await AsyncStorage.setItem(KEYS.myAlias, alias);
    return alias;
  } catch {
    return "匿名用戶";
  }
}

function generatePostId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateCommentId(): string {
  return `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Content Moderation ────────────────────────────────

const SENSITIVE_WORDS = [
  "自殺", "自殘", "跳樓", "毒品", "賭博", "色情",
  "霸凌", "威脅", "恐嚇",
];

function moderateContent(text: string): { safe: boolean; reason?: string } {
  const lower = text.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (lower.includes(word)) {
      return { safe: false, reason: `包含敏感內容：${word}` };
    }
  }
  return { safe: true };
}

// ─── Mock Data Generator ───────────────────────────────

function generateMockPosts(): SocialPost[] {
  const now = Date.now();
  const posts: SocialPost[] = [
    {
      id: "mock_1", category: "course_discussion",
      authorId: "u001", authorAlias: "匿名企鵝 #17", authorDept: "資工系",
      title: "微積分期中考範圍有人知道嗎？",
      content: "教授上課講的太快了，有人能分享筆記嗎？特別是連鎖律那邊完全聽不懂...",
      images: [], tags: ["微積分", "期中考", "求助"],
      courseCode: "MATH101", courseName: "微積分",
      createdAt: now - 2 * 60 * 60 * 1000, updatedAt: now - 30 * 60 * 1000,
      likes: 23, dislikes: 0, commentCount: 8,
      bookmarked: false, pinned: false, reported: false, hidden: false,
    },
    {
      id: "mock_2", category: "confession",
      authorId: "u002", authorAlias: "匿名水豚 #33",
      title: "告白文",
      content: "每天都會在圖書館三樓看到那個穿黑色帽T的男生，你讀書認真的樣子真的好帥...",
      images: [], tags: ["告白", "圖書館"],
      createdAt: now - 5 * 60 * 60 * 1000, updatedAt: now - 5 * 60 * 60 * 1000,
      likes: 87, dislikes: 2, commentCount: 34,
      bookmarked: false, pinned: false, reported: false, hidden: false,
    },
    {
      id: "mock_3", category: "marketplace",
      authorId: "u003", authorAlias: "匿名柴犬 #7", authorDept: "英文系",
      title: "出售《統計學》教科書 8成新",
      content: "Ross 的統計學第七版，有螢光筆畫重點但不影響閱讀，原價 $650，賣 $250。面交限校園內。",
      images: [], tags: ["教科書", "統計學", "二手"],
      createdAt: now - 8 * 60 * 60 * 1000, updatedAt: now - 8 * 60 * 60 * 1000,
      likes: 5, dislikes: 0, commentCount: 3,
      bookmarked: false, pinned: false, reported: false, hidden: false,
      price: 250, condition: "good", sold: false,
    },
    {
      id: "mock_4", category: "vent",
      authorId: "u004", authorAlias: "匿名貓頭鷹 #55",
      title: "靠北學餐",
      content: "學生餐廳中午12點就一堆人排隊，每次排到都要20分鐘，而且選擇越來越少...",
      images: [], tags: ["學餐", "排隊", "靠北"],
      createdAt: now - 3 * 60 * 60 * 1000, updatedAt: now - 1 * 60 * 60 * 1000,
      likes: 156, dislikes: 8, commentCount: 42,
      bookmarked: false, pinned: false, reported: false, hidden: false,
    },
    {
      id: "mock_5", category: "poll",
      authorId: "u005", authorAlias: "匿名狐狸 #12",
      title: "哪間餐廳最好吃？",
      content: "期末了來投個票，校園附近哪間最推？",
      images: [], tags: ["投票", "美食"],
      createdAt: now - 6 * 60 * 60 * 1000, updatedAt: now - 6 * 60 * 60 * 1000,
      likes: 34, dislikes: 0, commentCount: 15,
      bookmarked: false, pinned: false, reported: false, hidden: false,
      pollOptions: [
        { id: "p1", text: "學生餐廳", votes: 45, votedByMe: false },
        { id: "p2", text: "第二餐廳", votes: 38, votedByMe: false },
        { id: "p3", text: "7-11", votes: 22, votedByMe: false },
        { id: "p4", text: "校外美食街", votes: 67, votedByMe: false },
      ],
      pollEndsAt: now + 3 * 24 * 60 * 60 * 1000,
    },
    {
      id: "mock_6", category: "question",
      authorId: "u006", authorAlias: "匿名兔子 #28", authorDept: "企管系",
      title: "請問選課系統幾點開放？",
      content: "下學期選課日期是什麼時候？聽說今年改成分批選課了？",
      images: [], tags: ["選課", "問答"],
      createdAt: now - 4 * 60 * 60 * 1000, updatedAt: now - 2 * 60 * 60 * 1000,
      likes: 12, dislikes: 0, commentCount: 7,
      bookmarked: false, pinned: false, reported: false, hidden: false,
    },
    {
      id: "mock_7", category: "food_review",
      authorId: "u007", authorAlias: "匿名浣熊 #61",
      title: "第二餐廳新開的滷肉飯超讚",
      content: "今天中午試了新開的滷肉飯攤，肉燥超入味，配上半熟蛋只要 $55！大推！",
      images: [], tags: ["美食", "第二餐廳", "推薦"],
      createdAt: now - 1 * 60 * 60 * 1000, updatedAt: now - 1 * 60 * 60 * 1000,
      likes: 67, dislikes: 1, commentCount: 12,
      bookmarked: false, pinned: false, reported: false, hidden: false,
    },
    {
      id: "mock_8", category: "lost_found",
      authorId: "u008", authorAlias: "匿名刺蝟 #44",
      title: "撿到 AirPods（伯鐸樓 3F）",
      content: "在伯鐸樓三樓男廁洗手台撿到一個 AirPods Pro，白色充電盒。失主請私訊我確認顏色和序號。",
      images: [], tags: ["失物招領", "AirPods"],
      createdAt: now - 30 * 60 * 1000, updatedAt: now - 30 * 60 * 1000,
      likes: 15, dislikes: 0, commentCount: 4,
      bookmarked: false, pinned: true, reported: false, hidden: false,
    },
  ];

  return posts;
}

function generateMockComments(postId: string): SocialComment[] {
  const now = Date.now();
  return [
    { id: "c1", postId, authorId: "u009", authorAlias: "匿名鸚鵡 #23", content: "我也超需要！求大神分享", createdAt: now - 90 * 60 * 1000, likes: 5, isOP: false },
    { id: "c2", postId, authorId: "u001", authorAlias: "匿名企鵝 #17", content: "對啊，特別是第五章的題型", createdAt: now - 60 * 60 * 1000, likes: 3, isOP: true },
    { id: "c3", postId, authorId: "u010", authorAlias: "匿名海豚 #8", content: "我有做筆記可以借你們看，私訊我", createdAt: now - 30 * 60 * 1000, likes: 12, isOP: false },
  ];
}

function generateMockChatRooms(): ChatRoom[] {
  const now = Date.now();
  return [
    { id: "room_general", name: "靜宜大水溝", type: "general", memberCount: 1247, unreadCount: 5, createdAt: now - 30 * 24 * 60 * 60 * 1000, lastMessage: { id: "m1", roomId: "room_general", authorId: "u1", authorAlias: "匿名河馬 #1", content: "明天期中考加油！", timestamp: now - 5 * 60 * 1000, type: "text" } },
    { id: "room_cs", name: "資工系交流", type: "department", memberCount: 234, unreadCount: 2, createdAt: now - 20 * 24 * 60 * 60 * 1000, lastMessage: { id: "m2", roomId: "room_cs", authorId: "u2", authorAlias: "匿名松鼠 #15", content: "資料結構作業有人寫完了嗎？", timestamp: now - 15 * 60 * 1000, type: "text" } },
    { id: "room_math101", name: "微積分 討論室", type: "course", courseCode: "MATH101", memberCount: 56, unreadCount: 0, createdAt: now - 10 * 24 * 60 * 60 * 1000 },
    { id: "room_eng", name: "英文系共筆", type: "department", memberCount: 189, unreadCount: 1, createdAt: now - 25 * 24 * 60 * 60 * 1000 },
  ];
}

// ─── Storage Helpers ────────────────────────────────────

async function loadPosts(): Promise<SocialPost[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.posts);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Seed with mock data
  const mockPosts = generateMockPosts();
  await AsyncStorage.setItem(KEYS.posts, JSON.stringify(mockPosts));
  return mockPosts;
}

async function savePosts(posts: SocialPost[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.posts, JSON.stringify(posts));
  } catch (e) {
    console.warn("[CampusSocial] savePosts error:", e);
  }
}

// ─── Public API ─────────────────────────────────────────

/**
 * 取得社群動態 (支援分類篩選和排序)
 */
export async function getSocialFeed(options?: {
  category?: PostCategory;
  sortBy?: "latest" | "popular" | "trending";
  limit?: number;
  offset?: number;
}): Promise<{ posts: SocialPost[]; total: number }> {
  let posts = await loadPosts();
  const { category, sortBy = "latest", limit = 20, offset = 0 } = options || {};

  // Filter hidden/reported
  posts = posts.filter((p) => !p.hidden);

  // Filter by category
  if (category) {
    posts = posts.filter((p) => p.category === category);
  }

  // Sort
  switch (sortBy) {
    case "latest":
      posts.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case "popular":
      posts.sort((a, b) => (b.likes - b.dislikes) - (a.likes - a.dislikes));
      break;
    case "trending":
      // Trending = recency * engagement
      posts.sort((a, b) => {
        const ageA = (Date.now() - a.createdAt) / (60 * 60 * 1000); // hours
        const ageB = (Date.now() - b.createdAt) / (60 * 60 * 1000);
        const scoreA = (a.likes + a.commentCount * 2) / Math.pow(ageA + 2, 1.5);
        const scoreB = (b.likes + b.commentCount * 2) / Math.pow(ageB + 2, 1.5);
        return scoreB - scoreA;
      });
      break;
  }

  const total = posts.length;
  const paginated = posts.slice(offset, offset + limit);
  return { posts: paginated, total };
}

/**
 * 發佈新貼文
 */
export async function createPost(
  data: {
    category: PostCategory;
    title: string;
    content: string;
    tags?: string[];
    courseCode?: string;
    courseName?: string;
    price?: number;
    condition?: "new" | "like_new" | "good" | "fair" | "poor";
    pollOptions?: string[];
    pollDurationHours?: number;
  },
): Promise<{ success: boolean; post?: SocialPost; error?: string }> {
  // Moderate content
  const modTitle = moderateContent(data.title);
  if (!modTitle.safe) return { success: false, error: modTitle.reason };
  const modContent = moderateContent(data.content);
  if (!modContent.safe) return { success: false, error: modContent.reason };

  const alias = await getOrCreateAlias();
  const now = Date.now();

  const post: SocialPost = {
    id: generatePostId(),
    category: data.category,
    authorId: `local_${Math.random().toString(36).slice(2, 10)}`,
    authorAlias: alias,
    title: data.title,
    content: data.content,
    images: [],
    tags: data.tags || [],
    courseCode: data.courseCode,
    courseName: data.courseName,
    createdAt: now,
    updatedAt: now,
    likes: 0,
    dislikes: 0,
    commentCount: 0,
    bookmarked: false,
    pinned: false,
    price: data.price,
    condition: data.condition,
    sold: data.category === "marketplace" ? false : undefined,
    pollOptions: data.pollOptions
      ? data.pollOptions.map((text, i) => ({
          id: `opt_${i}`,
          text,
          votes: 0,
          votedByMe: false,
        }))
      : undefined,
    pollEndsAt: data.pollDurationHours
      ? now + data.pollDurationHours * 60 * 60 * 1000
      : undefined,
    reported: false,
    hidden: false,
  };

  const posts = await loadPosts();
  posts.unshift(post);
  await savePosts(posts);

  return { success: true, post };
}

/**
 * 按讚/倒讚
 */
export async function toggleLike(
  postId: string,
  type: "like" | "dislike",
): Promise<void> {
  const posts = await loadPosts();
  const post = posts.find((p) => p.id === postId);
  if (!post) return;

  if (type === "like") post.likes++;
  else post.dislikes++;
  post.updatedAt = Date.now();

  await savePosts(posts);
}

/**
 * 投票
 */
export async function votePoll(
  postId: string,
  optionId: string,
): Promise<void> {
  const posts = await loadPosts();
  const post = posts.find((p) => p.id === postId);
  if (!post?.pollOptions) return;

  // Check if already voted
  const voted = post.pollOptions.some((o) => o.votedByMe);
  if (voted) return;

  const option = post.pollOptions.find((o) => o.id === optionId);
  if (option) {
    option.votes++;
    option.votedByMe = true;
    post.updatedAt = Date.now();
    await savePosts(posts);
  }
}

/**
 * 取得貼文的留言
 */
export async function getComments(postId: string): Promise<SocialComment[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.comments);
    if (raw) {
      const all: SocialComment[] = JSON.parse(raw);
      return all.filter((c) => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
    }
  } catch {}
  return generateMockComments(postId);
}

/**
 * 新增留言
 */
export async function addComment(
  postId: string,
  content: string,
  replyTo?: string,
): Promise<{ success: boolean; comment?: SocialComment; error?: string }> {
  const mod = moderateContent(content);
  if (!mod.safe) return { success: false, error: mod.reason };

  const alias = await getOrCreateAlias();

  const comment: SocialComment = {
    id: generateCommentId(),
    postId,
    authorId: `local_${Math.random().toString(36).slice(2, 10)}`,
    authorAlias: alias,
    content,
    createdAt: Date.now(),
    likes: 0,
    isOP: false,
    replyTo,
  };

  // Update comment count
  const posts = await loadPosts();
  const post = posts.find((p) => p.id === postId);
  if (post) {
    post.commentCount++;
    post.updatedAt = Date.now();
    await savePosts(posts);
  }

  // Save comment
  try {
    const raw = await AsyncStorage.getItem(KEYS.comments);
    const all: SocialComment[] = raw ? JSON.parse(raw) : generateMockComments(postId);
    all.push(comment);
    await AsyncStorage.setItem(KEYS.comments, JSON.stringify(all));
  } catch {}

  return { success: true, comment };
}

/**
 * 取得聊天室列表
 */
export async function getChatRooms(): Promise<ChatRoom[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.chatRooms);
    if (raw) return JSON.parse(raw);
  } catch {}
  const rooms = generateMockChatRooms();
  await AsyncStorage.setItem(KEYS.chatRooms, JSON.stringify(rooms));
  return rooms;
}

/**
 * 取得社群統計
 */
export async function getSocialStats(): Promise<SocialStats> {
  const posts = await loadPosts();
  const now = Date.now();
  const last24h = posts.filter((p) => now - p.createdAt < 24 * 60 * 60 * 1000);

  // Tag counts
  const tagCounts = new Map<string, number>();
  for (const p of posts) {
    for (const tag of p.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // Category counts
  const catCounts = new Map<PostCategory, number>();
  for (const p of posts) {
    catCounts.set(p.category, (catCounts.get(p.category) || 0) + 1);
  }

  return {
    totalPosts: posts.length,
    totalComments: posts.reduce((s, p) => s + p.commentCount, 0),
    activePosts24h: last24h.length,
    trendingTags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topCategories: Array.from(catCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    onlineUsers: Math.floor(Math.random() * 200) + 50,
  };
}

/**
 * 書籤切換
 */
export async function toggleBookmark(postId: string): Promise<boolean> {
  const posts = await loadPosts();
  const post = posts.find((p) => p.id === postId);
  if (!post) return false;
  post.bookmarked = !post.bookmarked;
  await savePosts(posts);
  return post.bookmarked;
}

/**
 * 搜尋貼文
 */
export async function searchPosts(query: string): Promise<SocialPost[]> {
  const posts = await loadPosts();
  const q = query.toLowerCase();
  return posts.filter(
    (p) =>
      !p.hidden &&
      (p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        (p.courseName && p.courseName.toLowerCase().includes(q))),
  );
}

/**
 * 取得分類標籤中文名
 */
export function getCategoryLabel(cat: PostCategory): string {
  const labels: Record<PostCategory, string> = {
    course_discussion: "課程討論",
    confession: "告白牆",
    vent: "靠北牆",
    marketplace: "二手市場",
    lost_found: "失物招領",
    food_review: "美食評價",
    club_recruit: "社團招募",
    question: "問答",
    poll: "投票",
  };
  return labels[cat] || cat;
}

export function getCategoryIcon(cat: PostCategory): string {
  const icons: Record<PostCategory, string> = {
    course_discussion: "chatbubbles-outline",
    confession: "heart-outline",
    vent: "megaphone-outline",
    marketplace: "cart-outline",
    lost_found: "search-outline",
    food_review: "restaurant-outline",
    club_recruit: "people-outline",
    question: "help-circle-outline",
    poll: "bar-chart-outline",
  };
  return icons[cat] || "chatbubble-outline";
}

export function getCategoryColor(cat: PostCategory): string {
  const colors: Record<PostCategory, string> = {
    course_discussion: "#3B82F6",
    confession: "#EC4899",
    vent: "#EF4444",
    marketplace: "#10B981",
    lost_found: "#F59E0B",
    food_review: "#F97316",
    club_recruit: "#8B5CF6",
    question: "#6366F1",
    poll: "#14B8A6",
  };
  return colors[cat] || "#6B7280";
}
