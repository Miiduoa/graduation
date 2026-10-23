import type { SVGProps } from 'react';

export type CampusIconName =
  | 'map'
  | 'bus'
  | 'announcements'
  | 'cafeteria'
  | 'library'
  | 'timetable'
  | 'course'
  | 'calendar'
  | 'import'
  | 'people'
  | 'search'
  | 'lost-found'
  | 'orders'
  | 'social'
  | 'community'
  | 'friends'
  | 'support'
  | 'repair'
  | 'profile'
  | 'services'
  | 'arrow';

const paths: Record<CampusIconName, React.ReactNode> = {
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="3" width="14" height="16" rx="3" />
      <path d="M5 11h14M8 19v2M16 19v2M9 6h6" />
      <path d="M8.5 15h.01M15.5 15h.01" strokeWidth="3" />
    </>
  ),
  announcements: (
    <>
      <path d="M4 10v5h4l10 4V6L8 10H4ZM8 15l1 5h3l-1-4M21 10v5" />
    </>
  ),
  cafeteria: (
    <>
      <path d="M5 3v7a3 3 0 0 0 6 0V3M8 3v18M18 21V3c-3 2-3 7 0 9" />
    </>
  ),
  library: (
    <>
      <path d="M3 4h6a4 4 0 0 1 3 1.5A4 4 0 0 1 15 4h6v15h-6a4 4 0 0 0-3 1.5A4 4 0 0 0 9 19H3V4ZM12 6v14" />
    </>
  ),
  timetable: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M7 2v4M17 2v4M3 10h18M9 10v11M15 10v11M3 15h18" />
    </>
  ),
  course: (
    <>
      <path d="m2 9 10-5 10 5-10 5L2 9ZM6 11v6c4 3 8 3 12 0v-6M22 9v7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M7 2v4M17 2v4M3 10h18m-13 5 3 3 5-5" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  'lost-found': (
    <>
      <path d="M4 9h16v12H4V9ZM8 9V6a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15" r="2" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3" />
    </>
  ),
  social: (
    <>
      <path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 1 1 18 0Z" />
      <path d="M7 9h8M7 13h5" />
    </>
  ),
  community: (
    <>
      <path d="M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7" />
    </>
  ),
  friends: (
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M2 21v-3a6 6 0 0 1 12 0v3M19 7v8M15 11h8" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8.5a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2.5M12 17h.01" />
    </>
  ),
  repair: (
    <>
      <path d="M14 7a5 5 0 0 0-6 6L3 18a2 2 0 0 0 3 3l5-5a5 5 0 0 0 6-6l-3 3-3-3 3-3Z" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
    </>
  ),
  services: (
    <>
      <rect x="3" y="3" width="6.5" height="6.5" rx="1.5" />
      <rect x="14.5" y="3" width="6.5" height="6.5" rx="1.5" />
      <rect x="3" y="14.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="14.5" y="14.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
};

export function CampusIcon({
  name,
  size = 22,
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'name'> & { name: CampusIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
