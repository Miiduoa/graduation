"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { findSchoolsByCode, mockSchools, normalizeSchoolCode } from "@campus/shared/src/schools";
import { SiteShell } from "@/components/SiteShell";

export default function JoinSchoolPage() {
  const router = useRouter();
  const [code, setCode] = useState("NCHU");

  const normalized = useMemo(() => normalizeSchoolCode(code), [code]);
  const matches = useMemo(() => findSchoolsByCode(normalized), [normalized]);
  const singleMatch = matches.length === 1 ? matches[0] : null;

  const handleSelectSchool = (schoolId: string, schoolCode: string) => {
    router.push(`/?school=${encodeURIComponent(schoolCode)}&schoolId=${encodeURIComponent(schoolId)}`);
  };

  return (
    <SiteShell
      title="加入學校"
      subtitle="輸入學校代碼，或直接從示範清單進入對應校園。"
    >
      <div className="pageStack">
        <section className="card sectionCard">
          <div className="sectionHead">
            <div className="sectionCopy">
              <p className="sectionEyebrow">School Access</p>
              <h2 className="sectionTitle">先確認你要進入哪一個校園</h2>
              <p className="sectionText">
                代碼支援 A-Z 與數字，若有多校撞碼，系統會先列出可選項再進入首頁。
              </p>
            </div>
          </div>

          <div className="pageStack" style={{ gap: 16 }}>
            <label className="kv" htmlFor="school-code">
              學校代碼
            </label>
            <input
              id="school-code"
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例如 NCHU"
            />

            {normalized.length === 0 ? (
              <div className="emptyState">
                <div className="emptyIcon">⌨️</div>
                <p className="emptyTitle">請先輸入代碼</p>
                <p className="emptyBody">輸入後會立即比對符合的學校。</p>
              </div>
            ) : matches.length === 0 ? (
              <div className="emptyState">
                <div className="emptyIcon">🏫</div>
                <p className="emptyTitle">找不到這個代碼</p>
                <p className="emptyBody">可以先使用示範學校，或確認輸入的縮寫是否正確。</p>
              </div>
            ) : singleMatch ? (
              <div className="surfaceItem">
                <div className="surfaceAccent">✓</div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">將加入 {singleMatch.name}</h3>
                  <p className="surfaceMeta">
                    code: <code>{singleMatch.code}</code> ｜ id: <code>{singleMatch.id}</code>
                  </p>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => handleSelectSchool(singleMatch.id, singleMatch.code)}
                >
                  繼續
                </button>
              </div>
            ) : (
              <div className="sectionCard">
                <div className="sectionCopy">
                  <h3 className="sectionTitle">找到多所符合代碼 {normalized} 的學校</h3>
                  <p className="sectionText">請直接選擇正確校園，避免進入錯誤資料集。</p>
                </div>
                <div className="surfaceList">
                  {matches.map((school) => (
                    <button
                      key={school.id}
                      type="button"
                      className="surfaceItem"
                      onClick={() => handleSelectSchool(school.id, school.code)}
                    >
                      <div className="surfaceAccent">{school.code.slice(0, 2)}</div>
                      <div className="surfaceContent">
                        <h3 className="surfaceTitle">{school.name}</h3>
                        <p className="surfaceMeta">
                          code: <code>{school.code}</code> ｜ id: <code>{school.id}</code>
                        </p>
                      </div>
                      <span className="statusBadge" style={{ "--status-bg": "var(--accent-soft)" } as React.CSSProperties}>
                        進入
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card sectionCard">
          <div className="sectionHead">
            <div className="sectionCopy">
              <p className="sectionEyebrow">School Directory</p>
              <h2 className="sectionTitle">可直接使用的學校目錄</h2>
              <p className="sectionText">這份代碼與學校對照表會同步套用在登入、搜尋與各功能頁的學校切換流程。</p>
            </div>
          </div>

          <div className="surfaceGrid">
            {mockSchools.map((school) => (
              <button
                key={school.id}
                type="button"
                className="surfaceItem"
                onClick={() => handleSelectSchool(school.id, school.code)}
              >
                <div className="surfaceAccent">{school.code.slice(0, 2)}</div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">{school.name}</h3>
                  <p className="surfaceMeta">
                    <code>{school.code}</code> ｜ <code>{school.id}</code>
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
