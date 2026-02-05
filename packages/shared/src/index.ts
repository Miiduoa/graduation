export type Announcement = {
  id: string;
  title: string;
  body: string;
  publishedAt: string; // ISO
  source?: string;
};

export type ClubEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  capacity?: number;
};

export type Course = {
  id: string;
  name: string;
  teacher?: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  location?: string;
};

export type CampusPoi = {
  id: string;
  name: string;
  category: "building" | "food" | "office" | "other";
  lat: number;
  lng: number;
  description?: string;
};

export type CafeteriaMenuItem = {
  id: string;
  cafeteria: string;
  name: string;
  price?: number;
  availableOn: string; // YYYY-MM-DD
};

export type School = {
  id: string; // internal id
  code: string; // user-facing join code
  name: string;
  themeColor?: string;
  domains?: string[]; // email domains for auto-binding
};

export * from "./schools";

export * from "./creditAudit";
export * from "./sampleUsage";
