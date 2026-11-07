'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  categoryLabel,
  formatLostFoundCalendarDate,
  statusLabel,
  typeLabel,
  type LostFoundItem,
} from '@/lib/lostFound';
import { LostFoundThumbnail } from './LostFoundPhotos';
import styles from './LostFoundItemTag.module.css';

export function LostFoundItemTag({
  item,
  href,
  children,
}: {
  item: LostFoundItem;
  href?: string;
  children: ReactNode;
}) {
  const date = formatLostFoundCalendarDate(item.date);
  return (
    <div
      className={`${styles.tag} ${href ? styles.listTag : styles.detailTag}`}
      data-testid="lost-found-tag"
      data-type={item.type}
      data-status={item.status}
    >
      <span className={styles.cord} aria-hidden="true" />
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.type}>{typeLabel(item.type)}</span>
          <span>{categoryLabel(item.category)}</span>
          {!item.canonical ? <span className={styles.legacy}>舊版紀錄</span> : null}
        </div>
        <span className={styles.stamp} data-status={item.status}>
          {statusLabel(item.status)}
        </span>
      </div>
      <h2 className={styles.title}>
        {href ? (
          <Link className={styles.titleLink} aria-label={item.title} href={href}>
            <span>{item.title}</span>
            {item.photos?.length ? (
              <span className={styles.photo}>
                <LostFoundThumbnail photos={item.photos} />
              </span>
            ) : null}
          </Link>
        ) : item.title}
      </h2>
      <dl className={styles.facts}>
        <div>
          <dt>地點</dt>
          <dd>{item.location}</dd>
        </div>
        <div>
          <dt>日期</dt>
          <dd>{date ? <time dateTime={item.date}>{date}</time> : '未提供日期'}</dd>
        </div>
      </dl>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
