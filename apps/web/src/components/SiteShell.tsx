"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PWAInstallBanner } from "./PWAInstallBanner";
import { OfflineBanner } from "./OfflineBanner";
import { UpdateBanner } from "./UpdateBanner";

function SiteShellInner(props: {
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const school = searchParams.get("school") || "";
  const schoolId = searchParams.get("schoolId") || "";
  const q = school ? `?school=${encodeURIComponent(school)}&schoolId=${encodeURIComponent(schoolId)}` : "";

  const navItems = [
    { href: "/", label: "首頁", group: "primary" as const },
    { href: "/announcements", label: "公告", group: "primary" as const },
    { href: "/clubs", label: "活動", group: "primary" as const },
    { href: "/timetable", label: "課表", group: "primary" as const },
    { href: "/map", label: "地圖", group: "primary" as const },
    { href: "/cafeteria", label: "餐廳", group: "secondary" as const },
    { href: "/bus", label: "公車", group: "secondary" as const },
    { href: "/library", label: "圖書館", group: "secondary" as const },
    { href: "/grades", label: "成績", group: "secondary" as const },
    { href: "/groups", label: "群組", group: "secondary" as const },
  ];
  const primaryNav = navItems.filter((item) => item.group === "primary");
  const secondaryNav = navItems.filter((item) => item.group === "secondary");
  const mobileNav = [
    { href: "/", label: "首頁" },
    { href: "/announcements", label: "公告" },
    { href: "/timetable", label: "課表" },
    { href: "/map", label: "地圖" },
    { href: "/profile", label: "個人" },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      <OfflineBanner />
      <div className="shell">
        <header className="topbar">
          <div className="topbarGlass">
            <div className="topbarRow">
              <div className="brandCluster">
                <Link href={`/${q}`} className="brandLink">
                  <span className="brandMark">C1</span>
                  <div className="brand">
                    <span className="brandEyebrow">Campus One</span>
                    <span className="brandTitle">校園助手</span>
                  </div>
                </Link>
                <div className="brandMeta">
                  {props.schoolName ? (
                    <>
                      <span className="pill">{props.schoolName}</span>
                      {props.schoolCode ? <span className="pill subtle">{props.schoolCode}</span> : null}
                    </>
                  ) : (
                    <span className="pill subtle">尚未選擇學校</span>
                  )}
                </div>
              </div>

              <div className="topbarRight">
                <Link href={`/search${q}`} className="iconBtn" title="搜尋">
                  搜尋
                </Link>
                <Link href={`/settings${q}`} className="iconBtn" title="設定">
                  設定
                </Link>
                <Link href={`/profile${q}`} className="iconBtn" title="個人檔案">
                  個人
                </Link>
              </div>
            </div>

            <div className="navClusters">
              <nav className="nav navPrimary" aria-label="主要導覽">
                {primaryNav.map((item) => (
                  <Link
                    key={item.href}
                    href={`${item.href}${q}`}
                    className={`navLink${isActive(item.href) ? " active" : ""}`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>

              <div className="navSecondaryCluster">
                <nav className="nav navSecondary" aria-label="次要導覽">
                  {secondaryNav.map((item) => (
                    <Link
                      key={item.href}
                      href={`${item.href}${q}`}
                      className={`navLink secondary${isActive(item.href) ? " active" : ""}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <Link href={`/join${q}`} className="navCta">
                  切換學校
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="main">
          {props.title ? (
            <div className="pageHead">
              <div className="pageHeadCopy">
                <div className="pageHeadEyebrow">Campus Companion</div>
                <h1 className="h1">{props.title}</h1>
                {props.subtitle ? <p className="sub">{props.subtitle}</p> : null}
              </div>
              <div className="pageHeadMeta">
                <span className="pill">{props.schoolName ?? "多校通用"}</span>
                <span className="pill subtle">{props.schoolCode ?? "極簡卡片介面"}</span>
              </div>
            </div>
          ) : null}

          {props.children}
        </main>

        <footer className="footer">
          <div className="shellActions">
            <span>© 2026 Campus One</span>
            <span>Soft UI 校園儀表板</span>
            <a href="#" className="footerLink">關於我們</a>
            <a href="#" className="footerLink">隱私政策</a>
            <a href="#" className="footerLink">聯絡我們</a>
          </div>
        </footer>

        <nav className="mobileDock" aria-label="行動版導覽">
          {mobileNav.map((item) => (
            <Link
              key={item.href}
              href={`${item.href}${q}`}
              className={`mobileDockLink${isActive(item.href) ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <PWAInstallBanner />
      <UpdateBanner />
    </>
  );
}

export function SiteShell(props: {
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={
      <div className="shell">
        <header className="topbar">
          <div className="topbarGlass">
            <div className="topbarRow">
              <div className="brandCluster">
                <div className="brandLink">
                  <span className="brandMark">C1</span>
                  <div className="brand">
                    <span className="brandEyebrow">Campus One</span>
                    <span className="brandTitle">校園助手</span>
                  </div>
                </div>
                <div className="brandMeta">
                  <span className="pill subtle">載入中...</span>
                </div>
              </div>
            </div>
          </div>
        </header>
        <main className="main">
          <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
            載入中...
          </div>
        </main>
      </div>
    }>
      <SiteShellInner {...props} />
    </Suspense>
  );
}
