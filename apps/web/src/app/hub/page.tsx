import { redirect } from 'next/navigation';

/** 舊「樞紐」別名：統一進首頁。 */
export default function HubPage() {
  redirect('/');
}
