"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { findSchoolsByCode, mockSchools, normalizeSchoolCode } from "@campus/shared/src/schools";

export default function JoinSchoolPage() {
  const router = useRouter();
  const [code, setCode] = useState("NCHU");

  const normalized = useMemo(() => normalizeSchoolCode(code), [code]);
  const matches = useMemo(() => findSchoolsByCode(normalized), [normalized]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h2>加入學校</h2>
      <p style={{ opacity: 0.8 }}>
        請輸入學校縮寫代碼（A-Z0-9，3~10碼）。若代碼撞碼，系統會請你選正確的學校。
      </p>

      <label style={{ display: "block", marginTop: 12 }}>學校代碼</label>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="例如 NCHU"
        style={{ padding: 10, width: "100%", fontSize: 16 }}
      />

      <div style={{ marginTop: 12 }}>
        {normalized.length === 0 ? (
          <div style={{ opacity: 0.7 }}>請輸入代碼</div>
        ) : matches.length === 0 ? (
          <div style={{ opacity: 0.7 }}>找不到此代碼（你可以先用 DEMO 測試）</div>
        ) : matches.length === 1 ? (
          <div style={{ opacity: 0.9 }}>將加入：{matches[0].name}</div>
        ) : (
          <div>
            <div style={{ fontWeight: 700 }}>找到多所學校使用相同代碼：{normalized}</div>
            <div style={{ opacity: 0.75, marginTop: 6 }}>
              請選擇你的學校（越詳細越清楚，後續會加：城市/國家/官網/校徽）。
            </div>
            <ul style={{ marginTop: 10 }}>
              {matches.map((s) => (
                <li key={s.id} style={{ marginBottom: 10 }}>
                  <button
                    style={{ padding: 10, fontSize: 16 }}
                    onClick={() => {
                      router.push(`/?school=${encodeURIComponent(s.code)}&schoolId=${encodeURIComponent(s.id)}`);
                    }}
                  >
                    {s.name}
                  </button>
                  <div style={{ opacity: 0.65, fontSize: 12, marginTop: 4 }}>
                    code: <code>{s.code}</code> ｜ id: <code>{s.id}</code>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {matches.length === 1 && (
        <button
          style={{ marginTop: 16, padding: 12, fontSize: 16 }}
          onClick={() => {
            const s = matches[0];
            router.push(`/?school=${encodeURIComponent(s.code)}&schoolId=${encodeURIComponent(s.id)}`);
          }}
        >
          繼續
        </button>
      )}

      <hr style={{ margin: "24px 0" }} />
      <div style={{ opacity: 0.85 }}>
        <div>示範資料（目前寫死在 mockSchools）：</div>
        <ul>
          {mockSchools.map((s) => (
            <li key={s.id}>
              <code>{s.code}</code> - {s.name}（id: {s.id}）
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
