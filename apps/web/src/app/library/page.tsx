"use client";

import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { SiteShell } from "@/components/SiteShell";
import { useAuth } from "@/components/AuthGuard";
import { useToast } from "@/components/ui";
import {
  borrowLibraryBook,
  cancelLibrarySeatReservation,
  fetchLibraryLoans,
  fetchLibrarySeats,
  fetchSeatReservations,
  isFirebaseConfigured,
  renewLibraryLoan,
  reserveLibrarySeat,
  returnLibraryBook,
  searchBooks,
  type LibraryBook,
  type LibraryLoan,
  type LibrarySeat,
  type SeatReservation,
} from "@/lib/firebase";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import {
  buildSeatZoneSummaries,
  DEMO_LIBRARY_BOOKS,
  DEMO_LIBRARY_LOANS,
  DEMO_LIBRARY_SEATS,
  DEMO_SEAT_RESERVATIONS,
  filterLibraryBooks,
  formatLocalDateInput,
  getDaysUntilDue,
  getEffectiveSeatStatus,
  getLoanDueAt,
  isLoanActive,
  LIBRARY_TIME_SLOTS,
  normalizeLibraryLoanStatus,
  sortLibraryLoans,
  type LibraryTab,
} from "./libraryModel";

const DEFAULT_LIBRARY_SLOT =
  LIBRARY_TIME_SLOTS[1] ??
  LIBRARY_TIME_SLOTS[0] ?? {
    id: "afternoon",
    label: "下午 13:00-17:00",
    startTime: "13:00",
    endTime: "17:00",
  };

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function formatDueDate(value?: string | null): string {
  if (!value) return "未提供到期日";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function formatRefreshTime(value: Date | null): string {
  if (!value) return "尚未同步";

  return value.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionButtonStyle(kind: "primary" | "secondary" | "danger"): CSSProperties {
  if (kind === "primary") {
    return { padding: "7px 12px", fontSize: 12 };
  }

  if (kind === "danger") {
    return {
      padding: "7px 12px",
      fontSize: 12,
      color: "var(--danger)",
      borderColor: "rgba(255,59,48,0.24)",
      background: "var(--danger-soft)",
    };
  }

  return {
    padding: "7px 12px",
    fontSize: 12,
    background: "var(--panel)",
  };
}

function metricTone(daysLeft: number | null): { color: string; background: string; label: string } {
  if (daysLeft == null) {
    return {
      color: "var(--muted)",
      background: "var(--panel)",
      label: "未提供到期日",
    };
  }

  if (daysLeft < 0) {
    return {
      color: "var(--danger)",
      background: "var(--danger-soft)",
      label: `已逾期 ${Math.abs(daysLeft)} 天`,
    };
  }

  if (daysLeft <= 3) {
    return {
      color: "var(--danger)",
      background: "var(--danger-soft)",
      label: `${daysLeft} 天內到期`,
    };
  }

  if (daysLeft <= 7) {
    return {
      color: "var(--warning)",
      background: "var(--warning-soft)",
      label: `${daysLeft} 天後到期`,
    };
  }

  return {
    color: "var(--success)",
    background: "var(--success-soft)",
    label: `尚有 ${daysLeft} 天`,
  };
}

export default function LibraryPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolId, schoolName, schoolSearch } = resolveSchoolPageContext(props.searchParams);
  const { user, loading: authLoading } = useAuth();
  const { success, error, info, warning } = useToast();

  const firebaseEnabled = isFirebaseConfigured();
  const previewMode = !firebaseEnabled || !user;

  const [activeTab, setActiveTab] = useState<LibraryTab>("borrow");
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [seats, setSeats] = useState<LibrarySeat[]>([]);
  const [reservations, setReservations] = useState<SeatReservation[]>([]);
  const [catalog, setCatalog] = useState<LibraryBook[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => formatLocalDateInput());
  const [selectedSlotId, setSelectedSlotId] = useState(DEFAULT_LIBRARY_SLOT.id);
  const [quietOnly, setQuietOnly] = useState(false);
  const [outletOnly, setOutletOnly] = useState(false);

  const selectedSlot =
    LIBRARY_TIME_SLOTS.find((slot) => slot.id === selectedSlotId) ?? DEFAULT_LIBRARY_SLOT;

  const refreshDashboard = useCallback(async () => {
    if (!firebaseEnabled || !user) {
      setLoans([]);
      setSeats([]);
      setReservations([]);
      setDataError(null);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    setDataError(null);

    try {
      const [nextLoans, nextSeats, nextReservations] = await Promise.all([
        fetchLibraryLoans(user.uid, schoolId),
        fetchLibrarySeats(schoolId),
        fetchSeatReservations(user.uid, schoolId),
      ]);

      setLoans(sortLibraryLoans(nextLoans));
      setSeats(nextSeats);
      setReservations(nextReservations.filter((reservation) => reservation.status === "active"));
      setLastSyncedAt(new Date());
    } catch (caughtError) {
      setDataError(getErrorMessage(caughtError, "圖書館資料同步失敗"));
    } finally {
      setDataLoading(false);
    }
  }, [firebaseEnabled, schoolId, user]);

  const refreshCatalog = useCallback(async () => {
    if (!firebaseEnabled || !user) {
      setCatalog([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const nextCatalog = await searchBooks(schoolId, deferredSearchQuery.trim(), 24);
      setCatalog(nextCatalog);
    } catch (caughtError) {
      setSearchError(getErrorMessage(caughtError, "館藏搜尋失敗"));
    } finally {
      setSearchLoading(false);
    }
  }, [deferredSearchQuery, firebaseEnabled, schoolId, user]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const currentLoans = previewMode ? DEMO_LIBRARY_LOANS : loans;
  const currentSeats = previewMode ? DEMO_LIBRARY_SEATS : seats;
  const currentReservations = previewMode ? DEMO_SEAT_RESERVATIONS : reservations;
  const visibleBooks = useMemo(() => {
    const sourceBooks = previewMode ? DEMO_LIBRARY_BOOKS : catalog;
    return filterLibraryBooks(sourceBooks, searchQuery, onlyAvailable);
  }, [catalog, onlyAvailable, previewMode, searchQuery]);

  const activeLoans = useMemo(
    () => sortLibraryLoans(currentLoans.filter(isLoanActive)),
    [currentLoans]
  );
  const urgentLoans = useMemo(
    () => activeLoans.filter((loan) => (getDaysUntilDue(loan) ?? 999) <= 3),
    [activeLoans]
  );
  const zoneSummaries = useMemo(
    () => buildSeatZoneSummaries(currentSeats, currentReservations, selectedDate, selectedSlot),
    [currentReservations, currentSeats, selectedDate, selectedSlot]
  );
  const totalAvailableSeats = useMemo(
    () => zoneSummaries.reduce((sum, zone) => sum + zone.available, 0),
    [zoneSummaries]
  );
  const reservationsForSelection = useMemo(
    () =>
      currentReservations.filter((reservation) => {
        if (reservation.date !== selectedDate || reservation.status !== "active") {
          return false;
        }

        const reservationStart = reservation.startTime;
        const reservationEnd = reservation.endTime;
        return reservationStart < selectedSlot.endTime && reservationEnd > selectedSlot.startTime;
      }),
    [currentReservations, selectedDate, selectedSlot]
  );
  const reservationsToday = useMemo(
    () =>
      currentReservations.filter(
        (reservation) => reservation.date === selectedDate && reservation.status === "active"
      ),
    [currentReservations, selectedDate]
  );

  const seatRows = useMemo(() => {
    const seatState = currentSeats
      .filter((seat) => (!quietOnly || seat.isQuietZone) && (!outletOnly || seat.hasOutlet))
      .map((seat) => ({
        seat,
        effectiveStatus: getEffectiveSeatStatus(seat, currentReservations, selectedDate, selectedSlot),
      }))
      .sort((left, right) =>
        `${left.seat.zone}-${left.seat.seatNumber}`.localeCompare(
          `${right.seat.zone}-${right.seat.seatNumber}`,
          "zh-TW"
        )
      );

    const groups = new Map<string, typeof seatState>();
    for (const row of seatState) {
      const rows = groups.get(row.seat.zone) ?? [];
      rows.push(row);
      groups.set(row.seat.zone, rows);
    }

    return [...groups.entries()];
  }, [currentReservations, currentSeats, outletOnly, quietOnly, selectedDate, selectedSlot]);

  const runAction = useCallback(
    async (
      actionKey: string,
      work: () => Promise<void>,
      message: { title: string; body?: string; switchTo?: LibraryTab }
    ) => {
      if (!firebaseEnabled || !user) {
        warning("請先登入後再操作", "登入後才能借閱與預約座位");
        return;
      }

      setPendingAction(actionKey);
      try {
        await work();
        success(message.title, message.body);
        if (message.switchTo) {
          setActiveTab(message.switchTo);
        }
        await Promise.all([refreshDashboard(), refreshCatalog()]);
      } catch (caughtError) {
        error("操作失敗", getErrorMessage(caughtError, "請稍後再試"));
      } finally {
        setPendingAction(null);
      }
    },
    [error, firebaseEnabled, refreshCatalog, refreshDashboard, success, user, warning]
  );

  const subtitle = previewMode
    ? "借閱、館藏與座位預約預覽"
    : "借閱管理、館藏搜尋與座位預約";

  return (
    <SiteShell title="圖書館" subtitle={subtitle} schoolName={schoolName}>
      <div className="pageStack">
        {(previewMode || dataError) && (
          <div
            className="card"
            style={{
              padding: "16px 18px",
              background: dataError ? "var(--danger-soft)" : "var(--warning-soft)",
              borderColor: dataError ? "rgba(255,59,48,0.2)" : "rgba(255,149,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <strong style={{ fontSize: 14 }}>
                  {dataError
                    ? "圖書館資料同步失敗"
                    : firebaseEnabled
                      ? authLoading
                        ? "正在檢查登入狀態"
                        : "目前顯示示範預覽"
                      : "Firebase 尚未設定"}
                </strong>
                <span style={{ fontSize: 13, color: "var(--text)" }}>
                  {dataError
                    ? dataError
                    : firebaseEnabled
                      ? "登入後會自動載入你的借閱紀錄、館藏與座位預約資料。"
                      : "設定 NEXT_PUBLIC_FIREBASE_* 後，這頁會切換為真實資料模式。"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {dataError ? (
                  <button
                    className="btn"
                    onClick={() => void refreshDashboard()}
                    style={actionButtonStyle("secondary")}
                  >
                    重新同步
                  </button>
                ) : firebaseEnabled ? (
                  <Link href={`/login${schoolSearch}`} className="btn primary" style={actionButtonStyle("primary")}>
                    前往登入
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{activeLoans.length}</div>
            <div className="metricLabel">借閱中</div>
          </div>
          <div
            className="metricCard"
            style={{ "--tone": urgentLoans.length > 0 ? "var(--danger)" : "var(--success)" } as CSSProperties}
          >
            <div className="metricIcon">{urgentLoans.length > 0 ? "⚠️" : "✅"}</div>
            <div className="metricValue">{urgentLoans.length}</div>
            <div className="metricLabel">3 天內到期</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--success)" } as CSSProperties}>
            <div className="metricIcon">🪑</div>
            <div className="metricValue">{totalAvailableSeats}</div>
            <div className="metricLabel">{selectedSlot.label} 可用</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--info)" } as CSSProperties}>
            <div className="metricIcon">🗂️</div>
            <div className="metricValue">{currentReservations.length}</div>
            <div className="metricLabel">我的預約</div>
          </div>
        </div>

        <div
          className="toolbarPanel"
          style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}
        >
          <div className="segmentedGroup">
            {[
              { key: "borrow", label: "📚 我的借閱" },
              { key: "seats", label: "🪑 座位預約" },
              { key: "search", label: "🔍 館藏搜尋" },
            ].map((tab) => (
              <button
                key={tab.key}
                className={activeTab === tab.key ? "active" : ""}
                onClick={() => setActiveTab(tab.key as LibraryTab)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {dataLoading ? "同步中..." : `上次同步 ${formatRefreshTime(lastSyncedAt)}`}
            </span>
            <button
              className="btn"
              onClick={() => void refreshDashboard()}
              style={actionButtonStyle("secondary")}
              disabled={dataLoading}
            >
              重新同步
            </button>
          </div>
        </div>

        {activeTab === "borrow" && (
          <div className="pageStack">
            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>借閱狀態總覽</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                    借閱上限 10 本，單本最多續借 2 次。逾期前先續借，可避免紀錄中斷。
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="pill subtle" style={{ fontSize: 11 }}>
                    借閱中 {activeLoans.length}
                  </span>
                  <span className="pill" style={{ fontSize: 11, background: "var(--warning-soft)", color: "var(--warning)", border: "none" }}>
                    緊急 {urgentLoans.length}
                  </span>
                </div>
              </div>
            </div>

            {activeLoans.length > 0 ? (
              <div className="insetGroup">
                {activeLoans.map((loan, index) => {
                  const normalizedStatus = normalizeLibraryLoanStatus(loan.status);
                  const daysLeft = getDaysUntilDue(loan);
                  const tone = metricTone(daysLeft);
                  const canRenew = normalizedStatus !== "overdue" && loan.renewCount < 2;
                  const pendingRenew = pendingAction === `renew:${loan.id}`;
                  const pendingReturn = pendingAction === `return:${loan.id}`;

                  return (
                    <div
                      key={loan.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? "none" : undefined, alignItems: "flex-start" }}
                    >
                      <div
                        className="insetGroupRowIcon"
                        style={{ background: tone.background, color: tone.color, fontSize: 19 }}
                      >
                        {normalizedStatus === "overdue" ? "⏰" : "📖"}
                      </div>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{loan.bookTitle ?? loan.book?.title ?? "未命名書籍"}</div>
                        <div className="insetGroupRowMeta">
                          {(loan.bookAuthor ?? loan.book?.author ?? "作者未提供")}
                          {" · "}
                          到期 {formatDueDate(getLoanDueAt(loan))}
                          {" · "}
                          已續借 {loan.renewCount} / 2 次
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <span
                            className="pill"
                            style={{
                              fontSize: 11,
                              background: tone.background,
                              color: tone.color,
                              border: "none",
                              boxShadow: "none",
                            }}
                          >
                            {tone.label}
                          </span>
                          {normalizedStatus === "overdue" && (
                            <span className="pill" style={{ fontSize: 11, background: "var(--danger-soft)", color: "var(--danger)", border: "none" }}>
                              請先處理逾期再借新書
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                        <button
                          className="btn"
                          disabled={!canRenew || previewMode || pendingRenew || pendingReturn}
                          style={actionButtonStyle("secondary")}
                          onClick={() =>
                            void runAction(
                              `renew:${loan.id}`,
                              async () => {
                                await renewLibraryLoan({ schoolId, loanId: loan.id });
                              },
                              {
                                title: "已送出續借",
                                body: `${loan.bookTitle ?? "書籍"} 的到期日已更新`,
                              }
                            )
                          }
                        >
                          {pendingRenew ? "續借中..." : canRenew ? "續借" : "無法續借"}
                        </button>
                        <button
                          className="btn"
                          disabled={previewMode || pendingRenew || pendingReturn}
                          style={actionButtonStyle("danger")}
                          onClick={() =>
                            void runAction(
                              `return:${loan.id}`,
                              async () => {
                                await returnLibraryBook({ schoolId, loanId: loan.id });
                              },
                              {
                                title: "已送出歸還",
                                body: `${loan.bookTitle ?? "書籍"} 已標記為歸還`,
                              }
                            )
                          }
                        >
                          {pendingReturn ? "處理中..." : "歸還"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="emptyState">
                <div className="emptyIcon">📚</div>
                <h3 className="emptyTitle">目前沒有借閱中的書籍</h3>
                <p className="emptyBody">從館藏搜尋頁直接借閱後，這裡會顯示即時狀態。</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "seats" && (
          <div className="pageStack">
            <div className="toolbarPanel" style={{ gap: 10, alignItems: "stretch" }}>
              <div className="toolbarGrow" style={{ minWidth: 180 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>預約日期</div>
                <input
                  className="input"
                  type="date"
                  value={selectedDate}
                  min={formatLocalDateInput()}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </div>
              <div className="toolbarGrow">
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>時段</div>
                <div className="segmentedGroup" style={{ flexWrap: "wrap" }}>
                  {LIBRARY_TIME_SLOTS.map((slot) => (
                    <button
                      key={slot.id}
                      className={selectedSlotId === slot.id ? "active" : ""}
                      onClick={() => setSelectedSlotId(slot.id)}
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {reservationsForSelection.length > 0 && (
              <div className="card" style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>本時段已有預約</div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                      你在 {selectedDate} 的 {selectedSlot.label} 已預約 {reservationsForSelection.length} 席。
                    </div>
                  </div>
                  <span className="pill subtle" style={{ fontSize: 11 }}>
                    每日上限 2 席
                  </span>
                </div>
                <div className="insetGroup" style={{ marginTop: 14 }}>
                  {reservationsForSelection.map((reservation, index) => {
                    const seat = currentSeats.find((item) => item.id === reservation.seatId);
                    const pendingCancel = pendingAction === `cancel:${reservation.id}`;

                    return (
                      <div
                        key={reservation.id}
                        className="insetGroupRow"
                        style={{ borderTop: index === 0 ? "none" : undefined }}
                      >
                        <div className="insetGroupRowIcon" style={{ background: "var(--info-soft)", color: "var(--info)" }}>
                          🪑
                        </div>
                        <div className="insetGroupRowContent">
                          <div className="insetGroupRowTitle">
                            {seat?.zone ?? "圖書館座位"} · {seat?.seatNumber ?? reservation.seatId}
                          </div>
                          <div className="insetGroupRowMeta">
                            {reservation.startTime} - {reservation.endTime}
                            {seat?.floor ? ` · ${seat.floor}` : ""}
                          </div>
                        </div>
                        <button
                          className="btn"
                          disabled={previewMode || pendingCancel}
                          style={actionButtonStyle("danger")}
                          onClick={() =>
                            void runAction(
                              `cancel:${reservation.id}`,
                              async () => {
                                await cancelLibrarySeatReservation({
                                  schoolId,
                                  reservationId: reservation.id,
                                });
                              },
                              {
                                title: "已取消預約",
                                body: `${seat?.zone ?? "該座位"} 已釋出`,
                              }
                            )
                          }
                        >
                          {pendingCancel ? "取消中..." : "取消"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="metricGrid">
              {zoneSummaries.map((zone) => {
                const occupancy = zone.total === 0 ? 0 : Math.round(((zone.occupied + zone.reserved) / zone.total) * 100);
                const tone =
                  occupancy >= 85
                    ? "var(--danger)"
                    : occupancy >= 60
                      ? "var(--warning)"
                      : "var(--success)";

                return (
                  <div key={zone.zone} className="card" style={{ padding: "18px 18px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{zone.zone}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                          安靜座位 {zone.quietSeats} · 插座 {zone.outletSeats}
                        </div>
                      </div>
                      <span className="pill" style={{ background: "var(--panel)", fontSize: 11 }}>
                        {zone.total} 席
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      <span className="pill" style={{ background: "var(--success-soft)", color: "var(--success)", border: "none", fontSize: 11 }}>
                        可用 {zone.available}
                      </span>
                      <span className="pill" style={{ background: "var(--warning-soft)", color: "var(--warning)", border: "none", fontSize: 11 }}>
                        保留 {zone.reserved}
                      </span>
                      <span className="pill" style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 11 }}>
                        使用中 {zone.occupied}
                      </span>
                    </div>
                    <div className="progressTrack" style={{ marginTop: 14 }}>
                      <div
                        className="progressFill"
                        style={
                          {
                            "--progress-width": `${occupancy}%`,
                            "--progress": `linear-gradient(90deg, ${tone}, ${tone})`,
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="toolbarPanel" style={{ gap: 10 }}>
              <button
                className={`btn${quietOnly ? " primary" : ""}`}
                onClick={() => setQuietOnly((value) => !value)}
                style={actionButtonStyle(quietOnly ? "primary" : "secondary")}
              >
                只看安靜區
              </button>
              <button
                className={`btn${outletOnly ? " primary" : ""}`}
                onClick={() => setOutletOnly((value) => !value)}
                style={actionButtonStyle(outletOnly ? "primary" : "secondary")}
              >
                只看有插座
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                已選 {selectedDate} · {selectedSlot.label}
              </span>
            </div>

            {seatRows.length > 0 ? (
              <div className="pageStack">
                {seatRows.map(([zone, rows]) => (
                  <div key={zone}>
                    <div className="insetGroupHeader">{zone}</div>
                    <div className="insetGroup">
                      {rows.map(({ seat, effectiveStatus }, index) => {
                        const pendingReserve = pendingAction === `reserve:${seat.id}`;
                        const alreadyReservedByUser = reservationsForSelection.some(
                          (reservation) => reservation.seatId === seat.id
                        );
                        const canReserve =
                          effectiveStatus === "available" &&
                          !alreadyReservedByUser &&
                          reservationsToday.length < 2;

                        const tone =
                          effectiveStatus === "available"
                            ? { color: "var(--success)", bg: "var(--success-soft)", label: "可預約" }
                            : effectiveStatus === "occupied"
                              ? { color: "var(--danger)", bg: "var(--danger-soft)", label: "使用中" }
                              : { color: "var(--warning)", bg: "var(--warning-soft)", label: "已保留" };

                        return (
                          <div
                            key={seat.id}
                            className="insetGroupRow"
                            style={{ borderTop: index === 0 ? "none" : undefined, alignItems: "flex-start" }}
                          >
                            <div className="insetGroupRowIcon" style={{ background: tone.bg, color: tone.color }}>
                              🪑
                            </div>
                            <div className="insetGroupRowContent">
                              <div className="insetGroupRowTitle">
                                {seat.seatNumber}
                                {seat.floor ? ` · ${seat.floor}` : ""}
                              </div>
                              <div className="insetGroupRowMeta">
                                {seat.isQuietZone ? "安靜區" : "可交談"}
                                {" · "}
                                {seat.hasOutlet ? "有插座" : "無插座"}
                              </div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                                <span
                                  className="pill"
                                  style={{ background: tone.bg, color: tone.color, border: "none", fontSize: 11 }}
                                >
                                  {tone.label}
                                </span>
                                {alreadyReservedByUser && (
                                  <span className="pill" style={{ background: "var(--info-soft)", color: "var(--info)", border: "none", fontSize: 11 }}>
                                    你已預約
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              className="btn"
                              disabled={!canReserve || previewMode || pendingReserve}
                              style={actionButtonStyle("primary")}
                              onClick={() => {
                                if (reservationsToday.length >= 2) {
                                  info("已達每日上限", "同一天最多預約 2 個時段");
                                  return;
                                }

                                void runAction(
                                  `reserve:${seat.id}`,
                                  async () => {
                                    await reserveLibrarySeat({
                                      schoolId,
                                      seatId: seat.id,
                                      date: selectedDate,
                                      startTime: selectedSlot.startTime,
                                      endTime: selectedSlot.endTime,
                                    });
                                  },
                                  {
                                    title: "座位預約完成",
                                    body: `${zone} ${seat.seatNumber} 已保留`,
                                  }
                                );
                              }}
                            >
                              {pendingReserve ? "預約中..." : canReserve ? "預約" : "不可預約"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="emptyState">
                <div className="emptyIcon">🪑</div>
                <h3 className="emptyTitle">目前沒有符合條件的座位</h3>
                <p className="emptyBody">調整日期、時段或篩選條件後再試一次。</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "search" && (
          <div className="pageStack">
            <div className="toolbarPanel" style={{ gap: 10 }}>
              <div className="toolbarGrow" style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 16,
                    pointerEvents: "none",
                    opacity: 0.55,
                  }}
                >
                  🔍
                </span>
                <input
                  className="input"
                  type="search"
                  placeholder="搜尋書名、作者或 ISBN"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  style={{ paddingLeft: 40 }}
                />
              </div>
              <button
                className={`btn${onlyAvailable ? " primary" : ""}`}
                onClick={() => setOnlyAvailable((value) => !value)}
                style={actionButtonStyle(onlyAvailable ? "primary" : "secondary")}
              >
                只顯示可借
              </button>
            </div>

            {searchError && !previewMode && (
              <div className="card" style={{ padding: "14px 16px", background: "var(--danger-soft)", borderColor: "rgba(255,59,48,0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13 }}>{searchError}</span>
                  <button className="btn" onClick={() => void refreshCatalog()} style={actionButtonStyle("secondary")}>
                    重新搜尋
                  </button>
                </div>
              </div>
            )}

            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>
                    {searchQuery.trim() ? `搜尋結果：${searchQuery}` : "推薦館藏"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                    {searchLoading
                      ? "正在更新館藏結果..."
                      : previewMode
                        ? "目前顯示示範館藏資料，登入後可直接借閱。"
                        : `共找到 ${visibleBooks.length} 本符合條件的館藏。`}
                  </div>
                </div>
                <span className="pill subtle" style={{ fontSize: 11 }}>
                  {onlyAvailable ? "只顯示可借" : "包含已借出館藏"}
                </span>
              </div>
            </div>

            {visibleBooks.length > 0 ? (
              <div className="insetGroup">
                {visibleBooks.map((book, index) => {
                  const pendingBorrow = pendingAction === `borrow:${book.id}`;
                  const canBorrow = book.available > 0;

                  return (
                    <div
                      key={book.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? "none" : undefined, alignItems: "flex-start" }}
                    >
                      <div
                        className="insetGroupRowIcon"
                        style={{
                          background: canBorrow ? "var(--success-soft)" : "var(--panel)",
                          color: canBorrow ? "var(--success)" : "var(--muted)",
                          fontSize: 20,
                        }}
                      >
                        📘
                      </div>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{book.title}</div>
                        <div className="insetGroupRowMeta">
                          {book.author}
                          {" · "}
                          {book.location}
                          {book.publisher ? ` · ${book.publisher}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <span
                            className="pill"
                            style={{
                              background: canBorrow ? "var(--success-soft)" : "var(--warning-soft)",
                              color: canBorrow ? "var(--success)" : "var(--warning)",
                              border: "none",
                              fontSize: 11,
                            }}
                          >
                            可借 {book.available} / 總館藏 {book.total}
                          </span>
                          {book.isbn ? (
                            <span className="pill subtle" style={{ fontSize: 11 }}>
                              ISBN {book.isbn}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        className="btn"
                        disabled={!canBorrow || previewMode || pendingBorrow}
                        style={actionButtonStyle("primary")}
                        onClick={() =>
                          void runAction(
                            `borrow:${book.id}`,
                            async () => {
                              await borrowLibraryBook({ schoolId, bookId: book.id });
                            },
                            {
                              title: "借閱成功",
                              body: `${book.title} 已加入你的借閱清單`,
                              switchTo: "borrow",
                            }
                          )
                        }
                      >
                        {pendingBorrow ? "借閱中..." : canBorrow ? "借閱" : "已借完"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="emptyState" style={{ background: "var(--panel)" }}>
                <div className="emptyIcon">📖</div>
                <h3 className="emptyTitle">找不到符合條件的館藏</h3>
                <p className="emptyBody">試試不同關鍵字，或關閉「只顯示可借」篩選。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </SiteShell>
  );
}
