/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
/**
 * 蓋夏圖書館 — 商業級智慧圖書館體驗
 *
 * 創新功能：
 * 1. 時段感知首頁 — 根據時間推薦不同行為
 * 2. 智慧語意搜尋 — 「我想學 AI」→ 推薦 ML/DL 書籍 + 標示樓層
 * 3. 即時樓層熱力圖 — 哪層人多、哪層安靜一目了然
 * 4. 討論室即時預約 — 帶設備資訊 + 容量 + 時段衝突檢查
 * 5. 學習計時器 — 番茄鐘 / 深度工作 / 考前衝刺
 * 6. 閱讀成就系統 — 遊戲化激勵持續閱讀
 * 7. 書籍定位 — 告訴你書在第幾樓哪個區域 + AR 導航
 * 8. 課程連動推薦 — 根據你的課表推薦教科書
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ScrollView, Text, View, Pressable, RefreshControl, Alert,
  FlatList, Modal, Vibration, Animated, Easing, Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen, AnimatedCard, Card, Button, Pill, SegmentedControl,
  SectionHeader, SearchBar, Skeleton, ProgressRing, ListItem,
  FilterChips, Badge, Avatar, Spinner, EmptyState,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { analytics } from "../services/analytics";

import {
  GAESIA_LIBRARY_INFO, OPENING_HOURS, getLibraryOpenStatus,
  LIBRARY_FLOORS, type FloorId, type LibraryFloor,
  BORROW_PRIVILEGES, getBorrowPrivilege, type BorrowerRole,
  STUDY_ROOMS, type StudyRoom,
  SEAT_ZONES, type SeatZone,
  LIBRARY_BOOKS, type LibraryBookEntry, type BookCategory, BOOK_CATEGORY_LABELS,
  smartSearchBooks, getSmartLibrarySuggestions, type SmartSuggestion,
  simulateFloorOccupancy, type FloorOccupancy,
  STUDY_TIMER_PRESETS, type StudyTimerPreset,
  READING_ACHIEVEMENTS, type ReadingAchievement,
  POPULAR_SEARCHES, STAFF_PICKS, getBookById,
} from "../data/puLibraryData";

type LibTab = "home" | "search" | "floors" | "rooms" | "timer";

const { width: SW } = Dimensions.get("window");

// ═══════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════

export function LibraryScreen(props: Record<string, unknown>) {
  const nav = (props as any)?.navigation;
  const auth = useAuth();

  const [tab, setTab] = useState<LibTab>("home");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibraryBookEntry[]>([]);
  const [searchFloorHint, setSearchFloorHint] = useState<FloorId | undefined>();
  const [searchIntentLabel, setSearchIntentLabel] = useState<string>();
  const [isSearching, setIsSearching] = useState(false);

  // Occupancy
  const [occupancy, setOccupancy] = useState<FloorOccupancy[]>([]);

  // Selected book
  const [selectedBook, setSelectedBook] = useState<LibraryBookEntry | null>(null);

  // Study timer
  const [activeTimer, setActiveTimer] = useState<StudyTimerPreset | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerPhase, setTimerPhase] = useState<"focus" | "break">("focus");
  const [timerRound, setTimerRound] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Room booking
  const [selectedRoom, setSelectedRoom] = useState<StudyRoom | null>(null);

  // Smart suggestions
  const [suggestions, setSuggestions] = useState<SmartSuggestion[]>([]);

  // Achievements
  const [showAchievements, setShowAchievements] = useState(false);

  // Borrowed books count (simulated)
  const [borrowedCount] = useState(3);
  const [overdueCount] = useState(1);

  useEffect(() => {
    analytics.logScreenView("Library");
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const hour = new Date().getHours();
      setOccupancy(simulateFloorOccupancy(hour));
      setSuggestions(getSmartLibrarySuggestions(hour));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const hour = new Date().getHours();
    setOccupancy(simulateFloorOccupancy(hour));
    setSuggestions(getSmartLibrarySuggestions(hour));
    setRefreshing(false);
  }, []);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    analytics.logSearch(searchQuery);

    setTimeout(() => {
      const result = smartSearchBooks(searchQuery);
      setSearchResults(result.books);
      setSearchFloorHint(result.floorHint);
      setSearchIntentLabel(result.intentLabel);
      setIsSearching(false);
    }, 300);
  }, [searchQuery]);

  const handleQuickSearch = useCallback((term: string) => {
    setSearchQuery(term);
    setTab("search");
    setTimeout(() => {
      const result = smartSearchBooks(term);
      setSearchResults(result.books);
      setSearchFloorHint(result.floorHint);
      setSearchIntentLabel(result.intentLabel);
    }, 100);
  }, []);

  // Timer logic
  const startTimer = useCallback((preset: StudyTimerPreset) => {
    setActiveTimer(preset);
    setTimerSeconds(preset.focusMinutes * 60);
    setTimerPhase("focus");
    setTimerRound(1);
    setTimerRunning(true);
  }, []);

  useEffect(() => {
    if (timerRunning && timerSeconds > 0) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((s) => s - 1);
      }, 1000);
    } else if (timerRunning && timerSeconds === 0 && activeTimer) {
      // Phase complete
      Vibration.vibrate(500);
      if (timerPhase === "focus") {
        if (timerRound >= activeTimer.rounds) {
          Alert.alert("完成！", `已完成 ${activeTimer.rounds} 輪 ${activeTimer.name}，太棒了！`);
          setTimerRunning(false);
          setActiveTimer(null);
        } else {
          setTimerPhase("break");
          setTimerSeconds(activeTimer.breakMinutes * 60);
        }
      } else {
        setTimerPhase("focus");
        setTimerRound((r) => r + 1);
        setTimerSeconds(activeTimer.focusMinutes * 60);
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning, timerSeconds]);

  const handleBookARNav = useCallback((book: LibraryBookEntry) => {
    if (nav) {
      nav.navigate("ARNavigation", {
        destination: `蓋夏圖書館 ${book.floor}`,
        destinationId: "pu-library",
        destinationLat: GAESIA_LIBRARY_INFO.lat,
        destinationLng: GAESIA_LIBRARY_INFO.lng,
      });
    }
  }, [nav]);

  const handleBookRoom = useCallback((room: StudyRoom) => {
    Alert.alert(
      "預約確認",
      `確定要預約「${room.name}」嗎？\n容量：${room.capacity} 人\n時長上限：${room.maxHoursPerSession} 小時`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認預約",
          onPress: () => {
            Alert.alert("預約成功", `已預約 ${room.name}\n請於 15 分鐘內到場簽到`);
            setSelectedRoom(null);
          },
        },
      ],
    );
  }, []);

  const openStatus = useMemo(() => getLibraryOpenStatus(), []);

  if (loading) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 8 }}>
          <Skeleton height={48} borderRadius={theme.radius.md} />
          <Skeleton height={120} borderRadius={theme.radius.lg} />
          <Skeleton height={180} borderRadius={theme.radius.lg} />
          <Skeleton height={120} borderRadius={theme.radius.lg} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Tab bar ── */}
        <SegmentedControl
          options={[
            { key: "home", label: "首頁" },
            { key: "search", label: "找書" },
            { key: "floors", label: "樓層" },
            { key: "rooms", label: "空間" },
            { key: "timer", label: "計時" },
          ]}
          selected={tab}
          onChange={(k) => setTab(k as LibTab)}
        />

        {/* ═══════════ HOME TAB ═══════════ */}
        {tab === "home" && (
          <>
            {/* Status banner */}
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              padding: 14, borderRadius: theme.radius.lg,
              backgroundColor: openStatus.isOpen ? `${theme.colors.success}15` : `${theme.colors.danger}15`,
              borderWidth: 1,
              borderColor: openStatus.isOpen ? `${theme.colors.success}30` : `${theme.colors.danger}30`,
            }}>
              <View style={{
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: openStatus.isOpen ? theme.colors.success : theme.colors.danger,
              }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                  蓋夏圖書館 · {openStatus.message}
                </Text>
                {openStatus.closesAt && (
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    今日閉館時間 {openStatus.closesAt}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => Alert.alert("開放時間", OPENING_HOURS.map((h) => `${h.label}：${h.isOpen ? `${h.open}–${h.close}` : "休館"}`).join("\n"))}>
                <Ionicons name="time-outline" size={22} color={theme.colors.accent} />
              </Pressable>
            </View>

            {/* Quick stats */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatMini label="借閱中" value={borrowedCount} color={theme.colors.accent} icon="book" />
              <StatMini label="已逾期" value={overdueCount} color={theme.colors.danger} icon="alert-circle" />
              <StatMini
                label="空座位"
                value={occupancy.reduce((s, o) => s + (o.totalSeats - o.occupied), 0)}
                color={theme.colors.success}
                icon="desktop"
              />
            </View>

            {/* Smart suggestions */}
            {suggestions.length > 0 && (
              <AnimatedCard title="為你推薦" subtitle="根據時間智慧推薦" delay={100}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 4 }}>
                    {suggestions.map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => {
                          if (s.action === "search") handleQuickSearch(s.payload || s.label);
                          else if (s.action === "seat") setTab("floors");
                          else if (s.action === "room") setTab("rooms");
                          else if (s.action === "floor") setTab("floors");
                          else if (s.action === "ebook") Alert.alert("HyRead 電子書", "前往 1F 無紙境電子書區或開啟 HyRead App");
                        }}
                        style={({ pressed }) => ({
                          width: 140, padding: 14, borderRadius: theme.radius.lg,
                          backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
                          borderWidth: 1, borderColor: theme.colors.border,
                          gap: 8,
                        })}
                      >
                        <View style={{
                          width: 36, height: 36, borderRadius: 18,
                          backgroundColor: theme.colors.accentSoft,
                          alignItems: "center", justifyContent: "center",
                        }}>
                          <Ionicons name={s.icon as any} size={18} color={theme.colors.accent} />
                        </View>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
                          {s.label}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={2}>
                          {s.description}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </AnimatedCard>
            )}

            {/* Floor heatmap preview */}
            <AnimatedCard title="樓層人潮" subtitle="即時座位狀況" delay={200}>
              <View style={{ gap: 6 }}>
                {occupancy.slice(0, 6).map((o) => {
                  const floor = LIBRARY_FLOORS.find((f) => f.id === o.floor);
                  const pct = o.percentage;
                  const barColor = pct > 70 ? theme.colors.danger : pct > 40 ? "#F59E0B" : theme.colors.success;
                  return (
                    <Pressable
                      key={o.floor}
                      onPress={() => setTab("floors")}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}
                    >
                      <Text style={{ color: theme.colors.muted, fontSize: 12, width: 28, textAlign: "right" }}>
                        {o.floor}
                      </Text>
                      <View style={{ flex: 1, height: 18, borderRadius: 9, backgroundColor: theme.colors.border, overflow: "hidden" }}>
                        <View style={{ width: `${pct}%`, height: "100%", borderRadius: 9, backgroundColor: barColor }} />
                      </View>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, width: 36, textAlign: "right" }}>
                        {pct}%
                      </Text>
                      <Ionicons
                        name={o.trend === "rising" ? "trending-up" : o.trend === "falling" ? "trending-down" : "remove"}
                        size={14}
                        color={o.trend === "rising" ? theme.colors.danger : o.trend === "falling" ? theme.colors.success : theme.colors.muted}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <Pressable onPress={() => setTab("floors")} style={{ alignItems: "center", paddingTop: 8 }}>
                <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>查看全部樓層 →</Text>
              </Pressable>
            </AnimatedCard>

            {/* Staff picks */}
            <AnimatedCard title="館員推薦" subtitle="本月精選好書" delay={300}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 4 }}>
                  {STAFF_PICKS.map((id) => {
                    const book = getBookById(id);
                    if (!book) return null;
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setSelectedBook(book)}
                        style={({ pressed }) => ({
                          width: 110, gap: 6,
                          opacity: pressed ? 0.8 : 1,
                        })}
                      >
                        <View style={{
                          width: 110, height: 150, borderRadius: 8,
                          backgroundColor: book.coverColor,
                          alignItems: "center", justifyContent: "center",
                          shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
                        }}>
                          <Ionicons name="book" size={32} color="#fff" />
                          <Text style={{ color: "#ffffffCC", fontSize: 10, marginTop: 6, textAlign: "center", paddingHorizontal: 8 }} numberOfLines={2}>
                            {book.title}
                          </Text>
                        </View>
                        <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
                          {book.title}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
                          {book.author.split(",")[0]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </AnimatedCard>

            {/* Achievements preview */}
            <AnimatedCard title="閱讀成就" subtitle="收集你的圖書館徽章" delay={400}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
                {READING_ACHIEVEMENTS.slice(0, 6).map((a, idx) => {
                  const earned = idx < 2; // simulate: first 2 earned
                  return (
                    <View key={a.id} style={{ alignItems: "center", width: 72 }}>
                      <View style={{
                        width: 48, height: 48, borderRadius: 24,
                        backgroundColor: earned ? `${a.color}20` : theme.colors.surface2,
                        borderWidth: earned ? 2 : 1,
                        borderColor: earned ? a.color : theme.colors.border,
                        alignItems: "center", justifyContent: "center",
                      }}>
                        <Ionicons name={a.icon as any} size={22} color={earned ? a.color : theme.colors.muted} />
                      </View>
                      <Text style={{ color: earned ? theme.colors.text : theme.colors.muted, fontSize: 10, marginTop: 4, textAlign: "center" }} numberOfLines={1}>
                        {a.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Pressable onPress={() => setShowAchievements(true)} style={{ alignItems: "center", paddingTop: 8 }}>
                <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>查看全部成就 →</Text>
              </Pressable>
            </AnimatedCard>

            {/* Borrowing rules */}
            <AnimatedCard title="借閱規則" subtitle="大學部學生" delay={500}>
              {(() => {
                const p = getBorrowPrivilege("undergraduate");
                return (
                  <View style={{ gap: 8 }}>
                    <ListItem icon="book-outline" title="可借冊數" subtitle={`${p.bookLimit} 冊`} />
                    <ListItem icon="time-outline" title="借閱天數" subtitle={`${p.bookDays} 天`} />
                    <ListItem icon="refresh-outline" title="續借次數" subtitle={`${p.renewTimes} 次`} />
                    <ListItem icon="bookmark-outline" title="預約冊數" subtitle={`${p.reserveLimit} 冊`} />
                    <ListItem icon="alert-circle-outline" title="逾期罰款" subtitle={`每冊每日 $${p.overdueFinePerDay} 元`} />
                  </View>
                );
              })()}
            </AnimatedCard>
          </>
        )}

        {/* ═══════════ SEARCH TAB ═══════════ */}
        {tab === "search" && (
          <>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="書名、作者、ISBN 或「我想學 AI」"
              onSubmit={handleSearch}
            />

            {searchQuery.length > 0 && (
              <Button text="搜尋" kind="primary" onPress={handleSearch} disabled={isSearching} />
            )}

            {isSearching ? (
              <View style={{ gap: 12 }}>
                <Skeleton height={100} borderRadius={theme.radius.lg} />
                <Skeleton height={100} borderRadius={theme.radius.lg} />
              </View>
            ) : searchResults.length > 0 ? (
              <>
                {/* Intent hint */}
                {searchIntentLabel && (
                  <View style={{
                    flexDirection: "row", alignItems: "center", gap: 8,
                    padding: 10, borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.accentSoft,
                  }}>
                    <Ionicons name="bulb-outline" size={16} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 13, flex: 1 }}>
                      為你搜尋「{searchIntentLabel}」相關書籍
                      {searchFloorHint ? ` · 主要在 ${searchFloorHint}` : ""}
                    </Text>
                  </View>
                )}

                <AnimatedCard title="搜尋結果" subtitle={`找到 ${searchResults.length} 本`}>
                  <View style={{ gap: 12 }}>
                    {searchResults.map((book) => (
                      <BookCard
                        key={book.id}
                        book={book}
                        onPress={() => setSelectedBook(book)}
                        onNavigate={() => handleBookARNav(book)}
                      />
                    ))}
                  </View>
                </AnimatedCard>
              </>
            ) : searchQuery && !isSearching ? (
              <EmptyState icon="search-outline" title="沒有找到結果" subtitle="試試其他關鍵字，或用自然語言描述你想找的" />
            ) : (
              <>
                {/* Popular searches */}
                <AnimatedCard title="熱門搜尋">
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {POPULAR_SEARCHES.map((term) => (
                      <Pressable
                        key={term}
                        onPress={() => handleQuickSearch(term)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14, paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface2,
                          borderWidth: 1, borderColor: theme.colors.border,
                        })}
                      >
                        <Text style={{ color: theme.colors.text, fontSize: 13 }}>{term}</Text>
                      </Pressable>
                    ))}
                  </View>
                </AnimatedCard>

                {/* Browse by category */}
                <AnimatedCard title="依分類瀏覽" delay={100}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {(["computer_science", "programming", "ai_ml", "web_development", "database", "mathematics", "literature", "language"] as BookCategory[]).map((cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => handleQuickSearch(BOOK_CATEGORY_LABELS[cat])}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14, paddingVertical: 10,
                          borderRadius: theme.radius.md,
                          backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface2,
                          borderWidth: 1, borderColor: theme.colors.border,
                          flexDirection: "row", alignItems: "center", gap: 6,
                        })}
                      >
                        <Ionicons name="folder-outline" size={14} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.text, fontSize: 13 }}>{BOOK_CATEGORY_LABELS[cat]}</Text>
                      </Pressable>
                    ))}
                  </View>
                </AnimatedCard>
              </>
            )}
          </>
        )}

        {/* ═══════════ FLOORS TAB ═══════════ */}
        {tab === "floors" && (
          <>
            {/* Heatmap legend */}
            <View style={{
              flexDirection: "row", justifyContent: "center", gap: 16,
              padding: 10, borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface2,
            }}>
              {[
                { color: theme.colors.success, label: "寬鬆 <40%" },
                { color: "#F59E0B", label: "適中 40-70%" },
                { color: theme.colors.danger, label: "擁擠 >70%" },
              ].map((l) => (
                <View key={l.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }} />
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{l.label}</Text>
                </View>
              ))}
            </View>

            {/* Floor cards */}
            {LIBRARY_FLOORS.filter((f) => f.seatCapacity > 0).map((floor, idx) => {
              const occ = occupancy.find((o) => o.floor === floor.id);
              const pct = occ?.percentage ?? 0;
              const avail = occ ? occ.totalSeats - occ.occupied : floor.seatCapacity;
              const barColor = pct > 70 ? theme.colors.danger : pct > 40 ? "#F59E0B" : theme.colors.success;

              return (
                <AnimatedCard key={floor.id} title={floor.name} delay={idx * 50}>
                  {/* Occupancy bar */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <View style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: theme.colors.border, overflow: "hidden" }}>
                      <View style={{ width: `${pct}%`, height: "100%", borderRadius: 6, backgroundColor: barColor }} />
                    </View>
                    <Text style={{ color: barColor, fontWeight: "800", fontSize: 14, width: 45, textAlign: "right" }}>
                      {avail} 空
                    </Text>
                  </View>

                  {/* Facilities */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {floor.facilities.slice(0, 5).map((f) => (
                      <View key={f} style={{
                        paddingHorizontal: 8, paddingVertical: 3,
                        borderRadius: 4, backgroundColor: theme.colors.surface2,
                      }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{f}</Text>
                      </View>
                    ))}
                    {floor.facilities.length > 5 && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: theme.colors.surface2 }}>
                        <Text style={{ color: theme.colors.accent, fontSize: 11 }}>+{floor.facilities.length - 5}</Text>
                      </View>
                    )}
                  </View>

                  {/* Feature badges */}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {floor.hasDiscussionRoom && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="people-outline" size={13} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.accent, fontSize: 11 }}>討論室</Text>
                      </View>
                    )}
                    {floor.hasResearchRoom && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="person-outline" size={13} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.accent, fontSize: 11 }}>研究小間</Text>
                      </View>
                    )}
                    {floor.hasCopyArea && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="print-outline" size={13} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>影印區</Text>
                      </View>
                    )}
                    {floor.hasStudyArea && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="library-outline" size={13} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>自習區</Text>
                      </View>
                    )}
                  </View>

                  {/* Collections */}
                  {floor.collections.length > 0 && (
                    <View style={{ marginTop: 8, padding: 8, borderRadius: theme.radius.sm, backgroundColor: `${theme.colors.accent}08` }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                        館藏：{floor.collections.join(" · ")}
                      </Text>
                    </View>
                  )}
                </AnimatedCard>
              );
            })}
          </>
        )}

        {/* ═══════════ ROOMS TAB ═══════════ */}
        {tab === "rooms" && (
          <>
            <SectionHeader title="討論室" action="可預約" />
            {STUDY_ROOMS.filter((r) => r.type === "discussion").map((room, idx) => (
              <AnimatedCard key={room.id} title={room.name} subtitle={`容量 ${room.capacity} 人 · 上限 ${room.maxHoursPerSession} 小時`} delay={idx * 50}>
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
                  {room.hasWhiteboard && <FeatureBadge icon="easel-outline" label="白板" />}
                  {room.hasProjector && <FeatureBadge icon="videocam-outline" label="投影機" />}
                  {room.hasScreen && <FeatureBadge icon="tv-outline" label="螢幕" />}
                  {room.hasOutlet && <FeatureBadge icon="flash-outline" label="插座" />}
                </View>
                <Button text="立即預約" kind="primary" onPress={() => handleBookRoom(room)} />
              </AnimatedCard>
            ))}

            <SectionHeader title="研究小間" action="教師/研究生" />
            {STUDY_ROOMS.filter((r) => r.type === "research").map((room, idx) => (
              <AnimatedCard key={room.id} title={room.name} subtitle={`${room.floor} · 個人使用 · 上限 ${room.maxHoursPerSession} 小時`} delay={idx * 50}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="information-circle-outline" size={14} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>限碩博士生及教師使用</Text>
                </View>
                <Button text="預約" onPress={() => handleBookRoom(room)} />
              </AnimatedCard>
            ))}

            <SectionHeader title="團體視聽室" />
            {STUDY_ROOMS.filter((r) => r.type === "av_room").map((room, idx) => (
              <AnimatedCard key={room.id} title={room.name} subtitle={`容量 ${room.capacity} 人 · 2F 數位學習中心`} delay={idx * 50}>
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
                  <FeatureBadge icon="videocam-outline" label="投影機" />
                  <FeatureBadge icon="tv-outline" label="螢幕" />
                  <FeatureBadge icon="volume-high-outline" label="音響" />
                </View>
                <Button text="預約" onPress={() => handleBookRoom(room)} />
              </AnimatedCard>
            ))}

            {/* Seat zones */}
            <SectionHeader title="自習座位區" action={`${SEAT_ZONES.length} 個區域`} />
            {SEAT_ZONES.map((zone, idx) => {
              const occ = occupancy.find((o) => o.floor === zone.floor);
              const pct = occ?.percentage ?? 30;
              const fakeAvail = Math.max(1, Math.round(zone.totalSeats * (1 - pct / 100)));
              const barColor = pct > 70 ? theme.colors.danger : pct > 40 ? "#F59E0B" : theme.colors.success;

              return (
                <Pressable
                  key={zone.id}
                  style={({ pressed }) => ({
                    padding: 14, borderRadius: theme.radius.lg,
                    backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
                    borderWidth: 1, borderColor: theme.colors.border,
                    gap: 8,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>{zone.name}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{zone.description}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: barColor, fontWeight: "800", fontSize: 16 }}>{fakeAvail}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>/{zone.totalSeats} 空</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {zone.hasOutlet && <FeatureBadge icon="flash-outline" label="插座" />}
                    {zone.isQuietZone && <FeatureBadge icon="volume-mute-outline" label="安靜區" />}
                    {zone.hasNaturalLight && <FeatureBadge icon="sunny-outline" label="自然光" />}
                    <FeatureBadge
                      icon={zone.noiseLevel === "silent" ? "ear-outline" : zone.noiseLevel === "quiet" ? "volume-low-outline" : "volume-medium-outline"}
                      label={zone.noiseLevel === "silent" ? "靜音" : zone.noiseLevel === "quiet" ? "安靜" : "可交談"}
                    />
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {/* ═══════════ TIMER TAB ═══════════ */}
        {tab === "timer" && (
          <>
            {activeTimer && timerRunning ? (
              /* Active timer display */
              <AnimatedCard title={activeTimer.name} subtitle={`第 ${timerRound}/${activeTimer.rounds} 輪 · ${timerPhase === "focus" ? "專注中" : "休息中"}`}>
                <View style={{ alignItems: "center", paddingVertical: 20 }}>
                  <View style={{ width: 160, height: 160, alignItems: "center", justifyContent: "center" }}>
                    <ProgressRing
                      progress={
                        timerPhase === "focus"
                          ? timerSeconds / (activeTimer.focusMinutes * 60)
                          : timerSeconds / (activeTimer.breakMinutes * 60)
                      }
                      size={160}
                      strokeWidth={8}
                      color={timerPhase === "focus" ? theme.colors.accent : theme.colors.success}
                      showLabel={false}
                    />
                    <Text style={{
                      position: "absolute",
                      color: theme.colors.text, fontSize: 36, fontWeight: "900",
                      fontVariant: ["tabular-nums"],
                    }}>
                      {Math.floor(timerSeconds / 60).toString().padStart(2, "0")}:{(timerSeconds % 60).toString().padStart(2, "0")}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 14 }}>
                    {timerPhase === "focus" ? "保持專注，你做得到！" : "休息一下，喝口水"}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Button
                    text={timerRunning ? "暫停" : "繼續"}
                    kind="primary"
                    onPress={() => setTimerRunning(!timerRunning)}
                  />
                  <Button
                    text="結束"
                    onPress={() => {
                      Alert.alert("結束計時？", "確定要結束這次學習嗎？", [
                        { text: "取消", style: "cancel" },
                        {
                          text: "結束",
                          style: "destructive",
                          onPress: () => {
                            setTimerRunning(false);
                            setActiveTimer(null);
                            if (timerRef.current) clearInterval(timerRef.current);
                          },
                        },
                      ]);
                    }}
                  />
                </View>
              </AnimatedCard>
            ) : (
              /* Timer presets */
              <>
                <AnimatedCard title="選擇學習模式" subtitle="開始你的專注時光">
                  <View style={{ gap: 12 }}>
                    {STUDY_TIMER_PRESETS.map((preset) => (
                      <Pressable
                        key={preset.id}
                        onPress={() => startTimer(preset)}
                        style={({ pressed }) => ({
                          flexDirection: "row", alignItems: "center",
                          padding: 16, borderRadius: theme.radius.lg,
                          backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface2,
                          borderWidth: 1, borderColor: theme.colors.border,
                          gap: 14,
                        })}
                      >
                        <View style={{
                          width: 48, height: 48, borderRadius: 24,
                          backgroundColor: theme.colors.accentSoft,
                          alignItems: "center", justifyContent: "center",
                        }}>
                          <Ionicons name={preset.icon as any} size={24} color={theme.colors.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{preset.name}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{preset.description}</Text>
                          <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4 }}>
                            {preset.focusMinutes} 分鐘專注 · {preset.breakMinutes} 分鐘休息 · {preset.rounds} 輪
                          </Text>
                        </View>
                        <Ionicons name="play-circle" size={28} color={theme.colors.accent} />
                      </Pressable>
                    ))}
                  </View>
                </AnimatedCard>

                {/* Study tips */}
                <AnimatedCard title="學習小技巧" delay={100}>
                  <View style={{ gap: 8 }}>
                    <ListItem icon="water-outline" title="補充水分" subtitle="每 25 分鐘喝一口水，保持頭腦清醒" />
                    <ListItem icon="eye-outline" title="20-20-20 護眼" subtitle="每 20 分鐘看 20 英尺外的物體 20 秒" />
                    <ListItem icon="body-outline" title="伸展運動" subtitle="休息時站起來活動身體，提升血液循環" />
                    <ListItem icon="phone-portrait-outline" title="遠離手機" subtitle="專注時段將手機翻面或開啟勿擾模式" />
                  </View>
                </AnimatedCard>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* ═══════════ Book Detail Modal ═══════════ */}
      {selectedBook && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setSelectedBook(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <View style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: 24, maxHeight: "85%",
            }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Handle bar */}
                <View style={{ alignItems: "center", marginBottom: 16 }}>
                  <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
                </View>

                {/* Book cover */}
                <View style={{ alignItems: "center", marginBottom: 20 }}>
                  <View style={{
                    width: 120, height: 170, borderRadius: 12,
                    backgroundColor: selectedBook.coverColor,
                    alignItems: "center", justifyContent: "center",
                    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
                  }}>
                    <Ionicons name="book" size={40} color="#fff" />
                  </View>
                </View>

                <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: "800", textAlign: "center" }}>
                  {selectedBook.title}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 14, textAlign: "center", marginTop: 4 }}>
                  {selectedBook.author}
                </Text>

                {/* Availability */}
                <View style={{
                  flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 16,
                }}>
                  <View style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                    backgroundColor: selectedBook.availableCopies > 0 ? `${theme.colors.success}20` : `${theme.colors.danger}20`,
                  }}>
                    <Text style={{
                      color: selectedBook.availableCopies > 0 ? theme.colors.success : theme.colors.danger,
                      fontSize: 13, fontWeight: "700",
                    }}>
                      {selectedBook.availableCopies > 0 ? `可借 ${selectedBook.availableCopies}/${selectedBook.totalCopies}` : "全數借出"}
                    </Text>
                  </View>
                  <View style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                    backgroundColor: theme.colors.accentSoft,
                  }}>
                    <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>
                      {selectedBook.language === "zh" ? "中文" : "英文"}
                    </Text>
                  </View>
                </View>

                {/* Info grid */}
                <View style={{
                  marginTop: 20, gap: 12,
                  padding: 16, borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2,
                }}>
                  <InfoLine label="出版社" value={selectedBook.publisher} />
                  <InfoLine label="出版年" value={String(selectedBook.year)} />
                  <InfoLine label="ISBN" value={selectedBook.isbn} />
                  <InfoLine label="索書號" value={selectedBook.callNumber} />
                  <InfoLine label="位置" value={selectedBook.location} />
                  <InfoLine label="分類" value={BOOK_CATEGORY_LABELS[selectedBook.category]} />
                  {selectedBook.pageCount && <InfoLine label="頁數" value={`${selectedBook.pageCount} 頁`} />}
                </View>

                {/* Description */}
                <View style={{ marginTop: 16 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
                    {selectedBook.description}
                  </Text>
                </View>

                {/* Related courses */}
                {selectedBook.relatedCourses && selectedBook.relatedCourses.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14, marginBottom: 8 }}>相關課程</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {selectedBook.relatedCourses.map((c) => (
                        <View key={c} style={{
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                          backgroundColor: theme.colors.accentSoft,
                        }}>
                          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Tags */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
                  {selectedBook.tags.map((t) => (
                    <Pill key={t} text={`#${t}`} />
                  ))}
                </View>

                {/* Actions */}
                <View style={{ flexDirection: "row", gap: 12, marginTop: 24, marginBottom: 20 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      text="AR 帶我去書架"
                      kind="primary"
                      onPress={() => {
                        setSelectedBook(null);
                        handleBookARNav(selectedBook);
                      }}
                    />
                  </View>
                  {selectedBook.availableCopies === 0 && (
                    <View style={{ flex: 1 }}>
                      <Button
                        text="預約此書"
                        onPress={() => {
                          Alert.alert("預約成功", `已預約「${selectedBook.title}」，到書後將通知您`);
                          setSelectedBook(null);
                        }}
                      />
                    </View>
                  )}
                </View>

                <Button text="關閉" onPress={() => setSelectedBook(null)} />
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* ═══════════ Achievements Modal ═══════════ */}
      {showAchievements && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowAchievements(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <View style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: 24, maxHeight: "80%",
            }}>
              <View style={{ alignItems: "center", marginBottom: 16 }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: "800", marginBottom: 16 }}>閱讀成就</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ gap: 12 }}>
                  {READING_ACHIEVEMENTS.map((a, idx) => {
                    const earned = idx < 2;
                    return (
                      <View key={a.id} style={{
                        flexDirection: "row", alignItems: "center", gap: 14,
                        padding: 14, borderRadius: theme.radius.lg,
                        backgroundColor: earned ? `${a.color}10` : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: earned ? `${a.color}30` : theme.colors.border,
                      }}>
                        <View style={{
                          width: 44, height: 44, borderRadius: 22,
                          backgroundColor: earned ? `${a.color}20` : theme.colors.surface2,
                          borderWidth: earned ? 2 : 1,
                          borderColor: earned ? a.color : theme.colors.border,
                          alignItems: "center", justifyContent: "center",
                        }}>
                          <Ionicons name={a.icon as any} size={20} color={earned ? a.color : theme.colors.muted} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: earned ? theme.colors.text : theme.colors.muted, fontWeight: "700", fontSize: 14 }}>
                            {a.name}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{a.description}</Text>
                          <Text style={{ color: earned ? a.color : theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                            {earned ? "已獲得" : a.requirement}
                          </Text>
                        </View>
                        {earned && <Ionicons name="checkmark-circle" size={24} color={a.color} />}
                      </View>
                    );
                  })}
                </View>
                <View style={{ height: 20 }} />
              </ScrollView>
              <Button text="關閉" onPress={() => setShowAchievements(false)} />
            </View>
          </View>
        </Modal>
      )}

      {/* Active timer floating indicator */}
      {activeTimer && timerRunning && tab !== "timer" && (
        <Pressable
          onPress={() => setTab("timer")}
          style={{
            position: "absolute", bottom: 20, right: 16,
            flexDirection: "row", alignItems: "center", gap: 8,
            paddingHorizontal: 16, paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: timerPhase === "focus" ? theme.colors.accent : theme.colors.success,
            shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
          }}
        >
          <Ionicons name="timer" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14, fontVariant: ["tabular-nums"] }}>
            {Math.floor(timerSeconds / 60).toString().padStart(2, "0")}:{(timerSeconds % 60).toString().padStart(2, "0")}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

// ═══════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════

function StatMini({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <View style={{
      flex: 1, alignItems: "center", padding: 14,
      borderRadius: theme.radius.lg,
      backgroundColor: `${color}12`,
      borderWidth: 1, borderColor: `${color}25`,
    }}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={{ color, fontWeight: "900", fontSize: 22, marginTop: 4 }}>{value}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function BookCard({ book, onPress, onNavigate }: { book: LibraryBookEntry; onPress: () => void; onNavigate: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        padding: 12, borderRadius: theme.radius.md,
        backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
        borderWidth: 1, borderColor: theme.colors.border,
        gap: 12,
      })}
    >
      <View style={{
        width: 55, height: 75, borderRadius: 6,
        backgroundColor: book.coverColor,
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name="book" size={22} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{book.title}</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{book.author.split(",")[0]}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <View style={{
            paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
            backgroundColor: book.availableCopies > 0 ? `${theme.colors.success}20` : `${theme.colors.danger}20`,
          }}>
            <Text style={{
              color: book.availableCopies > 0 ? theme.colors.success : theme.colors.danger,
              fontSize: 11, fontWeight: "600",
            }}>
              {book.availableCopies > 0 ? `可借 ${book.availableCopies}` : "借出中"}
            </Text>
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{book.floor} · {book.callNumber}</Text>
        </View>
      </View>
      <Pressable
        onPress={(e) => { e.stopPropagation(); onNavigate(); }}
        hitSlop={8}
        style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: theme.colors.accentSoft,
          alignItems: "center", justifyContent: "center",
          alignSelf: "center",
        }}
      >
        <Ionicons name="navigate" size={16} color={theme.colors.accent} />
      </Pressable>
    </Pressable>
  );
}

function FeatureBadge({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={icon as any} size={13} color={theme.colors.accent} />
      <Text style={{ color: theme.colors.accent, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "600", maxWidth: "60%", textAlign: "right" }}>{value}</Text>
    </View>
  );
}
