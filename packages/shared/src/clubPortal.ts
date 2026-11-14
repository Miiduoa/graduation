/** Server projections only. School approval is never derived from a group editor's fields. */
export type ClubListing = {
  id: string;
  name: string;
  category: string;
  meetingTime: string;
  recruiting: boolean;
  approval: string;
  joinPolicy: string;
};
export type ClubPortalView = {
  success: true;
  message?: string;
  office: boolean;
  clubs?: ClubListing[];
  club?: ClubListing & {
    description: string;
    instagram: string;
    line: string;
    memberCount: number | null;
  };
  role?: string;
  status?: string;
  reason?: string;
  members?: {
    id: string;
    name: string;
    role: string;
    phone: string;
    studentId: string;
    duesPaid: boolean;
  }[];
  officialOfficers?: { id: string; role: string; status: 'confirmed' | 'pending' }[];
  requests?: { id: string; name: string }[];
  announcements?: { id: string; title: string; body: string }[];
  events?: {
    id: string;
    title: string;
    location: string;
    startsAt: number;
    endsAt: number;
    capacity: number;
    registrationDeadline: number;
    cancellationDeadline: number;
    visibility: string;
    registered: number;
    checkedIn: number;
    mine: boolean;
    myCheckIn: boolean;
    myCheckInCode?: string;
    studentSuffix?: string;
    registrations?: { uid: string; name: string; checkedInAt: number | null }[];
  }[];
};
