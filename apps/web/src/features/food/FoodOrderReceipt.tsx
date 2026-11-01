'use client';

import type { NuniFoodCustomerOrderDetail } from '@campus/shared/src/nuniFood';
import { foodMoney, foodTime } from './foodState';
import styles from './FoodOrderReceipt.module.css';

export type FoodOrderReceiptData = Pick<
  NuniFoodCustomerOrderDetail,
  'id' | 'locationName' | 'lines' | 'total' | 'createdAt' | 'updatedAt'
>;

const receiptTime = (value: string) =>
  `${new Date(value).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric' })} ${foodTime(value)}`;

export function FoodOrderReceipt({ order }: { order: FoodOrderReceiptData }) {
  return (
    <section className={styles.receipt} aria-label="訂單紙本明細">
      <header className={styles.header}>
        <h3>Campus One 訂單明細</h3>
        <p className={styles.disclaimer}>非統一發票</p>
        <p className={styles.location}>{order.locationName}</p>
      </header>

      <dl className={styles.metadata}>
        <div>
          <dt>訂單編號</dt>
          <dd className={styles.orderId}>{order.id}</dd>
        </div>
        <div>
          <dt>訂單建立</dt>
          <dd>
            <time dateTime={order.createdAt}>{receiptTime(order.createdAt)}</time>
          </dd>
        </div>
        <div>
          <dt>資料更新</dt>
          <dd>
            <time dateTime={order.updatedAt}>{receiptTime(order.updatedAt)}</time>
          </dd>
        </div>
      </dl>
      <p className={styles.timezone}>時間皆為臺灣時間（UTC+8）</p>

      {order.lines.length ? (
        <details className={styles.details}>
          <summary>品項明細 · {order.lines.length} 項</summary>
          <ul className={styles.lines}>
            {order.lines.map((line, index) => (
              <li key={`${line.menuItemId}:${index}`}>
                <div className={styles.lineHeading}>
                  <h4>{line.nameSnapshot}</h4>
                  <span>數量 {line.quantity}</span>
                </div>
                {line.selectedOptions.length > 0 && (
                  <p className={styles.options}>
                    選項：{line.selectedOptions.map((option) => option.nameSnapshot).join('、')}
                  </p>
                )}
                {line.customerNote && <p className={styles.note}>備註：{line.customerNote}</p>}
                <p className={styles.lineAmount}>品項金額 {foodMoney(line.lineTotal)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className={styles.empty}>這筆訂單尚未提供品項明細。</p>
      )}

      <dl className={styles.total}>
        <dt>訂單總額</dt>
        <dd>{foodMoney(order.total)}</dd>
      </dl>
      <footer className={styles.footer}>
        <p>依店家訂單資料整理，付款與取餐請以本頁最新狀態為準。</p>
      </footer>
    </section>
  );
}
