import Link from "next/link";

export function SiteShell(props: {
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">畢業專題｜校園平台</div>
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

        <nav className="nav">
          <Link href="/">首頁</Link>
          <Link href="/announcements">公告</Link>
          <Link href="/clubs">活動</Link>
          <Link href="/map">地圖</Link>
          <Link href="/cafeteria">餐廳</Link>
          <Link href="/join" className="navCta">
            加入/切換學校
          </Link>
        </nav>
      </header>

      <main className="main">
        {props.title ? (
          <div className="pageHead">
            <h1 className="h1">{props.title}</h1>
            {props.subtitle ? <p className="sub">{props.subtitle}</p> : null}
          </div>
        ) : null}

        {props.children}
      </main>

      <footer className="footer">
        <span>© 畢業專題（MVP）</span>
      </footer>
    </div>
  );
}
