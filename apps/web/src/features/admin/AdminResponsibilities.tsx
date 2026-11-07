'use client';

import { Button } from '@/components/ui/Button';
import type { AdminSection } from './adminNav';
import styles from './Admin.module.css';

const responsibilities = [
  {
    data: '學校接入與服務開通',
    owner: '校方申請窗口與平台管理員',
    student: '依學校開通狀態使用服務',
    platform: '審核接入申請、編輯學校資料與服務設定、確認開通或暫停',
  },
  {
    data: '校方管理員與職員授權',
    owner: '該校管理員與授權承辦人',
    student: '使用本人獲准的功能',
    platform: '查核各校授權名單、指派校方管理員或職員；已開通學校須先啟用限時代操作',
  },
  {
    data: '店家接入與公開目錄',
    owner: '店家申請人與校方店家管理人員',
    student: '查看已公開店家，依服務狀態點餐',
    platform: '審核合作意向與店家進件、查看目錄及公開狀態',
  },
  {
    data: '課班與學校的掛靠關係',
    owner: '建立課班的教師與申請學校',
    student: '使用已加入的課班',
    platform: '核對課班、目標學校與理由後，核准或拒絕掛靠申請',
  },
  {
    data: '公開交流看板與內容檢舉',
    owner: '公開看板管理者與內容作者',
    student: '閱讀、發文、提出檢舉',
    platform: '建立公開看板，核對被檢舉內容後隱藏貼文或駁回檢舉',
  },
  {
    data: '平台營運操作紀錄',
    owner: '執行操作的管理員',
    student: '依各項服務查看自己的處理結果',
    platform: '查核本次載入紀錄中的操作者、學校、處理理由與變更內容',
  },
];

export function AdminResponsibilities({
  onNavigate,
}: {
  onNavigate: (section: AdminSection) => void;
}) {
  return (
    <details className={styles.disclosure}>
      <summary>
        <h2>管理範圍與權責</h2>
      </summary>
      <div className={styles.disclosureBody}>
        <p className={styles.notice}>
          這個工作台處理跨校接入、授權、店家申請與公開內容。每項操作先確認對象與學校，
          再依目前有效的授權送出，結果可到操作紀錄查核。
        </p>
        <div
          className={styles.tableWrap}
          role="region"
          aria-label="管理範圍與權責對照"
          tabIndex={0}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">資料與工作</th>
                <th scope="col">日常負責人</th>
                <th scope="col">使用者</th>
                <th scope="col">本工作台提供</th>
              </tr>
            </thead>
            <tbody>
              {responsibilities.map((row) => (
                <tr key={row.data}>
                  <th scope="row">{row.data}</th>
                  <td>{row.owner}</td>
                  <td>{row.student}</td>
                  <td>{row.platform}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.muted}>
          校園公告由該校授權的管理員或內容編輯者，以校園帳號進入公告工作區發布。
          正式學籍、成績、個人案件與私人資料依各校及資料本人的授權處理，這個工作台不提供內容存取。
          課班掛靠只建立課班與學校的關係，正式選課與學籍仍由校方管理。
        </p>
        <div className={styles.actions}>
          <Button onClick={() => onNavigate('people')}>查各校負責人與授權</Button>
          <Button onClick={() => onNavigate('audit')}>查操作紀錄</Button>
        </div>
      </div>
    </details>
  );
}
