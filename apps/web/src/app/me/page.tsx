import { redirect } from 'next/navigation';

// 「我」統一進個人頁
export default function MePage() {
  redirect('/profile');
}
