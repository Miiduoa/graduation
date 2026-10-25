'use client';

import { Button } from '@/components/ui/Button';
import type { AdminSection } from './adminNav';
import styles from './Admin.module.css';

const responsibilities = [
  {
    data: '正式學籍、成績與校務設定',
    owner: '校方負責單位與經指派的承辦人',
    student: '查看本人資料、提出更正申請',
    platform: '跨校掌握開通、授權與異常；正式資料依校方串接範圍提供',
  },
  {
    data: '課程教材、作業與評量',
    owner: '該課程的負責老師與受指派的共同授課者',
    student: '繳交本人作業、查看自己的作答與回饋',
    platform: '追溯課程授權與治理紀錄，協助處理權限爭議',
  },
  {
    data: '請假、證件、報修、包裹、列印與健康案件',
    owner: '校方指派的各業務承辦人',
    student: '送件、補件與查看本人案件',
    platform: '跨校掌握服務狀態、負責人、異常與處理紀錄',
  },
  {
    data: '校園公告、活動與公開內容',
    owner: '校方授權的內容編輯者',
    student: '閱讀、報名、參與及提出檢舉',
    platform: '跨校檢舉處理與內容治理',
  },
  {
    data: '店家、訂單與取餐',
    owner: '校方店家管理人員與該店授權操作者',
    student: '處理自己的訂單與取餐',
    platform: '跨校查看店家接入、營運方式、公開狀態與異常',
  },
  {
    data: '私人筆記、個人行程與個人匯入資料',
    owner: '資料本人；送交校方的內容依案件授權處理',
    student: '編輯、匯出或刪除自己的個人資料',
    platform: '掌握服務與治理紀錄；個案內容存取須有授權與稽核',
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
          平台管理員負責跨校治理；校方管理員指派本校人員；承辦人只處理被授權的業務；
          老師依課程授權管理教學。內容編輯權限只涵蓋內容工作，授課或承辦資格需另行指派。
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
                <th scope="col">學生本人</th>
                <th scope="col">平台全覽</th>
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
          個人匯入的課表與成績保留原始來源，由本人確認；正式學籍、正式成績及校務核准結果由校方發布。
          校務功能依學校正式開通與授權狀態提供。平台帳號與校方帳號目前分別驗證。
        </p>
        <div className={styles.actions}>
          <Button onClick={() => onNavigate('people')}>查各校負責人與授權</Button>
          <Button onClick={() => onNavigate('audit')}>查操作紀錄</Button>
        </div>
      </div>
    </details>
  );
}
