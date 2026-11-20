'use client';

import { useState } from 'react';
import type { NuniFoodCustomerOrderDetail } from '@campus/shared/src/nuniFood';
import { foodMoney } from './foodState';
import styles from './FoodOrderReceipt.module.css';

export type FoodOrderReceiptData = Pick<
  NuniFoodCustomerOrderDetail,
  'id' | 'locationName' | 'lines' | 'total' | 'createdAt' | 'updatedAt'
>;

const receiptTime = (value: string) =>
  new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

export function FoodOrderReceipt({
  order,
  expandLines = false,
}: {
  order: FoodOrderReceiptData;
  /** 進行中訂單初次展開，輪詢更新後仍保留讀者的開合選擇。 */
  expandLines?: boolean;
}) {
  const [linesOpen, setLinesOpen] = useState(expandLines);
  return (
    <section className={styles.receipt} aria-label="訂單紙本明細">
      <div className={styles.paper}>
        <header className={styles.header}>
          <h3>{order.locationName}</h3>
          <p className={styles.title}>訂單明細</p>
        </header>

        <dl className={styles.metadata}>
          <div>
            <dt>訂單建立</dt>
            <dd>
              <time dateTime={order.createdAt}>{receiptTime(order.createdAt)}</time>
            </dd>
          </div>
          <div>
            <dt>訂單編號</dt>
            <dd className={styles.orderId}>{order.id}</dd>
          </div>
        </dl>

        {order.lines.length ? (
          <details
            className={styles.details}
            open={linesOpen}
            onToggle={(event) => setLinesOpen(event.currentTarget.open)}
          >
            <summary>
              <span>品項明細 · {order.lines.length} 項</span>
              <span className={styles.toggle} aria-hidden="true">
                {linesOpen ? '收合 −' : '展開 ＋'}
              </span>
            </summary>
            <div className={styles.columns} aria-hidden="true">
              <span>品項</span>
              <span>數量</span>
              <span>金額</span>
            </div>
            <ul className={styles.lines}>
              {order.lines.map((line, index) => (
                <li key={`${line.menuItemId}:${index}`}>
                  <div className={styles.lineHeading}>
                    <h4>{line.nameSnapshot}</h4>
                    <span className={styles.quantity}>
                      <span className={styles.srOnly}>數量 </span>
                      {line.quantity}
                    </span>
                    <span className={styles.lineAmount}>
                      <span className={styles.srOnly}>品項金額 </span>
                      {foodMoney(line.lineTotal)}
                    </span>
                  </div>
                  {line.selectedOptions.length > 0 && (
                    <p className={styles.options}>
                      選項：{line.selectedOptions.map((option) => option.nameSnapshot).join('、')}
                    </p>
                  )}
                  {line.customerNote && <p className={styles.note}>備註：{line.customerNote}</p>}
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
          <p className={styles.disclaimer}>非統一發票</p>
          <p className={styles.updated}>
            資料更新 <time dateTime={order.updatedAt}>{receiptTime(order.updatedAt)}</time>
          </p>
          <p className={styles.timezone}>時間皆為臺灣時間（UTC+8）</p>
          <p className={styles.brand}>nuni</p>
        </footer>
      </div>
      <p className={styles.caption}>依店家訂單資料整理，付款與取餐請以本頁最新狀態為準。</p>
    </section>
  );
}
