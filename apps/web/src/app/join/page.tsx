"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteShell } from "@/components/SiteShell";

interface School {
  id: string;
  name: string;
  shortName: string;
  city: string;
  type: "national" | "private" | "technical";
  icon: string;
}

const SCHOOLS: School[] = [
  { id: "ntust", name: "國立臺灣科技大學", shortName: "台科大", city: "台北", type: "national", icon: "🔬" },
  { id: "ntu", name: "國立臺灣大學", shortName: "台大", city: "台北", type: "national", icon: "🌿" },
  { id: "nthu", name: "國立清華大學", shortName: "清大", city: "新竹", type: "national", icon: "⚛️" },
  { id: "nctu", name: "國立陽明交通大學", shortName: "陽交大", city: "新竹", type: "national", icon: "⚡" },
  { id: "ncu", name: "國立中央大學", shortName: "中央", city: "桃園", type: "national", icon: "🏔" },
  { id: "ncku", name: "國立成功大學", shortName: "成大", city: "台南", type: "national", icon: "🌅" },
];

const TYPE_LABELS = { national: "國立", private: "私立", technical: "科技大學" };

export default function JoinPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<School | null>(null);

  const filtered = SCHOOLS.filter(
    (s) =>
      !search ||
      s.name.includes(search) ||
      s.shortName.includes(search) ||
      s.city.includes(search)
  );

  const handleConfirm = () => {
    if (!selected) return;
    const q = `?school=${encodeURIComponent(selected.name)}&schoolId=${encodeURIComponent(selected.id)}`;
    router.push(`/${q}`);
  };

  return (
    <SiteShell>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="pageStack">
          {/* ── Hero ── */}
          <div
            className="card"
            style={{
              background: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
              border: "none",
              color: "#fff",
              textAlign: "center",
              padding: "32px 24px",
              boxShadow: "6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)",
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 12 }}>🏫</div>
            <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em" }}>
              選擇您的學校
            </h1>
            <p style={{ margin: 0, fontSize: 14, opacity: 0.82 }}>
              選擇學校以獲取個人化校園資訊與服務
            </p>
          </div>

          {/* ── Search ── */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 17, opacity: 0.5, pointerEvents: "none" }}>🔍</span>
            <input
              className="input"
              type="search"
              placeholder="搜尋學校名稱或城市…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 40 }}
            />
          </div>

          {/* ── School List ── */}
          <div className="insetGroup">
            {filtered.map((school, i) => (
              <button
                key={school.id}
                onClick={() => setSelected(school)}
                className="insetGroupRow"
                style={{
                  borderTop: i === 0 ? "none" : undefined,
                  width: "100%",
                  background: selected?.id === school.id ? "var(--accent-soft)" : "var(--surface)",
                  cursor: "pointer",
                  border: "none",
                  textAlign: "left",
                }}
              >
                <div
                  className="insetGroupRowIcon"
                  style={{ fontSize: 22, background: selected?.id === school.id ? "rgba(94,106,210,0.15)" : "var(--panel)" }}
                >
                  {school.icon}
                </div>
                <div className="insetGroupRowContent">
                  <div
                    className="insetGroupRowTitle"
                    style={{ color: selected?.id === school.id ? "var(--brand)" : "var(--text)" }}
                  >
                    {school.name}
                  </div>
                  <div className="insetGroupRowMeta">
                    {school.city} · {TYPE_LABELS[school.type]}
                  </div>
                </div>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "2px solid",
                    borderColor: selected?.id === school.id ? "var(--brand)" : "var(--border)",
                    background: selected?.id === school.id ? "var(--brand)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  {selected?.id === school.id && (
                    <span style={{ fontSize: 12, color: "#fff", lineHeight: 1 }}>✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* ── Confirm Button ── */}
          <button
            className="btn primary"
            onClick={handleConfirm}
            disabled={!selected}
            style={{ width: "100%", minHeight: 52, fontSize: 16 }}
          >
            {selected ? `進入 ${selected.shortName} →` : "請選擇學校"}
          </button>

          <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", margin: 0 }}>
            找不到您的學校？
            <span style={{ color: "var(--brand)", fontWeight: 600, cursor: "pointer", marginLeft: 4 }}>
              申請加入
            </span>
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
