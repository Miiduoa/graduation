// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { STUDENT_ACADEMIC_SECTIONS } from '@campus/shared/src/academicSections';
import { legacyRewrites } from '../legacy-routing';
import { appRoute, extractLinks, files, matchesRoute } from './scan';

const root = path.resolve(import.meta.dirname, '../..');
// 每個例外都限制來源與目標；新增來源也必須重新審查。
const allowed: { file: string; target: string; reason: string }[] = [
  {
    file: 'app/account-deletion/status/deletionStatus.ts',
    target: '/v1/public/privacy/deletion-status',
    reason: '外部 Nuni API 的相對端點，呼叫時組合 NUNI_API_ORIGIN，並非本站頁面。',
  },
  {
    file: 'app/account-deletion/status/deletionStatus.ts',
    target: '/v1/public/privacy/deletion-status/revoke',
    reason: '外部 Nuni API 的撤銷端點，呼叫時組合 NUNI_API_ORIGIN，並非本站頁面。',
  },
  {
    file: 'lib/transit-transfer.ts',
    target: '/api/maas/routing',
    reason: 'TDX MaaS 旅運規劃端點，交由交通代理組合外部來源，並非本站頁面。',
  },
];

export async function audit() {
  const routes = files(path.join(root, 'app'))
    .filter((file) => /\/(page|route)\.[jt]sx?$/.test(file))
    .map((file) => appRoute(path.relative(path.join(root, 'app'), file)));
  const redirects = await nextConfig.redirects!();
  const legacy = legacyRewrites(true);
  const links = files(root)
    .filter(
      (file) =>
        /\.[jt]sx?$/.test(file) &&
        !/\.(test|spec)\./.test(file) &&
        !file.includes('/link-integrity/'),
    )
    .flatMap((file) => extractLinks(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
  links.push(
    ...STUDENT_ACADEMIC_SECTIONS.map((section) => ({
      file: 'lib/academicSections.ts',
      line: 4,
      target: section.webPath,
    })),
  );
  function resolves(target: string, seen = new Set<string>()): boolean {
    if (seen.has(target)) return false;
    seen.add(target);
    const rule = redirects.find((rule) => matchesRoute(target, rule.source));
    if (rule) {
      if (/^https?:\/\//.test(rule.destination)) return true;
      return resolves(rule.destination.replace(/:\w+\*?/g, '__dynamic__'), seen);
    }
    return (
      routes.some((route) => matchesRoute(target, route)) ||
      [...legacy.beforeFiles, ...legacy.fallback].some((rule) =>
        matchesRoute(target, rule.source),
      ) ||
      (!target.includes('__dynamic__') &&
        fs.existsSync(path.join(root, '../public', target.split(/[?#]/)[0])))
    );
  }
  return { links, routes, broken: links.filter((link) => !resolves(link.target)) };
}

describe('站內連結完整性', () => {
  it('所有導航連結都有頁面、端點、靜態檔或已知導向', async () => {
    const { broken, links, routes } = await audit();
    if (process.env.LINK_INTEGRITY_REPORT === '1') {
      const roles = ['學生', '老師', '學校管理者', '店家', '營運'];
      const roleOf = (file: string, target: string) => {
        const text = file + ' ' + target;
        if (/lms-admin|SchoolReview|school-review/.test(text)) return '學校管理者';
        if (/features\/admin|features\/platform|\/admin(?:\/|$)/.test(text)) return '營運';
        if (/merchant|Merchant/.test(text)) return '店家';
        if (/teacher|Teacher|teaching|leave\/review/.test(text)) return '老師';
        return '學生';
      };
      const sections = roles.map((role) => {
        const rows = links.filter((link) => roleOf(link.file, link.target) === role);
        return (
          `## ${role}（${rows.length} 筆）\n\n| 來源 | 目標 | 結果 |\n| --- | --- | --- |\n` +
          rows
            .map((link) => {
              const exception = allowed.find(
                (item) => item.file === link.file && item.target === link.target,
              );
              return `| ${link.file}:${link.line} | ${link.target} | ${exception ? exception.reason : broken.includes(link) ? '不存在' : '有路由／已知導向／靜態檔'} |`;
            })
            .join('\n')
        );
      });
      fs.writeFileSync(
        path.join(root, '../../../docs/internal-link-integrity.md'),
        `# 站內連結盤點\n\n掃描 apps/web/src 的正式程式碼，共 ${links.length} 筆導航路徑、${routes.length} 個頁面／端點；未列例外的不存在路由 ${broken.filter((link) => !allowed.some((item) => item.file === link.file && item.target === link.target)).length} 筆。\n\n按來源及目標推定主要角色，共用入口歸學生；這不是權限驗證。包含共用課務設定 webPath、next.config redirects、啟用時的 legacy rewrites 與 public 靜態檔。legacy 端點僅代表既有路由契約，不保證未啟用 legacy 時可用。\n\n本次沒有能確認的錯字或改名斷鏈，因此沒有修改產品入口。外部端點以精確來源與目標列例外，均附理由；沒有以允許清單保留不存在的產品頁面。\n\n靜態分析涵蓋 href、設定路徑、路徑變數與導航呼叫；動態段以佔位值比對，已知查詢後綴只檢查頁面。執行期 API／使用者資料提供的完整網址、任意跨檔函式計算結果不在靜態證明範圍，亦未驗證每筆動態資源存在或角色授權。\n\n重建：\`EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null LINK_INTEGRITY_REPORT=1 pnpm --filter web exec vitest run src/lib/link-integrity/internal-links.test.ts\`\n\n${sections.join('\n\n')}\n`,
      );
    }
    expect(links.length).toBeGreaterThan(100);
    expect(
      broken.filter(
        (link) => !allowed.some((item) => item.file === link.file && item.target === link.target),
      ),
      JSON.stringify(broken, null, 2),
    ).toEqual([]);
    for (const item of allowed) {
      expect(item.reason.trim().length).toBeGreaterThan(10);
      expect(
        broken.some((link) => link.file === item.file && link.target === item.target),
        `已失效的例外：${item.file} ${item.target}`,
      ).toBe(true);
    }
  });
  it('涵蓋 JSX、設定、呼叫、動態模板與條件分支', () => {
    const links = extractLinks(
      "const menu = [{ href: '/typo' }, { path: '/menu' }]; const view = <Link href={ok ? '/yes' : `/course/${id}/missing`}/>; router.push('/gone');",
      'fixture.tsx',
    );
    expect(links.map((link) => link.target)).toEqual([
      '/typo',
      '/menu',
      '/yes',
      '/course/__dynamic__/missing',
      '/gone',
    ]);
    expect(
      extractLinks(
        "const destination = '/bad'; const next = destination; router.push(next);",
        'fixture.tsx',
      ).map((link) => link.target),
    ).toEqual(['/bad']);
    expect(matchesRoute('/course/123/missing', '/course/[id]')).toBe(false);
    expect(matchesRoute('/course/123?tab=x#part', '/course/[id]')).toBe(true);
    expect(matchesRoute('/a', '/a/[[...path]]')).toBe(true);
    expect(matchesRoute('/a', '/a/[...path]')).toBe(false);
    expect(matchesRoute('/old/a/b', '/old/:path*')).toBe(true);
    expect(appRoute('(group)/@slot/course/[id]/page.tsx')).toBe('/course/[id]');
  });
});
