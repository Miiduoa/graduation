'use client';

import { useId, useState } from 'react';
import { requestPwaInstallation, usePwaInstallation } from '@/lib/pwaInstallation';
import { Button } from './ui/Button';
import styles from './PWAInstallSettings.module.css';

export function PWAInstallSettings() {
  const installation = usePwaInstallation();
  const [helpOpen, setHelpOpen] = useState(false);
  const id = useId();
  const canPrompt = installation.canPrompt || installation.busy;
  const status = installation.installed
    ? 'nuni 已加入主畫面。'
    : installation.result === 'accepted'
      ? '已送出安裝要求，等待瀏覽器完成安裝。'
      : installation.result === 'dismissed'
        ? '已取消安裝。之後想加入時，可以再回到這裡。'
        : '';

  return (
    <section className={styles.install} aria-labelledby={`${id}-title`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`${id}-title`}>把 nuni 放在主畫面</h3>
          <p>下次直接開啟課表、作業與校園服務。</p>
        </div>
        <Button
          type="button"
          variant={canPrompt ? 'primary' : 'default'}
          loading={installation.busy}
          disabled={!installation.ready || installation.installed}
          aria-expanded={!canPrompt && !installation.installed ? helpOpen : undefined}
          aria-controls={!canPrompt && !installation.installed ? `${id}-help` : undefined}
          onClick={() => {
            if (installation.canPrompt) void requestPwaInstallation();
            else setHelpOpen((value) => !value);
          }}
        >
          {installation.installed
            ? '已加入主畫面'
            : canPrompt
              ? '加入主畫面'
              : helpOpen
                ? '收起加入方式'
                : '查看加入方式'}
        </Button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
      {installation.result === 'failed' && !installation.installed ? (
        <p className={styles.error} role="alert">
          無法開啟安裝視窗。可以稍後再試，或使用瀏覽器選單加入。
        </p>
      ) : null}
      <div id={`${id}-help`} hidden={!helpOpen || installation.installed} className={styles.help}>
        {installation.isIOS ? (
          <ol>
            <li>在 Safari 開啟 nuni。</li>
            <li>打開瀏覽器的「分享」選單，選擇「加入主畫面」。</li>
            <li>依畫面完成加入，下次從主畫面上的 nuni 圖示開啟。</li>
          </ol>
        ) : (
          <ol>
            <li>打開瀏覽器選單，找到安裝應用程式或建立主畫面捷徑的選項。</li>
            <li>如果沒有這個選項，可以先將 nuni 加入書籤，之後從書籤開啟。</li>
          </ol>
        )}
        <p>課程與個人資料仍需網路連線。</p>
      </div>
    </section>
  );
}
