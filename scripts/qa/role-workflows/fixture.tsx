import { createRoot } from 'react-dom/client';
import { AccountIdentity } from '@/components/AccountIdentity';
import { MerchantWorkspace } from '@/features/merchant/MerchantWorkspace';
import '@/app/globals.css';

const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme =
  query.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const merchant = location.pathname.startsWith('/merchant');
const view = location.pathname.endsWith('/apply')
  ? 'apply'
  : location.pathname.endsWith('/workspace')
    ? 'workspace'
    : 'overview';

createRoot(document.getElementById('root')!).render(
  <>
    <p className="fixture-note">
      角色工作流程驗收 · 真實產品元件與樣式，使用隔離的測試帳號與 API 資料，未連線正式服務。
    </p>
    {merchant ? (
      <MerchantWorkspace view={view} />
    ) : (
      <>
        <h1>今天</h1>
        <AccountIdentity
          accountId="pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          context="qa-role-context"
          variant="home"
          isPlatformOperator={query.get('operator') === '1'}
        />
        <section className="fixture-next" aria-label="後續頁面內容">
          <h2>今天的安排</h2>
          <p>此區只標示工作入口後的閱讀順序。</p>
          <a className="btn" href="#root">
            繼續查看今天
          </a>
        </section>
      </>
    )}
  </>,
);
