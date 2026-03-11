"use client";

import { useState, useEffect, useCallback } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useAuth } from "@/components/AuthGuard";
import { 
  searchBooks, 
  fetchLibraryLoans,
  isFirebaseConfigured 
} from "@/lib/firebase";

type BorrowedBook = {
  id: string;
  title: string;
  author: string;
  dueDate: string;
  daysLeft: number;
  coverUrl: string | null;
  renewCount: number;
};

type PopularBook = {
  id: string;
  title: string;
  author: string;
  available: number;
  total: number;
};

type Zone = {
  name: string;
  total: number;
  occupied: number;
  quiet: boolean;
};

const DEFAULT_BORROWED: BorrowedBook[] = [
  { id: "1", title: "深入淺出設計模式", author: "Eric Freeman", dueDate: "2026-03-15", daysLeft: 14, coverUrl: null, renewCount: 0 },
  { id: "2", title: "Clean Code", author: "Robert C. Martin", dueDate: "2026-03-08", daysLeft: 7, coverUrl: null, renewCount: 1 },
  { id: "3", title: "資料結構與演算法", author: "張三", dueDate: "2026-03-01", daysLeft: 0, coverUrl: null, renewCount: 2 },
];

const DEFAULT_POPULAR: PopularBook[] = [
  { id: "1", title: "原子習慣", author: "James Clear", available: 3, total: 10 },
  { id: "2", title: "刻意練習", author: "Anders Ericsson", available: 0, total: 5 },
  { id: "3", title: "Python 程式設計", author: "李四", available: 12, total: 15 },
  { id: "4", title: "機器學習入門", author: "王五", available: 2, total: 8 },
];

const DEFAULT_ZONES: Zone[] = [
  { name: "自習區 A", total: 50, occupied: 32, quiet: true },
  { name: "自習區 B", total: 40, occupied: 25, quiet: true },
  { name: "討論室區", total: 20, occupied: 8, quiet: false },
  { name: "電腦區", total: 30, occupied: 28, quiet: false },
];

function calculateDaysLeft(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function LibraryPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });
  
  const { user, loading: authLoading } = useAuth();

  const [borrowedBooks, setBorrowedBooks] = useState<BorrowedBook[]>(DEFAULT_BORROWED);
  const [popularBooks, setPopularBooks] = useState<PopularBook[]>(DEFAULT_POPULAR);
  const [zones] = useState<Zone[]>(DEFAULT_ZONES);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PopularBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [totalBorrowed, setTotalBorrowed] = useState(3);
  const [soonDue, setSoonDue] = useState(1);
  const [reserved] = useState(2);
  const [historyCount] = useState(47);

  const loadData = useCallback(async () => {
    if (!user || !isFirebaseConfigured()) {
      setBorrowedBooks(DEFAULT_BORROWED);
      setPopularBooks(DEFAULT_POPULAR);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const loans = await fetchLibraryLoans(user.uid);
      
      if (loans.length > 0) {
        const converted: BorrowedBook[] = loans.map((loan) => ({
          id: loan.id,
          title: loan.bookTitle ?? `書籍 ${loan.bookId}`,
          author: loan.bookAuthor ?? "未知作者",
          dueDate: loan.dueAt,
          daysLeft: calculateDaysLeft(loan.dueAt),
          coverUrl: null,
          renewCount: loan.renewCount,
        }));
        setBorrowedBooks(converted);
        setTotalBorrowed(converted.length);
        setSoonDue(converted.filter(b => b.daysLeft <= 7 && b.daysLeft > 0).length);
      } else {
        setBorrowedBooks(DEFAULT_BORROWED);
      }
    } catch (error) {
      console.error("Failed to load library data:", error);
      setBorrowedBooks(DEFAULT_BORROWED);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [loadData, authLoading]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const books = await searchBooks(school.id, searchQuery);
      if (books.length > 0) {
        const converted: PopularBook[] = books.map((b) => ({
          id: b.id,
          title: b.title,
          author: b.author,
          available: b.available,
          total: b.total,
        }));
        setSearchResults(converted);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, school.id]);

  const handleRenew = (bookId: string) => {
    setBorrowedBooks(prev => 
      prev.map(b => 
        b.id === bookId && b.renewCount < 2
          ? { ...b, renewCount: b.renewCount + 1, daysLeft: b.daysLeft + 14 }
          : b
      )
    );
    alert("續借成功！還書日期已延長 14 天。");
  };

  if (loading || authLoading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="📚 圖書館"
        subtitle="借閱查詢 · 館藏搜尋 · 座位預約"
      >
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--muted)" }}>載入圖書館資料中...</div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="📚 圖書館"
      subtitle="借閱查詢 · 館藏搜尋 · 座位預約"
    >
      {/* Stats Row */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", 
        gap: 16, 
        marginBottom: 24 
      }}>
        {[
          { label: "借閱中", value: totalBorrowed.toString(), icon: "📖", color: "#8B5CF6" },
          { label: "即將到期", value: soonDue.toString(), icon: "⏰", color: "#F59E0B" },
          { label: "預約中", value: reserved.toString(), icon: "📋", color: "#10B981" },
          { label: "歷史借閱", value: historyCount.toString(), icon: "📚", color: "#3B82F6" },
        ].map((stat) => (
          <div 
            key={stat.label} 
            className="card"
            style={{ padding: 16, textAlign: "center" }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{stat.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Search Bar */}
      <div className="card" style={{ marginBottom: 24, padding: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            type="text"
            placeholder="搜尋書名、作者、ISBN..."
            className="input"
            style={{ flex: 1 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button className="btn primary" onClick={handleSearch} disabled={searching}>
            {searching ? "⏳" : "搜尋"}
          </button>
        </div>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between",
            marginBottom: 16,
          }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🔍 搜尋結果</h2>
            <button className="btn" onClick={() => setSearchResults([])}>清除</button>
          </div>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
            gap: 12 
          }}>
            {searchResults.map((book) => (
              <div 
                key={book.id}
                style={{
                  padding: 16,
                  background: "var(--panel2)",
                  borderRadius: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{book.title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                  {book.author}
                </div>
                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "space-between" 
                }}>
                  <span 
                    className="pill"
                    style={{ 
                      background: book.available > 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
                      color: book.available > 0 ? "#10B981" : "#EF4444",
                    }}
                  >
                    {book.available > 0 ? `可借 ${book.available}/${book.total}` : "已借出"}
                  </span>
                  <button 
                    className="btn"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                  >
                    {book.available > 0 ? "借閱" : "預約"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Borrowed Books */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📖 我的借閱</h2>
          <span className="pill">{borrowedBooks.length} 本</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {borrowedBooks.map((book) => (
            <div 
              key={book.id}
              style={{
                padding: 16,
                background: "var(--panel2)",
                borderRadius: 12,
                display: "flex",
                gap: 16,
                alignItems: "center",
              }}
            >
              <div style={{
                width: 60,
                height: 80,
                background: "var(--border)",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}>
                📘
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{book.title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
                  {book.author}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span 
                    className="pill"
                    style={{ 
                      background: book.daysLeft <= 0 
                        ? "rgba(239,68,68,0.2)" 
                        : book.daysLeft <= 7 
                        ? "rgba(245,158,11,0.2)" 
                        : "rgba(16,185,129,0.2)",
                      color: book.daysLeft <= 0 
                        ? "#EF4444" 
                        : book.daysLeft <= 7 
                        ? "#F59E0B" 
                        : "#10B981",
                    }}
                  >
                    {book.daysLeft <= 0 ? "已逾期" : `${book.daysLeft} 天後到期`}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    已續借 {book.renewCount}/2 次
                  </span>
                </div>
              </div>

              <button 
                className="btn"
                disabled={book.renewCount >= 2}
                onClick={() => handleRenew(book.id)}
              >
                {book.renewCount >= 2 ? "無法續借" : "續借"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Seat Availability */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>💺 座位狀態</h2>
          <button className="btn primary" style={{ fontSize: 13 }}>預約座位</button>
        </div>

        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", 
          gap: 12 
        }}>
          {zones.map((zone) => {
            const percentage = Math.round((zone.occupied / zone.total) * 100);
            const isFull = percentage >= 90;
            
            return (
              <div 
                key={zone.name}
                style={{
                  padding: 16,
                  background: "var(--panel2)",
                  borderRadius: 12,
                }}
              >
                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}>
                  <span style={{ fontWeight: 600 }}>{zone.name}</span>
                  {zone.quiet && (
                    <span style={{ fontSize: 12 }}>🤫</span>
                  )}
                </div>
                
                <div style={{
                  height: 6,
                  background: "var(--border)",
                  borderRadius: 3,
                  marginBottom: 8,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${percentage}%`,
                    background: isFull ? "#EF4444" : percentage >= 70 ? "#F59E0B" : "#10B981",
                    borderRadius: 3,
                  }} />
                </div>
                
                <div style={{ 
                  fontSize: 12, 
                  color: "var(--muted)",
                  display: "flex",
                  justifyContent: "space-between",
                }}>
                  <span>已使用 {zone.occupied}/{zone.total}</span>
                  <span style={{ 
                    color: isFull ? "#EF4444" : undefined,
                    fontWeight: isFull ? 600 : undefined,
                  }}>
                    {isFull ? "已滿" : `剩餘 ${zone.total - zone.occupied}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Popular Books */}
      <div className="card">
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>🔥 熱門書籍</h2>
        
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
          gap: 12 
        }}>
          {popularBooks.map((book) => (
            <div 
              key={book.id}
              style={{
                padding: 16,
                background: "var(--panel2)",
                borderRadius: 12,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{book.title}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                {book.author}
              </div>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between" 
              }}>
                <span 
                  className="pill"
                  style={{ 
                    background: book.available > 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
                    color: book.available > 0 ? "#10B981" : "#EF4444",
                  }}
                >
                  {book.available > 0 ? `可借 ${book.available}` : "已借出"}
                </span>
                <button 
                  className="btn"
                  style={{ fontSize: 12, padding: "6px 12px" }}
                >
                  {book.available > 0 ? "借閱" : "預約"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteShell>
  );
}
