import { redirect } from 'next/navigation';

/** 舊店家別名：改導向現有餐飲入口，不再丟空白登入。 */
export default function ShopsPage() {
  redirect('/food');
}
