import React, { useState, useEffect, useCallback } from "react";
import { ScrollView, Text, View, Pressable, RefreshControl, Alert, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AnimatedCard, Card, Button, Pill, SegmentedControl, SectionHeader, SearchBar, StatusBadge, Skeleton, ProgressRing, ListItem } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDataSource, hasDataSource } from "../data";
import type { LibraryBook, LibraryLoan, LibrarySeat, SeatReservation } from "../data/types";
import { analytics } from "../services/analytics";

type LibraryTab = "home" | "search" | "borrow" | "seat";

type BorrowedBook = {
  id: string;
  title: string;
  author: string;
  coverColor: string;
  borrowDate: Date;
  dueDate: Date;
  renewCount: number;
  maxRenew: number;
};

type BookSearchResult = {
  id: string;
  title: string;
  author: string;
  publisher: string;
  year: number;
  isbn: string;
  available: number;
  total: number;
  location: string;
  coverColor: string;
};

type SeatArea = {
  id: string;
  name: string;
  floor: string;
  totalSeats: number;
  availableSeats: number;
  hasOutlet: boolean;
  isQuietZone: boolean;
};

const MOCK_BORROWED_BOOKS: BorrowedBook[] = [
  {
    id: "b1",
    title: "資料結構與演算法",
    author: "王小明",
    coverColor: "#3B82F6",
    borrowDate: new Date("2026-02-15"),
    dueDate: new Date("2026-03-15"),
    renewCount: 1,
    maxRenew: 2,
  },
  {
    id: "b2",
    title: "機器學習入門",
    author: "李大華",
    coverColor: "#10B981",
    borrowDate: new Date("2026-02-20"),
    dueDate: new Date("2026-03-07"),
    renewCount: 2,
    maxRenew: 2,
  },
  {
    id: "b3",
    title: "React Native 開發實戰",
    author: "張志偉",
    coverColor: "#8B5CF6",
    borrowDate: new Date("2026-02-25"),
    dueDate: new Date("2026-03-25"),
    renewCount: 0,
    maxRenew: 2,
  },
];

const MOCK_SEARCH_RESULTS: BookSearchResult[] = [
  {
    id: "s1",
    title: "深度學習",
    author: "Ian Goodfellow",
    publisher: "MIT Press",
    year: 2016,
    isbn: "978-0262035613",
    available: 2,
    total: 5,
    location: "3F 資訊區",
    coverColor: "#EF4444",
  },
  {
    id: "s2",
    title: "Python 程式設計",
    author: "Eric Matthes",
    publisher: "No Starch Press",
    year: 2019,
    isbn: "978-1593279288",
    available: 0,
    total: 3,
    location: "3F 資訊區",
    coverColor: "#F59E0B",
  },
  {
    id: "s3",
    title: "設計模式",
    author: "Gang of Four",
    publisher: "Addison-Wesley",
    year: 1994,
    isbn: "978-0201633610",
    available: 1,
    total: 2,
    location: "3F 資訊區",
    coverColor: "#6366F1",
  },
];

const MOCK_SEAT_AREAS: SeatArea[] = [
  { id: "a1", name: "自習區 A", floor: "2F", totalSeats: 100, availableSeats: 45, hasOutlet: true, isQuietZone: true },
  { id: "a2", name: "自習區 B", floor: "2F", totalSeats: 80, availableSeats: 12, hasOutlet: true, isQuietZone: true },
  { id: "a3", name: "討論區", floor: "3F", totalSeats: 60, availableSeats: 38, hasOutlet: true, isQuietZone: false },
  { id: "a4", name: "電腦區", floor: "4F", totalSeats: 50, availableSeats: 8, hasOutlet: true, isQuietZone: true },
  { id: "a5", name: "期刊閱覽區", floor: "5F", totalSeats: 40, availableSeats: 25, hasOutlet: false, isQuietZone: true },
];

function getDaysUntilDue(dueDate: Date): number {
  const now = new Date();
  const diff = dueDate.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getOccupancyLevel(available: number, total: number): "low" | "medium" | "high" {
  const ratio = available / total;
  if (ratio > 0.5) return "low";
  if (ratio > 0.2) return "medium";
  return "high";
}

export function LibraryScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { schoolId } = useSchool();

  const [tab, setTab] = useState<LibraryTab>("home");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [borrowedBooks, setBorrowedBooks] = useState<BorrowedBook[]>([]);
  const [seatAreas, setSeatAreas] = useState<SeatArea[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [serverLoans, setServerLoans] = useState<LibraryLoan[]>([]);
  const [serverSeats, setServerSeats] = useState<LibrarySeat[]>([]);

  useEffect(() => {
    analytics.logScreenView("Library");
    loadData();
  }, [auth.user?.uid, schoolId]);

  const loadData = async () => {
    setLoading(true);
    
    try {
      if (hasDataSource() && auth.user?.uid) {
        const ds = getDataSource();
        
        const [loans, seats] = await Promise.all([
          ds.listLoans(auth.user.uid),
          ds.listSeats(schoolId),
        ]);
        
        setServerLoans(loans);
        setServerSeats(seats);
        
        const convertedBooks: BorrowedBook[] = loans.map((loan, idx) => ({
          id: loan.id,
          title: `書籍 ${loan.bookId}`,
          author: "載入中...",
          coverColor: MOCK_BORROWED_BOOKS[idx % MOCK_BORROWED_BOOKS.length]?.coverColor ?? "#3B82F6",
          borrowDate: new Date(loan.borrowedAt),
          dueDate: new Date(loan.dueAt),
          renewCount: loan.renewCount,
          maxRenew: 2,
        }));
        
        setBorrowedBooks(convertedBooks.length > 0 ? convertedBooks : MOCK_BORROWED_BOOKS);
        
        const seatGroups = new Map<string, SeatArea>();
        for (const seat of seats) {
          const zone = seat.zone || "default";
          if (!seatGroups.has(zone)) {
            seatGroups.set(zone, {
              id: zone,
              name: seat.name || zone,
              floor: seat.floor || "1F",
              totalSeats: 0,
              availableSeats: 0,
              hasOutlet: seat.hasOutlet ?? true,
              isQuietZone: seat.isQuietZone ?? false,
            });
          }
          const group = seatGroups.get(zone)!;
          group.totalSeats++;
          if (seat.status === "available") {
            group.availableSeats++;
          }
        }
        
        const convertedAreas = Array.from(seatGroups.values());
        setSeatAreas(convertedAreas.length > 0 ? convertedAreas : MOCK_SEAT_AREAS);
      } else {
        setBorrowedBooks(MOCK_BORROWED_BOOKS);
        setSeatAreas(MOCK_SEAT_AREAS);
      }
    } catch (error) {
      console.error("Failed to load library data:", error);
      setBorrowedBooks(MOCK_BORROWED_BOOKS);
      setSeatAreas(MOCK_SEAT_AREAS);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    
    try {
      if (hasDataSource()) {
        const ds = getDataSource();
        const books = await ds.searchBooks(searchQuery, schoolId);
        
        const convertedResults: BookSearchResult[] = books.map((book, idx) => ({
          id: book.id,
          title: book.title,
          author: book.author,
          publisher: book.publisher || "未知",
          year: book.publishedYear || 0,
          isbn: book.isbn || "",
          available: book.available,
          total: book.copies,
          location: book.location || "圖書館",
          coverColor: MOCK_SEARCH_RESULTS[idx % MOCK_SEARCH_RESULTS.length]?.coverColor ?? "#3B82F6",
        }));
        
        setSearchResults(convertedResults.length > 0 ? convertedResults : MOCK_SEARCH_RESULTS.filter(
          (b) =>
            b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.author.toLowerCase().includes(searchQuery.toLowerCase())
        ));
      } else {
        setSearchResults(
          MOCK_SEARCH_RESULTS.filter(
            (b) =>
              b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              b.author.toLowerCase().includes(searchQuery.toLowerCase())
          )
        );
      }
      
      analytics.logSearch(searchQuery);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults(
        MOCK_SEARCH_RESULTS.filter(
          (b) =>
            b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.author.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleRenewBook = async (book: BorrowedBook) => {
    if (book.renewCount >= book.maxRenew) {
      Alert.alert("無法續借", "此書籍已達最大續借次數");
      return;
    }
    Alert.alert(
      "確認續借",
      `確定要續借「${book.title}」嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認",
          onPress: async () => {
            try {
              if (hasDataSource()) {
                const ds = getDataSource();
                await ds.renewBook(book.id);
                analytics.logEvent("book_renewed", { book_id: book.id });
              }
              
              setBorrowedBooks((prev) =>
                prev.map((b) =>
                  b.id === book.id
                    ? {
                        ...b,
                        dueDate: new Date(b.dueDate.getTime() + 14 * 24 * 60 * 60 * 1000),
                        renewCount: b.renewCount + 1,
                      }
                    : b
                )
              );
              Alert.alert("成功", "已成功續借，新到期日為兩週後");
            } catch (error) {
              Alert.alert("錯誤", error instanceof Error ? error.message : "續借失敗");
            }
          },
        },
      ]
    );
  };

  const handleReserveBook = (book: BookSearchResult) => {
    if (book.available > 0) {
      Alert.alert("提示", "此書籍目前有館藏可借，請直接至書架取書");
      return;
    }
    Alert.alert(
      "確認預約",
      `確定要預約「${book.title}」嗎？到書後會通知您`,
      [
        { text: "取消", style: "cancel" },
        { text: "確認", onPress: () => Alert.alert("成功", "已預約成功，到書後會發送通知") },
      ]
    );
  };

  const handleReserveSeat = async (area: SeatArea) => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能預約座位");
      return;
    }
    
    if (area.availableSeats === 0) {
      Alert.alert("座位已滿", "此區域目前沒有空位");
      return;
    }
    Alert.alert(
      "預約座位",
      `確定要預約「${area.name}」的座位嗎？`,
      [
        { text: "取消", style: "cancel" },
        { 
          text: "確認", 
          onPress: async () => {
            try {
              if (hasDataSource() && serverSeats.length > 0) {
                const ds = getDataSource();
                const availableSeat = serverSeats.find(
                  s => s.zone === area.id && s.status === "available"
                );
                
                if (availableSeat) {
                  const today = new Date().toISOString().split("T")[0];
                  const now = new Date();
                  const startTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
                  const endHour = Math.min(now.getHours() + 4, 22);
                  const endTime = `${endHour.toString().padStart(2, "0")}:00`;
                  
                  await ds.reserveSeat(availableSeat.id, auth.user.uid, today, startTime, endTime);
                  analytics.logEvent("seat_reserved", { area_id: area.id, seat_id: availableSeat.id });
                }
              }
              
              Alert.alert("成功", `已預約 ${area.name} 座位，請於 30 分鐘內入座`);
              loadData();
            } catch (error) {
              Alert.alert("錯誤", error instanceof Error ? error.message : "預約失敗");
            }
          }
        },
      ]
    );
  };

  const totalAvailableSeats = seatAreas.reduce((sum, a) => sum + a.availableSeats, 0);
  const totalSeats = seatAreas.reduce((sum, a) => sum + a.totalSeats, 0);
  const overdueBooks = borrowedBooks.filter((b) => getDaysUntilDue(b.dueDate) < 0);
  const soonDueBooks = borrowedBooks.filter((b) => {
    const days = getDaysUntilDue(b.dueDate);
    return days >= 0 && days <= 7;
  });

  if (loading) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 8 }}>
          <Skeleton height={60} borderRadius={theme.radius.md} />
          <Skeleton height={150} borderRadius={theme.radius.lg} />
          <Skeleton height={200} borderRadius={theme.radius.lg} />
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
      >
        <SegmentedControl
          options={[
            { key: "home", label: "首頁" },
            { key: "search", label: "查書" },
            { key: "borrow", label: "借閱" },
            { key: "seat", label: "座位" },
          ]}
          selected={tab}
          onChange={(k) => setTab(k as LibraryTab)}
        />

        {tab === "home" && (
          <>
            <AnimatedCard title="歡迎使用圖書館服務" subtitle="查詢館藏、管理借閱、預約座位">
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSoft }}>
                  <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{borrowedBooks.length}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>借閱中</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.danger}15` }}>
                  <Text style={{ color: theme.colors.danger, fontWeight: "900", fontSize: 24 }}>{overdueBooks.length}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>已逾期</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.success}15` }}>
                  <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{totalAvailableSeats}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>空座位</Text>
                </View>
              </View>
            </AnimatedCard>

            {soonDueBooks.length > 0 && (
              <AnimatedCard title="即將到期" subtitle="請盡快歸還或續借" delay={100}>
                <View style={{ gap: 10 }}>
                  {soonDueBooks.map((book) => {
                    const daysLeft = getDaysUntilDue(book.dueDate);
                    return (
                      <Pressable
                        key={book.id}
                        onPress={() => setTab("borrow")}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 40,
                            height: 55,
                            borderRadius: 4,
                            backgroundColor: book.coverColor,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="book" size={18} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>{book.title}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{book.author}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: daysLeft <= 3 ? theme.colors.danger : "#F59E0B", fontWeight: "700" }}>
                            {daysLeft} 天
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>後到期</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </AnimatedCard>
            )}

            <AnimatedCard title="快速功能" delay={200}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {[
                  { icon: "search", label: "查詢館藏", tab: "search" as const },
                  { icon: "library", label: "我的借閱", tab: "borrow" as const },
                  { icon: "location", label: "座位預約", tab: "seat" as const },
                  { icon: "time", label: "開放時間", action: () => Alert.alert("開放時間", "週一至週五：08:00 - 22:00\n週六日：09:00 - 18:00") },
                ].map((item) => (
                  <Pressable
                    key={item.label}
                    onPress={item.action ?? (() => setTab(item.tab!))}
                    style={({ pressed }) => ({
                      flex: 1,
                      minWidth: "45%",
                      padding: 16,
                      borderRadius: theme.radius.lg,
                      backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      alignItems: "center",
                      gap: 8,
                    })}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: theme.colors.accentSoft,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={item.icon as any} size={22} color={theme.colors.accent} />
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </AnimatedCard>

            <AnimatedCard title="座位概況" subtitle="即時座位資訊" delay={300}>
              <View style={{ alignItems: "center", paddingVertical: 12 }}>
                <ProgressRing progress={totalAvailableSeats / totalSeats} size={80} color={theme.colors.success} />
                <Text style={{ color: theme.colors.muted, marginTop: 8 }}>
                  {totalAvailableSeats} / {totalSeats} 空位
                </Text>
              </View>
            </AnimatedCard>
          </>
        )}

        {tab === "search" && (
          <>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="輸入書名、作者或 ISBN"
              onSubmit={handleSearch}
            />

            {searchQuery && (
              <Button text="搜尋" kind="primary" onPress={handleSearch} disabled={isSearching} />
            )}

            {isSearching ? (
              <View style={{ gap: 12 }}>
                <Skeleton height={100} borderRadius={theme.radius.lg} />
                <Skeleton height={100} borderRadius={theme.radius.lg} />
              </View>
            ) : searchResults.length > 0 ? (
              <AnimatedCard title="搜尋結果" subtitle={`找到 ${searchResults.length} 筆`}>
                <View style={{ gap: 12 }}>
                  {searchResults.map((book) => (
                    <Pressable
                      key={book.id}
                      onPress={() => handleReserveBook(book)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        gap: 12,
                      })}
                    >
                      <View
                        style={{
                          width: 50,
                          height: 70,
                          borderRadius: 4,
                          backgroundColor: book.coverColor,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="book" size={24} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }} numberOfLines={1}>{book.title}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{book.author}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                          {book.publisher} · {book.year}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 4,
                              backgroundColor: book.available > 0 ? `${theme.colors.success}20` : `${theme.colors.danger}20`,
                            }}
                          >
                            <Text
                              style={{
                                color: book.available > 0 ? theme.colors.success : theme.colors.danger,
                                fontSize: 11,
                                fontWeight: "600",
                              }}
                            >
                              {book.available > 0 ? `可借 ${book.available}/${book.total}` : "已借出"}
                            </Text>
                          </View>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{book.location}</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>
            ) : searchQuery && !isSearching ? (
              <Card title="沒有找到結果" subtitle="請嘗試其他關鍵字" />
            ) : (
              <AnimatedCard title="熱門搜尋" subtitle="點擊快速搜尋">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {["Python", "機器學習", "資料結構", "網頁設計", "演算法", "深度學習"].map((term) => (
                    <Pressable
                      key={term}
                      onPress={() => {
                        setSearchQuery(term);
                        handleSearch();
                      }}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      })}
                    >
                      <Text style={{ color: theme.colors.text, fontSize: 13 }}>{term}</Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>
            )}
          </>
        )}

        {tab === "borrow" && (
          <>
            <AnimatedCard title="借閱中書籍" subtitle={`共 ${borrowedBooks.length} 本`}>
              {borrowedBooks.length === 0 ? (
                <View style={{ alignItems: "center", padding: 24 }}>
                  <Ionicons name="library-outline" size={48} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12 }}>目前沒有借閱中的書籍</Text>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  {borrowedBooks.map((book) => {
                    const daysLeft = getDaysUntilDue(book.dueDate);
                    const isOverdue = daysLeft < 0;
                    return (
                      <View
                        key={book.id}
                        style={{
                          padding: 14,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: isOverdue ? theme.colors.danger : theme.colors.border,
                          gap: 12,
                        }}
                      >
                        <View style={{ flexDirection: "row", gap: 12 }}>
                          <View
                            style={{
                              width: 50,
                              height: 70,
                              borderRadius: 4,
                              backgroundColor: book.coverColor,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons name="book" size={24} color="#fff" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{book.title}</Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{book.author}</Text>
                            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                              <Pill text={`借閱：${book.borrowDate.toLocaleDateString()}`} />
                              <Pill
                                text={isOverdue ? `逾期 ${Math.abs(daysLeft)} 天` : `${daysLeft} 天後到期`}
                                kind={isOverdue || daysLeft <= 7 ? "accent" : "default"}
                              />
                            </View>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                            已續借 {book.renewCount}/{book.maxRenew} 次
                          </Text>
                          <Button
                            text={book.renewCount >= book.maxRenew ? "無法續借" : "續借"}
                            onPress={() => handleRenewBook(book)}
                            disabled={book.renewCount >= book.maxRenew}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </AnimatedCard>

            <AnimatedCard title="借閱說明" delay={100}>
              <View style={{ gap: 8 }}>
                <ListItem icon="time-outline" title="借閱期限" subtitle="每本書可借閱 30 天" />
                <ListItem icon="refresh-outline" title="續借規則" subtitle="每本書最多可續借 2 次" />
                <ListItem icon="alert-circle-outline" title="逾期罰則" subtitle="逾期每日每本書 $5 元" />
              </View>
            </AnimatedCard>
          </>
        )}

        {tab === "seat" && (
          <>
            <AnimatedCard title="座位總覽" subtitle="即時空位狀況">
              <View style={{ alignItems: "center", paddingVertical: 12 }}>
                <ProgressRing progress={totalAvailableSeats / totalSeats} size={100} color={theme.colors.success} />
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18, marginTop: 12 }}>
                  {totalAvailableSeats} / {totalSeats}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>目前可用座位</Text>
              </View>
            </AnimatedCard>

            <AnimatedCard title="各區域座位" subtitle="點擊預約座位" delay={100}>
              <View style={{ gap: 12 }}>
                {seatAreas.map((area) => {
                  const occupancy = getOccupancyLevel(area.availableSeats, area.totalSeats);
                  const occupancyColors = {
                    low: theme.colors.success,
                    medium: "#F59E0B",
                    high: theme.colors.danger,
                  };
                  return (
                    <Pressable
                      key={area.id}
                      onPress={() => handleReserveSeat(area)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        gap: 12,
                      })}
                    >
                      <View
                        style={{
                          width: 50,
                          height: 50,
                          borderRadius: 25,
                          backgroundColor: `${occupancyColors[occupancy]}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: occupancyColors[occupancy], fontWeight: "900", fontSize: 16 }}>
                          {area.availableSeats}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{area.name}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{area.floor}</Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                          {area.hasOutlet && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="flash" size={12} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>有插座</Text>
                            </View>
                          )}
                          {area.isQuietZone && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="volume-mute" size={12} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>安靜區</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {area.availableSeats}/{area.totalSeats}
                        </Text>
                        <View
                          style={{
                            width: 60,
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: theme.colors.border,
                            marginTop: 4,
                          }}
                        >
                          <View
                            style={{
                              width: `${(area.availableSeats / area.totalSeats) * 100}%`,
                              height: "100%",
                              borderRadius: 2,
                              backgroundColor: occupancyColors[occupancy],
                            }}
                          />
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    </Pressable>
                  );
                })}
              </View>
            </AnimatedCard>

            <AnimatedCard title="預約說明" delay={200}>
              <View style={{ gap: 8 }}>
                <ListItem icon="time-outline" title="使用時間" subtitle="每次預約可使用 4 小時" />
                <ListItem icon="alert-circle-outline" title="報到規則" subtitle="請於預約後 30 分鐘內報到" />
                <ListItem icon="close-circle-outline" title="未報到處理" subtitle="連續 3 次未報到將暫停預約權限" />
              </View>
            </AnimatedCard>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
