"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { mockSchools } from "@campus/shared/src/schools";

export default function JoinSchoolPage() {
  const router = useRouter();
  const [code, setCode] = useState("DEMO");

  const hint = useMemo(() => {
    const c = code.trim().toUpperCase();
    const found = mockSchools.find((s) => s.code === c);
    return found ? `將加入：${found.name}` : "找不到此學校代碼（仍可先用 DEMO）";
  }, [code]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 520 }}>
      <h2>加入學校</h2>
      <p style={{ opacity: 0.75 }}>
        平台型（多校通用）模式：輸入學校代碼加入。之後可改成掃 QR / 搜尋。
      </p>

      <label style={{ display: "block", marginTop: 12 }}>學校代碼</label>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="例如 DEMO"
        style={{ padding: 10, width: "100%", fontSize: 16 }}
      />

      <div style={{ marginTop: 8, opacity: 0.8 }}>{hint}</div>

      <button
        style={{ marginTop: 16, padding: 12, fontSize: 16 }}
        onClick={() => {
          const c = code.trim().toUpperCase() || "DEMO";
          router.push(`/?school=${encodeURIComponent(c)}`);
        }}
      >
        繼續
      </button>

      <hr style={{ margin: "20px 0" }} />
      <div style={{ opacity: 0.8 }}>
        <div>示範代碼：</div>
        <ul>
          {mockSchools.map((s) => (
            <li key={s.id}>
              <code>{s.code}</code> - {s.name}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
