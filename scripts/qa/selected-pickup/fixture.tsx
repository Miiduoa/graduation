import { createRoot } from 'react-dom/client';
import { FoodWorkspace } from '../../../apps/web/src/features/food/FoodWorkspace';
import '../../../apps/web/src/app/globals.css';

// Only identity/campus/navigation boundaries are replaced. The actual workspace,
// order client, detail, Agent card, journal and receipt mirroring remain intact.
const config = await (await fetch('/qa/config', { cache: 'no-store' })).json();
(window as Window & { __pickupQA: unknown }).__pickupQA = config;
const query = new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(<>
  <p className="fixture-banner">合成資料驗證：實際訂單介面與 Agent 服務，不連正式帳號、模型或訂單。</p>
  <FoodWorkspace initialTenant={query.get('tenant') || config.tenantId}
    initialOrder={query.get('order') || ''} campusSearch={'schoolId=' + config.schoolId} />
</>);
