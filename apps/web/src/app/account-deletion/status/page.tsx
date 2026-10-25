import type { Metadata } from 'next';
import { DeletionStatus } from './DeletionStatus';
import { PUBLIC_PAGE_INTRO } from './deletionStatus';

export const metadata: Metadata = {
  title: '刪除進度 | Campus One',
  description: PUBLIC_PAGE_INTRO,
};

export default function DeletionStatusPage() {
  return <DeletionStatus />;
}
