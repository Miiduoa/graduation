import { createRoot } from 'react-dom/client';
import { MerchantWorkspace } from '../../../apps/web/src/features/merchant/MerchantWorkspace';
import { Button } from '../../../apps/web/src/components/ui/Button';
import { ToastProvider } from '../../../apps/web/src/components/ui/Toast';
import { SchoolLmsReadonlyProvider } from '../../../apps/web/src/components/SchoolLmsReadonlyProvider';
import {
  fixtureOptions,
  navigate,
  useFixtureState,
  switchFixtureAccount,
  toggleFixturePermission,
  toggleReadDelay,
  releaseFixtureReads,
} from './boundaries';
import '../../../apps/web/src/app/globals.css';

document.documentElement.dataset.theme = fixtureOptions.get('theme') === 'dark' ? 'dark' : 'light';
if (fixtureOptions.get('motion') === 'reduce')
  document.documentElement.dataset.reducedMotion = 'true';
if (fixtureOptions.get('text') === '200') document.documentElement.style.fontSize = '200%';

function FixtureControls() {
  const state = useFixtureState();
  return (
    <section className="fixture-controls" aria-label="商家流程驗收控制">
      <h2>合成資料驗收</h2>
      <p>這是實際產品元件及樣式；帳號、門市與訂單均為合成資料，操作不會寫入正式服務。</p>
      <p role="status">
        目前帳號：{state.account}；一樓門市權限：{state.revoked ? '已撤回' : '有效'}；等待讀取：
        {state.pendingReads} 筆。
      </p>
      <div className="fixture-buttons">
        <Button onClick={() => navigate('/merchant/workspace')}>回門市清單</Button>
        <Button
          onClick={() =>
            navigate(
              '/merchant/workspace?tenant=campus-one&location=store-a&section=orders&queue=active',
            )
          }
        >
          開啟一樓備餐與取餐
        </Button>
        <Button onClick={() => navigate('/merchant/workspace?tenant=campus-one&location=store-b')}>
          開啟圖書館門市
        </Button>
        <Button
          onClick={() =>
            switchFixtureAccount(state.account === 'account-a' ? 'account-b' : 'account-a')
          }
        >
          切換合成帳號
        </Button>
        <Button
          onClick={() => switchFixtureAccount(state.account === 'guest' ? 'account-a' : 'guest')}
        >
          切換訪客狀態
        </Button>
        <Button onClick={toggleFixturePermission}>
          {state.revoked ? '恢復一樓門市權限' : '撤回一樓門市權限'}
        </Button>
        <Button onClick={toggleReadDelay}>
          {state.delayReads ? '停止延遲新讀取' : '延遲後續讀取'}
        </Button>
        <Button onClick={releaseFixtureReads} disabled={!state.pendingReads}>
          釋放等待中的讀取
        </Button>
      </div>
    </section>
  );
}

function Fixture() {
  return (
    <ToastProvider>
      <SchoolLmsReadonlyProvider enabled={false}>
        <MerchantWorkspace view="workspace" />
        <FixtureControls />
      </SchoolLmsReadonlyProvider>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
