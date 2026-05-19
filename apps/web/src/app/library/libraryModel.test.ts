import { describe, expect, it } from "vitest";
import type { LibraryLoan, LibrarySeat, SeatReservation } from "@/lib/firebase";
import {
  buildSeatZoneSummaries,
  filterLibraryBooks,
  getDaysUntilDue,
  getEffectiveSeatStatus,
  normalizeLibraryLoanStatus,
} from "./libraryModel";

describe("libraryModel", () => {
  it("normalizes active loans to borrowed", () => {
    expect(normalizeLibraryLoanStatus("active")).toBe("borrowed");
    expect(normalizeLibraryLoanStatus("overdue")).toBe("overdue");
    expect(normalizeLibraryLoanStatus(undefined)).toBe("borrowed");
  });

  it("computes due days from dueAt or dueDate", () => {
    const loan: LibraryLoan = {
      id: "loan-1",
      userId: "user-1",
      bookId: "book-1",
      borrowedAt: "2026-03-28T00:00:00.000Z",
      dueDate: "2026-04-02T00:00:00.000Z",
      renewCount: 0,
      status: "borrowed",
    };

    expect(getDaysUntilDue(loan, new Date("2026-03-31T08:00:00.000Z"))).toBe(2);
  });

  it("filters books by keyword and availability", () => {
    const results = filterLibraryBooks(
      [
        { id: "1", title: "Clean Code", author: "Robert C. Martin", location: "A", available: 2, total: 3 },
        { id: "2", title: "Refactoring", author: "Martin Fowler", location: "B", available: 0, total: 2 },
      ],
      "martin",
      true
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Clean Code");
  });

  it("treats overlapping reservations as reserved seats", () => {
    const seat: LibrarySeat = {
      id: "seat-1",
      zone: "二樓安靜區",
      seatNumber: "A1",
      hasOutlet: true,
      isQuietZone: true,
      status: "available",
    };
    const reservation: SeatReservation = {
      id: "reservation-1",
      userId: "user-1",
      seatId: "seat-1",
      date: "2026-03-31",
      startTime: "13:00",
      endTime: "17:00",
      status: "active",
    };

    expect(
      getEffectiveSeatStatus(seat, [reservation], "2026-03-31", {
        startTime: "14:00",
        endTime: "16:00",
      })
    ).toBe("reserved");
  });

  it("builds zone summaries from effective seat state", () => {
    const seats: LibrarySeat[] = [
      { id: "seat-1", zone: "二樓安靜區", seatNumber: "A1", hasOutlet: true, isQuietZone: true, status: "available" },
      { id: "seat-2", zone: "二樓安靜區", seatNumber: "A2", hasOutlet: false, isQuietZone: true, status: "occupied" },
      { id: "seat-3", zone: "三樓討論區", seatNumber: "B1", hasOutlet: true, isQuietZone: false, status: "available" },
    ];
    const reservations: SeatReservation[] = [
      {
        id: "reservation-1",
        userId: "user-1",
        seatId: "seat-3",
        date: "2026-03-31",
        startTime: "13:00",
        endTime: "17:00",
        status: "active",
      },
    ];

    expect(
      buildSeatZoneSummaries(seats, reservations, "2026-03-31", {
        startTime: "14:00",
        endTime: "16:00",
      })
    ).toEqual([
      {
        zone: "三樓討論區",
        total: 1,
        available: 0,
        occupied: 0,
        reserved: 1,
        quietSeats: 0,
        outletSeats: 1,
      },
      {
        zone: "二樓安靜區",
        total: 2,
        available: 1,
        occupied: 1,
        reserved: 0,
        quietSeats: 2,
        outletSeats: 1,
      },
    ]);
  });
});
