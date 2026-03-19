"use client";

import dynamic from "next/dynamic";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import { PageLoadingCard } from "@/components/PageLoadingCard";

// 使用 dynamic import 並關閉 SSR（Leaflet 需要 browser API）
const MapClient = dynamic(() => import("./MapClient"), {
  ssr: false,
  loading: () => <PageLoadingCard message="地圖載入中..." />,
});

export default function MapPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolId, schoolName } = resolveSchoolPageContext(props.searchParams);

  return (
    <SiteShell title="校園地圖" subtitle="互動地圖 · 探索校園各設施" schoolName={schoolName}>
      <MapClient school={schoolId} />
    </SiteShell>
  );
}
