import { redirect } from 'next/navigation';

/** 舊「今天」別名：統一進首頁。 */
export default function TodayPage() {
  redirect('/');
}
