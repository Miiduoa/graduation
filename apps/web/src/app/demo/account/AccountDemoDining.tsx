'use client';

import { useEffect, useId, useState } from 'react';
import {
  ACCOUNT_DEMO_MEAL as MEAL,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import styles from './accountDining.module.css';

type DiningAction = 'createOrder' | 'readyOrder';

/** Both views render the same account-owned server receipt; no local order is invented. */
export function AccountDemoDining({
  demo,
  blocked,
  onAction,
}: {
  demo: AccountDemoSnapshot;
  blocked: boolean;
  onAction: (action: DiningAction) => void;
}) {
  const [view, setView] = useState<'student' | 'merchant'>('student');
  useEffect(() => {
    const selectLinkedView = () => {
      if (window.location.hash === '#merchant-demo') setView('merchant');
      if (window.location.hash === '#account-dining') setView('student');
    };
    selectLinkedView();
    window.addEventListener('hashchange', selectLinkedView);
    return () => window.removeEventListener('hashchange', selectLinkedView);
  }, []);
  const titleId = useId();
  const created = demo.state.createOrder;
  const ready = created && demo.state.readyOrder;
  const status = ready ? '可取餐' : created ? '備餐中' : '尚未建立';
  const orderReference = `${demo.profile.studentId}-01`;
  const foodAllowed = demo.permissions.food;
  const merchantAllowed = foodAllowed && demo.permissions.administration;

  return (
    <section id="account-dining" className={styles.dining} aria-labelledby={titleId}>
      <header id="merchant-demo" className={styles.header}>
        <div>
          <p className={styles.eyebrow}>午餐時段 · 帳號展示</p>
          <h2 id={titleId}>點好午餐，接著看看店家端</h2>
          <p className={styles.intro}>學生與店家共用同一筆展示訂單，進度會跟著帳號保存。</p>
        </div>
        <div className={styles.viewControls} role="group" aria-label="訂餐展示視角">
          <button
            type="button"
            aria-pressed={view === 'student'}
            onClick={() => setView('student')}
          >
            學生點餐
          </button>
          <button
            type="button"
            aria-pressed={view === 'merchant'}
            onClick={() => setView('merchant')}
          >
            店家接單
          </button>
        </div>
      </header>

      <ol className={styles.steps} aria-label="訂餐處理進度">
        <li data-complete={created} aria-current={!created ? 'step' : undefined}>
          <span aria-hidden="true">{created ? '✓' : '1'}</span>學生確認訂餐
        </li>
        <li data-complete={ready} aria-current={created && !ready ? 'step' : undefined}>
          <span aria-hidden="true">{ready ? '✓' : '2'}</span>店家準備餐點
        </li>
        <li data-complete={ready} aria-current={ready ? 'step' : undefined}>
          <span aria-hidden="true">{ready ? '✓' : '3'}</span>學生查看取餐單
        </li>
      </ol>

      {view === 'student' ? (
        <div className={styles.columns}>
          <article className={styles.menu} aria-label="展示菜單">
            <div className={styles.merchantHeading}>
              <span className={styles.shopMark} aria-hidden="true">
                小日子
              </span>
              <div>
                <h3>{MEAL.merchant}</h3>
                <p>{demo.profile.schoolName} · 示範店家</p>
              </div>
            </div>
            <div className={styles.meal}>
              <span className={styles.mealNumber} aria-hidden="true">
                01
              </span>
              <div>
                <p className={styles.mealTag}>本次展示餐點</p>
                <h4>{MEAL.name}</h4>
                <p>{MEAL.detail}</p>
              </div>
              <strong>NT$ {MEAL.price}</strong>
            </div>
            <dl className={styles.details}>
              <div>
                <dt>份數</dt>
                <dd>{MEAL.quantity} 份</dd>
              </div>
              <div>
                <dt>取餐時段</dt>
                <dd>{MEAL.pickup}</dd>
              </div>
              <div>
                <dt>取餐地點</dt>
                <dd>{MEAL.place}</dd>
              </div>
            </dl>
            <div className={styles.total}>
              <span>展示金額</span>
              <strong>NT$ {MEAL.price}</strong>
            </div>
            <button
              type="button"
              className={styles.primary}
              disabled={blocked || !foodAllowed || created}
              onClick={() => onAction('createOrder')}
            >
              {created ? '✓ ' : ''}建立訂餐{!foodAllowed ? '（已關閉）' : ''}
            </button>
            {!foodAllowed ? <p className={styles.help}>請在展示權限開啟「訂餐」。</p> : null}
          </article>

          <article className={styles.receipt} aria-label="我的展示取餐單" aria-live="polite">
            <div className={styles.receiptHeading}>
              <h3>我的取餐單</h3>
              <span className={styles.status} data-ready={ready}>
                {status}
              </span>
            </div>
            {created ? (
              <>
                <p className={styles.orderReference}>展示單號 {orderReference}</p>
                <h4 className={styles.pickupHeading}>
                  {ready ? '餐點準備好了' : '訂單已送到展示店家'}
                </h4>
                <p className={styles.receiptCopy}>
                  {ready
                    ? `請於 ${MEAL.pickup} 前往${MEAL.place}，出示這張取餐單。`
                    : '切換「店家接單」完成備餐，再回來查看取餐狀態。'}
                </p>
                <dl className={styles.details}>
                  <div>
                    <dt>取餐人</dt>
                    <dd>{demo.profile.displayName}</dd>
                  </div>
                  <div>
                    <dt>店家</dt>
                    <dd>{MEAL.merchant}</dd>
                  </div>
                  <div>
                    <dt>餐點</dt>
                    <dd>
                      {MEAL.name} × {MEAL.quantity}
                    </dd>
                  </div>
                  <div>
                    <dt>展示金額</dt>
                    <dd>NT$ {MEAL.price}</dd>
                  </div>
                </dl>
                {!ready ? (
                  <button type="button" onClick={() => setView('merchant')}>
                    前往店家接單
                  </button>
                ) : null}
              </>
            ) : (
              <div className={styles.empty}>
                <p>午餐還沒決定？</p>
                <span>確認左側餐點後建立訂餐，這裡就會出現你的取餐單。</span>
              </div>
            )}
          </article>
        </div>
      ) : (
        <div className={styles.merchantView}>
          <div className={styles.merchantSummary}>
            <div>
              <p className={styles.eyebrow}>店家工作台</p>
              <h3>{MEAL.merchant}</h3>
              <p>{MEAL.place} · 合成展示資料</p>
            </div>
            <dl className={styles.counts}>
              <div>
                <dt>備餐中</dt>
                <dd>{created && !ready ? 1 : 0}</dd>
              </div>
              <div>
                <dt>可取餐</dt>
                <dd>{ready ? 1 : 0}</dd>
              </div>
            </dl>
          </div>
          {created ? (
            <article className={styles.merchantOrder} aria-label="店家展示訂單">
              <div className={styles.receiptHeading}>
                <p className={styles.orderReference}>展示單號 {orderReference}</p>
                <span className={styles.status} data-ready={ready}>
                  {status}
                </span>
              </div>
              <div className={styles.orderBody}>
                <div>
                  <h4>
                    {MEAL.name} × {MEAL.quantity}
                  </h4>
                  <p>
                    {demo.profile.displayName} · {MEAL.pickup} 取餐 · NT$ {MEAL.price}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={blocked || !merchantAllowed || ready}
                  onClick={() => onAction('readyOrder')}
                >
                  {ready ? '✓ ' : ''}標示可取餐{!merchantAllowed ? '（已關閉）' : ''}
                </button>
              </div>
              {!merchantAllowed ? (
                <p className={styles.help}>店家備餐需要同時開啟「訂餐」與「管理展示」權限。</p>
              ) : null}
              {ready ? (
                <p className={styles.saved}>可取餐狀態已儲存，學生取餐單已同步更新。</p>
              ) : null}
              <button type="button" onClick={() => setView('student')}>
                查看學生取餐單
              </button>
            </article>
          ) : (
            <div className={styles.empty}>
              <p>目前沒有展示訂單</p>
              <span>先從學生端建立一筆訂餐，再回到這裡處理。</span>
              <button type="button" onClick={() => setView('student')}>
                前往學生點餐
              </button>
            </div>
          )}
        </div>
      )}
      <p className={styles.caption}>
        本次使用固定合成菜單與展示金額，僅保存本人展示訂單；不扣款，也不送往實際店家。
      </p>
    </section>
  );
}
