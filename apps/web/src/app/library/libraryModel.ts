import type {
  LibraryBook,
  LibraryLoan,
  LibrarySeat,
  SeatReservation,
} from "@/lib/firebase";

export type LibraryTab = "borrow" | "seats" | "search";

export type SeatTimeSlot = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
};

export type SeatZoneSummary = {
  zone: string;
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  quietSeats: number;
  outletSeats: number;
};

export const LIBRARY_TIME_SLOTS: SeatTimeSlot[] = [
  { id: "morning", label: "上午 09:00-12:00", startTime: "09:00", endTime: "12:00" },
  { id: "afternoon", label: "下午 13:00-17:00", startTime: "13:00", endTime: "17:00" },
  { id: "evening", label: "晚間 18:00-21:00", startTime: "18:00", endTime: "21:00" },
];

export const DEMO_LIBRARY_BOOKS: LibraryBook[] = [
  {
    id: "book-clean-code",
    isbn: "9780132350884",
    title: "Clean Code",
    author: "Robert C. Martin",
    publisher: "Prentice Hall",
    publishYear: 2008,
    location: "總圖 3F A 區",
    available: 2,
    total: 4,
  },
  {
    id: "book-ddd",
    isbn: "9780321125217",
    title: "Domain-Driven Design",
    author: "Eric Evans",
    publisher: "Addison-Wesley",
    publishYear: 2003,
    location: "總圖 4F B 區",
    available: 1,
    total: 2,
  },
  {
    id: "book-refactoring",
    isbn: "9780134757599",
    title: "Refactoring",
    author: "Martin Fowler",
    publisher: "Addison-Wesley",
    publishYear: 2018,
    location: "總圖 3F C 區",
    available: 0,
    total: 3,
  },
  {
    id: "book-design-patterns",
    isbn: "9780201633610",
    title: "Design Patterns",
    author: "Erich Gamma",
    publisher: "Addison-Wesley",
    publishYear: 1994,
    location: "總圖 3F A 區",
    available: 3,
    total: 3,
  },
];

export const DEMO_LIBRARY_LOANS: LibraryLoan[] = [
  {
    id: "loan-1",
    userId: "demo-user",
    bookId: "book-clean-code",
    bookTitle: "Clean Code",
    bookAuthor: "Robert C. Martin",
    borrowedAt: "2026-03-18T09:00:00.000Z",
    dueAt: "2026-04-02T09:00:00.000Z",
    renewCount: 1,
    status: "borrowed",
  },
  {
    id: "loan-2",
    userId: "demo-user",
    bookId: "book-ddd",
    bookTitle: "Domain-Driven Design",
    bookAuthor: "Eric Evans",
    borrowedAt: "2026-03-10T09:00:00.000Z",
    dueAt: "2026-03-31T09:00:00.000Z",
    renewCount: 2,
    status: "overdue",
  },
];

export const DEMO_LIBRARY_SEATS: LibrarySeat[] = [
  { id: "seat-a1", zone: "二樓安靜區", seatNumber: "A1", floor: "2F", hasOutlet: true, isQuietZone: true, status: "available" },
  { id: "seat-a2", zone: "二樓安靜區", seatNumber: "A2", floor: "2F", hasOutlet: false, isQuietZone: true, status: "occupied" },
  { id: "seat-a3", zone: "二樓安靜區", seatNumber: "A3", floor: "2F", hasOutlet: true, isQuietZone: true, status: "available" },
  { id: "seat-b1", zone: "三樓討論區", seatNumber: "B1", floor: "3F", hasOutlet: true, isQuietZone: false, status: "available" },
  { id: "seat-b2", zone: "三樓討論區", seatNumber: "B2", floor: "3F", hasOutlet: false, isQuietZone: false, status: "reserved" },
  { id: "seat-c1", zone: "四樓研究區", seatNumber: "C1", floor: "4F", hasOutlet: true, isQuietZone: true, status: "available" },
];

export const DEMO_SEAT_RESERVATIONS: SeatReservation[] = [
  {
    id: "reservation-1",
    userId: "demo-user",
    seatId: "seat-a3",
    date: "2026-03-31",
    startTime: "13:00",
    endTime: "17:00",
    status: "active",
    createdAt: "2026-03-30T11:00:00.000Z",
  },
];

export function formatLocalDateInput(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeLibraryLoanStatus(status?: string): LibraryLoan["status"] {
  if (status === "active") return "borrowed";
  if (status === "returned" || status === "overdue") return status;
  return "borrowed";
}

export function getLoanDueAt(loan: LibraryLoan): string | null {
  return loan.dueAt ?? loan.dueDate ?? null;
}

export function getDaysUntilDue(loan: LibraryLoan, now: Date = new Date()): number | null {
  const dueAt = getLoanDueAt(loan);
  if (!dueAt) return null;

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((due.getTime() - now.getTime()) / msPerDay);
}

export function isLoanActive(loan: LibraryLoan): boolean {
  return normalizeLibraryLoanStatus(loan.status) !== "returned";
}

export function sortLibraryLoans(loans: LibraryLoan[]): LibraryLoan[] {
  return [...loans].sort((a, b) => {
    const left = Date.parse(getLoanDueAt(a) ?? "");
    const right = Date.parse(getLoanDueAt(b) ?? "");

    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left - right;
  });
}

export function filterLibraryBooks(
  books: LibraryBook[],
  query: string,
  onlyAvailable: boolean
): LibraryBook[] {
  const normalizedQuery = query.trim().toLowerCase();
  return books.filter((book) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      book.title.toLowerCase().includes(normalizedQuery) ||
      book.author.toLowerCase().includes(normalizedQuery) ||
      book.isbn?.toLowerCase().includes(normalizedQuery);
    const matchesAvailability = !onlyAvailable || book.available > 0;
    return matchesQuery && matchesAvailability;
  });
}

function toTimeValue(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isReservationActiveForSlot(
  reservation: SeatReservation,
  date: string,
  slot: Pick<SeatTimeSlot, "startTime" | "endTime">
): boolean {
  if (reservation.status !== "active" || reservation.date !== date) {
    return false;
  }

  const slotStart = toTimeValue(slot.startTime);
  const slotEnd = toTimeValue(slot.endTime);
  const reservationStart = toTimeValue(reservation.startTime);
  const reservationEnd = toTimeValue(reservation.endTime);

  return reservationStart < slotEnd && reservationEnd > slotStart;
}

export function getEffectiveSeatStatus(
  seat: LibrarySeat,
  reservations: SeatReservation[],
  date: string,
  slot: Pick<SeatTimeSlot, "startTime" | "endTime">
): LibrarySeat["status"] {
  if (seat.status === "occupied") {
    return "occupied";
  }

  const overlaps = reservations.some(
    (reservation) =>
      reservation.seatId === seat.id && isReservationActiveForSlot(reservation, date, slot)
  );

  if (overlaps || seat.status === "reserved") {
    return "reserved";
  }

  return "available";
}

export function buildSeatZoneSummaries(
  seats: LibrarySeat[],
  reservations: SeatReservation[],
  date: string,
  slot: Pick<SeatTimeSlot, "startTime" | "endTime">
): SeatZoneSummary[] {
  const zoneMap = new Map<string, SeatZoneSummary>();

  for (const seat of seats) {
    const summary = zoneMap.get(seat.zone) ?? {
      zone: seat.zone,
      total: 0,
      available: 0,
      occupied: 0,
      reserved: 0,
      quietSeats: 0,
      outletSeats: 0,
    };

    summary.total += 1;
    if (seat.isQuietZone) summary.quietSeats += 1;
    if (seat.hasOutlet) summary.outletSeats += 1;

    const effectiveStatus = getEffectiveSeatStatus(seat, reservations, date, slot);
    if (effectiveStatus === "available") summary.available += 1;
    if (effectiveStatus === "occupied") summary.occupied += 1;
    if (effectiveStatus === "reserved") summary.reserved += 1;

    zoneMap.set(seat.zone, summary);
  }

  return [...zoneMap.values()].sort((a, b) => a.zone.localeCompare(b.zone, "zh-TW"));
}
