import { Suspense } from 'react';
import { AdminLogin } from '@/features/admin/AdminLogin';

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLogin />
    </Suspense>
  );
}
