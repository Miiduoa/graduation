import { Suspense } from 'react';
import { AccountDemoWorkspace } from './AccountDemoWorkspace';

export default function AccountDemoPage() {
  return (
    <Suspense fallback={<p role="status">載入展示資料…</p>}>
      <AccountDemoWorkspace />
    </Suspense>
  );
}
