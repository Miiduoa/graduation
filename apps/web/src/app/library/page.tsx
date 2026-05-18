'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useToast, Modal } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getCapabilities, getDemoRoleDefinition } from '@/lib/demoRole';
import { DEMO_LIBRARY_DUE_SOON_BOOK, DEMO_LIBRARY_DUE_SOON_DAYS, DEMO_STUDENTS } from '@/lib/demoData';
import { useDemoStore, renewBook, reserveBook, transferBook } from '@/lib/demoStore';

interface BorrowedBook {
  id: string;
  title: string;
  author: string;
  /** ISO date string, e.g. '2026-05-23' */
  dueDate: string;
  renewCount: number;
}

interface Zone {
  name: string;
  total: number;
  occupied: number;
  quiet: boolean;
}

/** 計算距到期剩幾天（相對今天） */
function calcDaysLeft(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400_000);
}

/** 從今天加 n 天，回傳 YYYY-MM-DD */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// 與 AI 助理 context 連動：書名與到期日為 demo 固定資料（日期動態計算）
const DEFAULT_BORROWED: BorrowedBook[] = [
  {
    id: '1',
    title: '深入淺出設計模式',
    author: 'Eric Freeman',
    dueDate: daysFromToday(7),   // 7 天後到期（提醒但不緊急）
    renewCount: 0,
  },
  {
    id: '2',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    dueDate: daysFromToday(14),  // 14 天後（充裕）
    renewCount: 1,
  },
  {
    id: '3',
    title: DEMO_LIBRARY_DUE_SOON_BOOK,   // 與 demoData.ts DEMO_LIBRARY_DUE_SOON_BOOK 統一
    author: 'Fred Brooks',
    dueDate: daysFromToday(DEMO_LIBRARY_DUE_SOON_DAYS), // 與 DEMO_LIBRARY_DUE_SOON_DAYS 統一（2 天後）
    renewCount: 2,
  },
];

const DEFAULT_ZONES: Zone[] = [
  { name: '一樓閱覽區', total: 80, occupied: 32, quiet: false },
  { name: '二樓安靜區', total: 60, occupied: 45, quiet: true },
  { name: '三樓討論室', total: 40, occupied: 28, quiet: false },
  { name: '四樓研究室', total: 30, occupied: 18, quiet: true },
];

interface CatalogBook {
  isbn: string;
  title: string;
  author: string;
  category: string;
  location: string;
  available: number;
  total: number;
}

const MOCK_CATALOG: CatalogBook[] = [
  { isbn: '9789865021641', title: '深入淺出設計模式', author: 'Eric Freeman', category: '程式設計', location: '3F-A12', available: 2, total: 4 },
  { isbn: '9780132350884', title: 'Clean Code', author: 'Robert C. Martin', category: '軟體工程', location: '3F-B05', available: 1, total: 3 },
  { isbn: '9780201835953', title: '人月神話', author: 'Fred Brooks', category: '軟體工程', location: '3F-B07', available: 0, total: 2 },
  { isbn: '9789863479642', title: '資料結構與演算法', author: '嚴蔚敏', category: '程式設計', location: '3F-A08', available: 3, total: 5 },
  { isbn: '9780596517748', title: 'JavaScript: The Good Parts', author: 'Douglas Crockford', category: '網頁開發', location: '3F-C03', available: 2, total: 3 },
  { isbn: '9780132181266', title: 'The Pragmatic Programmer', author: 'David Thomas', category: '軟體工程', location: '3F-B09', available: 1, total: 2 },
  { isbn: '9780201633610', title: 'Design Patterns', author: 'Gang of Four', category: '程式設計', location: '3F-A14', available: 0, total: 3 },
  { isbn: '9781491950296', title: 'Learning React', author: 'Alex Banks', category: '網頁開發', location: '3F-C07', available: 4, total: 4 },
  { isbn: '9780984782857', title: 'Cracking the Coding Interview', author: 'Gayle Laakmann', category: '面試準備', location: '2F-D02', available: 2, total: 6 },
  { isbn: '9781492056300', title: 'Python for Data Analysis', author: 'Wes McKinney', category: '資料科學', location: '3F-E01', available: 3, total: 4 },
  { isbn: '9780262033848', title: 'Introduction to Algorithms', author: 'Cormen', category: '演算法', location: '3F-A02', available: 1, total: 4 },
  { isbn: '9781491919569', title: 'Hands-On Machine Learning', author: 'Aurélien Géron', category: '機器學習', location: '3F-E05', available: 2, total: 3 },
  { isbn: '9789863478157', title: '計算機組織與結構', author: '唐朔飛', category: '計算機原理', location: '2F-F03', available: 5, total: 6 },
  { isbn: '9780135957059', title: 'Operating System Concepts', author: 'Silberschatz', category: '作業系統', location: '2F-F07', available: 0, total: 3 },
  { isbn: '9780132126953', title: 'Computer Networks', author: 'Andrew Tanenbaum', category: '網路', location: '2F-G04', available: 2, total: 4 },
  { isbn: '9781491909850', title: 'Learning SQL', author: 'Alan Beaulieu', category: '資料庫', location: '3F-H02', available: 3, total: 3 },
];

type Tab = 'borrow' | 'seats' | 'search';

function SearchTab({
  searchQuery,
  setSearchQuery,
  onBorrow,
  schoolQ,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onBorrow: (title: string) => void;
  schoolQ: string;
}) {
  const q = searchQuery.trim().toLowerCase();
  const results = q
    ? MOCK_CATALOG.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.isbn.includes(q) ||
          b.category.toLowerCase().includes(q),
      )
    : [];

  return (
    <div className="pageStack">
      <div style={{ position: 'relative' }}>
        <span
          style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 17,
            pointerEvents: 'none',
            opacity: 0.5,
          }}
        >
          🔍
        </span>
        <input
          className="input"
          type="search"
          placeholder="輸入書名、作者或 ISBN…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ paddingLeft: 42 }}
        />
      </div>

      {!q && (
        <div className="emptyState" style={{ background: 'var(--panel)' }}>
          <div className="emptyIcon">📖</div>
          <h3 className="emptyTitle">輸入關鍵字開始搜尋</h3>
          <p className="emptyBody">支援書名、作者、ISBN 或分類搜尋館藏資料</p>
        </div>
      )}

      {q && results.length === 0 && (
        <div className="emptyState" style={{ background: 'var(--panel)' }}>
          <div className="emptyIcon">🔍</div>
          <h3 className="emptyTitle">查無結果</h3>
          <p className="emptyBody">找不到符合「{searchQuery}」的館藏，請嘗試其他關鍵字</p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: -4 }}>
            找到 {results.length} 筆館藏
          </div>
          <div className="insetGroup">
            {results.map((book, i) => {
              const isAvailable = book.available > 0;
              return (
                <div
                  key={book.isbn}
                  className="insetGroupRow"
                  style={{ borderTop: i === 0 ? 'none' : undefined }}
                >
                  <div
                    className="insetGroupRowIcon"
                    style={{
                      background: isAvailable ? 'var(--accent-soft)' : 'var(--panel)',
                      fontSize: 20,
                    }}
                  >
                    📚
                  </div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{book.title}</div>
                    <div className="insetGroupRowMeta">
                      {book.author} · {book.category} · {book.location}
                    </div>
                    <div className="insetGroupRowMeta" style={{ marginTop: 2 }}>
                      庫存：
                      <span
                        style={{
                          color: isAvailable ? 'var(--success)' : 'var(--danger)',
                          fontWeight: 700,
                        }}
                      >
                        {book.available}/{book.total} 可借
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <Link
                      href={`/ai-assistant${schoolQ ? schoolQ + '&' : '?'}q=${encodeURIComponent(`幫我推薦類似《${book.title}》的書`)}`}
                      title="問 AI 推薦類似書籍"
                      style={{
                        padding: '6px 8px',
                        fontSize: 14,
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        textDecoration: 'none',
                        lineHeight: 1,
                      }}
                    >
                      🤖
                    </Link>
                    <button
                      type="button"
                      onClick={() => isAvailable && onBorrow(book.title)}
                      disabled={!isAvailable}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 8,
                        border: `1px solid ${isAvailable ? 'var(--brand)' : 'var(--border)'}`,
                        background: isAvailable ? 'var(--accent-soft)' : 'var(--panel)',
                        color: isAvailable ? 'var(--brand)' : 'var(--muted)',
                        cursor: isAvailable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {isAvailable ? '預約借閱' : '已借完'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function LibraryPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [activeTab, setActiveTab] = useState<Tab>('borrow');
  const [searchQuery, setSearchQuery] = useState('');
  const { success, info } = useToast();
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const roleDef = getDemoRoleDefinition(demoRole);
  const store = useDemoStore();
  // 轉讓 modal 狀態
  const [transferBookState, setTransferBookState] = useState<BorrowedBook | null>(null);
  const [transferTo, setTransferTo] = useState<string>('');
  const closeTransfer = () => { setTransferBookState(null); setTransferTo(''); };

  // 從 store 的 borrowingOverrides 合併 DEFAULT_BORROWED，讓續借後的到期日持久化
  const borrowedBooks = useMemo(() => {
    return DEFAULT_BORROWED.map((b) => {
      const override = store.borrowingOverrides[b.id];
      return override ? { ...b, dueDate: override.dueDate, renewCount: override.renewCount } : b;
    });
  }, [store.borrowingOverrides]);

  // 動態計算每本書剩幾天（不硬編碼，每次渲染都是最新）
  const booksWithDaysLeft = useMemo(
    () => borrowedBooks.map((b) => ({ ...b, daysLeft: calcDaysLeft(b.dueDate) })),
    [borrowedBooks],
  );

  const totalAvailable = DEFAULT_ZONES.reduce((sum, z) => sum + (z.total - z.occupied), 0);
  const urgentBooks = booksWithDaysLeft.filter((b) => b.daysLeft <= 3).length;

  return (
    <SiteShell title="圖書館" subtitle="借閱管理與座位資訊" schoolName={schoolName}>
      <div className="pageStack">
        {/* ── Stats ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{caps.canBorrowBooks ? borrowedBooks.length : 0}</div>
            <div className="metricLabel">借閱中</div>
          </div>
          <div
            className="metricCard"
            style={
              { '--tone': urgentBooks > 0 ? 'var(--danger)' : 'var(--success)' } as CSSProperties
            }
          >
            <div className="metricIcon">{urgentBooks > 0 ? '⚠️' : '✅'}</div>
            <div className="metricValue">{caps.canBorrowBooks ? urgentBooks : 0}</div>
            <div className="metricLabel">即將到期</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#34C759' } as CSSProperties}>
            <div className="metricIcon">🪑</div>
            <div className="metricValue">{totalAvailable}</div>
            <div className="metricLabel">可用座位</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#5856D6' } as CSSProperties}>
            <div className="metricIcon">🕐</div>
            <div className="metricValue">22:00</div>
            <div className="metricLabel">今日關閉</div>
          </div>
        </div>

        {/* ── AI 圖書館提醒（學生：有緊急書到期） ── */}
        {caps.canBorrowBooks && urgentBooks > 0 && borrowedBooks.length > 0 && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(255,59,48,0.08) 0%, rgba(255,149,0,0.06) 100%)',
              border: '1px solid rgba(255,59,48,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 3 }}>
                🤖 AI 提醒 · 圖書館
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                《人月神話》還有 <strong>{urgentBooks > 0 ? booksWithDaysLeft.find((b) => b.daysLeft <= 3)?.daysLeft : '?'} 天</strong>到期！
                點「我的借閱」可直接續借（不需回圖書館）。
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('我圖書館有書快到期了，幫我確認一下，有沒有需要續借的？')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="segmentedGroup">
          {(
            [
              { key: 'borrow', label: '📚 我的借閱' },
              { key: 'seats', label: '🪑 座位查詢' },
              { key: 'search', label: '🔍 書目搜尋' },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              className={activeTab === t.key ? 'active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Borrow Tab：無借書權（訪客 / 校友）── */}
        {activeTab === 'borrow' && !caps.canBorrowBooks && (
          <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
            {demoRole === 'guest' ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>需要登入才能借閱</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>訪客身份無法借閱書籍。請登入後使用完整圖書館服務。</div>
                <a href={`/login${q}`} className="btn primary">前往登入 →</a>
              </>
            ) : (
              // alumni（canBorrowBooks: false）
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎓</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>校友借閱權限已停用</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>張學長（B09203001）於畢業後圖書館借閱資格停用。如需資料，請洽圖書館服務台辦理校友借閱申請。</div>
              </>
            )}
          </div>
        )}
        {/* ── Borrow Tab：有借書權（student / teacher / ta / club_officer / dept_head / admin）── */}
        {activeTab === 'borrow' && caps.canBorrowBooks && (
          <div className="pageStack">
            {/* 非學生角色：提示這是示範學生的借閱視角 */}
            {demoRole !== 'student' && (
              <div className="card" style={{ padding: '12px 16px', background: 'rgba(88,86,214,0.08)', border: '1px solid rgba(88,86,214,0.25)', fontSize: 13 }}>
                📋 <strong>{roleDef.label}視角</strong> · 以下顯示示範學生（王小明）的借閱紀錄，正式版將連結個人圖書館帳號。
                <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我推薦一份適合教學參考的書單')}`} style={{ marginLeft: 10, color: 'var(--brand)' }}>
                  問 AI 推薦書單 →
                </Link>
              </div>
            )}
            {urgentBooks > 0 && (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--danger-soft)',
                  border: '1px solid rgba(255,59,48,0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  color: 'var(--danger)',
                  fontWeight: 600,
                }}
              >
                ⚠️ 您有 {urgentBooks} 本書籍即將到期（3 天內），請盡快歸還或續借
              </div>
            )}
            <div className="insetGroup">
              {booksWithDaysLeft.map((book, i) => {
                const isUrgent = book.daysLeft <= 3;
                const isExpiring = book.daysLeft <= 7;
                return (
                  <div
                    key={book.id}
                    className="insetGroupRow"
                    style={{ borderTop: i === 0 ? 'none' : undefined }}
                  >
                    <div
                      className="insetGroupRowIcon"
                      style={{
                        background: isUrgent
                          ? 'var(--danger-soft)'
                          : isExpiring
                            ? 'var(--warning-soft)'
                            : 'var(--accent-soft)',
                        fontSize: 20,
                      }}
                    >
                      📖
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{book.title}</div>
                      <div className="insetGroupRowMeta">
                        {book.author} · 到期：{book.dueDate} · 已續借 {book.renewCount} 次
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: isUrgent
                            ? 'var(--danger)'
                            : isExpiring
                              ? 'var(--warning)'
                              : 'var(--success)',
                          letterSpacing: '-0.03em',
                        }}
                      >
                        {book.daysLeft} 天
                      </div>
                      {book.renewCount < 3 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => {
                            // 寫入 demoStore → AI 開場白不再提醒這本書到期
                            renewBook(book.id, book.dueDate, book.renewCount);
                            success(`✅ 已續借「${book.title}」，到期日延長 14 天`);
                          }}
                          disabled={book.renewCount >= 3}
                          style={{
                            fontSize: 11,
                            color: 'var(--brand)',
                            fontWeight: 600,
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            marginTop: 2,
                          }}
                        >
                          續借 +14 天
                        </button>
                        {caps.canBorrowBooks ? (
                          <button
                            type="button"
                            onClick={() => setTransferBookState(book)}
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              fontWeight: 600,
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              textDecoration: 'underline',
                            }}
                          >
                            轉讓 →
                          </button>
                        ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Seats Tab ── */}
        {activeTab === 'seats' && (
          <div className="pageStack">
            <div className="grid-2">
              {DEFAULT_ZONES.map((zone) => {
                const pct = (zone.occupied / zone.total) * 100;
                const avail = zone.total - zone.occupied;
                const color =
                  pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)';
                return (
                  <div key={zone.name} className="card">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{zone.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {zone.quiet ? '🔇 安靜區域' : '💬 可交談'}
                        </div>
                      </div>
                      <span
                        className="pill"
                        style={{
                          background: `${color.includes('success') ? 'var(--success-soft)' : color.includes('warning') ? 'var(--warning-soft)' : 'var(--danger-soft)'}`,
                          color,
                          border: 'none',
                          boxShadow: 'none',
                          fontSize: 11,
                        }}
                      >
                        {avail} 席
                      </span>
                    </div>
                    <div className="progressMeta">
                      <span style={{ fontSize: 12 }}>
                        {zone.occupied}/{zone.total} 已使用
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color }}>
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="progressTrack">
                      <div
                        className="progressFill"
                        style={
                          {
                            '--progress-width': `${pct}%`,
                            '--progress': `linear-gradient(90deg, ${color}, ${color})`,
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Search Tab ── */}
        {activeTab === 'search' && (
          <SearchTab
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            schoolQ={q}
            onBorrow={(title) => {
              if (!caps.canBorrowBooks) {
                info(
                  demoRole === 'alumni'
                    ? '校友身份僅可瀏覽，無法借閱書籍'
                    : demoRole === 'guest'
                      ? '請先登入後才能借閱'
                      : '你的身份無法執行此動作',
                );
                return;
              }
              // 寫入 demoStore.reserveBook，並通知使用者
              reserveBook({
                bookId: `cat-${Date.now()}`,
                bookTitle: title,
                studentId: roleDef.demoUserUid || 'stu-001',
                studentName: roleDef.label,
              });
              success(`✅ 已預約「${title}」，可在「訊息」收到預約確認，並至 1F 服務台取書`);
            }}
          />
        )}
      </div>

      {/* 轉讓 Modal */}
      <Modal
        isOpen={transferBookState !== null}
        onClose={closeTransfer}
        title={`轉讓「${transferBookState?.title ?? ''}」`}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={closeTransfer}>取消</button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (!transferBookState || !transferTo) {
                  info('請選擇受讓人');
                  return;
                }
                const recipient = DEMO_STUDENTS.find((s) => s.uid === transferTo);
                transferBook({
                  bookId: transferBookState.id,
                  bookTitle: transferBookState.title,
                  fromStudentName: roleDef.label,
                  toStudentName: recipient?.displayName ?? transferTo,
                });
                success(`✅ 已轉讓給 ${recipient?.displayName ?? transferTo}`);
                closeTransfer();
              }}
            >
              確認轉讓
            </button>
          </>
        }
      >
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 8 }}>
            選擇要把《{transferBookState?.title}》轉讓給哪位同學：
          </div>
          <select
            className="input"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">— 選擇同學 —</option>
            {DEMO_STUDENTS.filter((s) => s.uid !== 'stu-001').map((s) => (
              <option key={s.uid} value={s.uid}>
                {s.displayName}（{s.studentId}）
              </option>
            ))}
          </select>
          <div style={{ marginTop: 12, padding: 10, background: 'var(--panel)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
            ℹ️ 轉讓後到期日不變，續借次數累計給新借閱人。受讓人會收到通知。
          </div>
        </div>
      </Modal>
    </SiteShell>
  );
}
