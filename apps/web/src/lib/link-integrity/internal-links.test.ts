// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { STUDENT_ACADEMIC_SECTIONS } from '@campus/shared/src/academicSections';
import { legacyRewrites } from '../legacy-routing';
import { appRoute, extractLinkCandidates, extractLinks, files, matchesRoute } from './scan';

const root = path.resolve(import.meta.dirname, '../..');
// 每個例外都限制來源與目標；新增來源也必須重新審查。
const allowed: { file: string; target: string; reason: string }[] = [];

export async function audit() {
  const routes = files(path.join(root, 'app'))
    .filter((file) => /\/(page|route)\.[jt]sx?$/.test(file))
    .map((file) => appRoute(path.relative(path.join(root, 'app'), file)));
  const redirects = await nextConfig.redirects!();
  const legacy = legacyRewrites(true);
  const candidates = files(root)
    .filter(
      (file) =>
        /\.[jt]sx?$/.test(file) &&
        !/\.(test|spec)\./.test(file) &&
        !file.includes('/link-integrity/'),
    )
    .map((file) => extractLinkCandidates(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
  const links = candidates.flatMap((item) => item.links);
  const unknown = candidates.flatMap((item) => item.unknown);
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
  return { links, unknown, routes, broken: links.filter((link) => !resolves(link.target)) };
}

describe('站內連結完整性', () => {
  // CI 全庫 coverage 下曾耗時 17.4 秒；僅延長掃描期限，不變更斷鏈斷言。
  it('所有導航連結都有頁面、端點、靜態檔或已知導向', async () => {
    const { broken, links, unknown, routes } = await audit();
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
        `# 站內連結盤點\n\n掃描 apps/web/src 的正式程式碼，共 ${links.length} 筆導航路徑、${routes.length} 個頁面／端點；未列例外的不存在路由 ${broken.filter((link) => !allowed.some((item) => item.file === link.file && item.target === link.target)).length} 筆。\n\n按來源及目標推定主要角色，共用入口歸學生；這不是權限驗證。包含共用課務設定 webPath、next.config redirects、啟用時的 legacy rewrites 與 public 靜態檔。legacy 端點僅代表既有路由契約，不保證未啟用 legacy 時可用。\n\n本次沒有能確認的錯字或改名斷鏈，因此沒有修改產品入口。僅因變數名稱含 path／url 的非導航常數不再納入；目前沒有需要保留的外部端點例外。\n\n靜態分析從 href、明確設定欄位及導航呼叫的完整表達式遞迴解析條件式、邏輯式、模板、拼接與同作用域變數；動態值獨佔路徑段時以佔位值比對。未知計算、循環引用與無法判定的動態後綴另列未知，不判斷斷鏈。執行期 API／使用者資料提供的完整網址、任意跨檔函式計算結果不在靜態證明範圍，亦未驗證每筆動態資源存在或角色授權。\n\n重建：\`EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null LINK_INTEGRITY_REPORT=1 pnpm --filter web exec vitest run src/lib/link-integrity/internal-links.test.ts\`\n\n${unknown.length} 筆目標無法靜態推導，列為未知、不判斷斷鏈。\n\n| 來源 | 結果 |\n| --- | --- |\n${unknown.map((item) => `| ${item.file}:${item.line} | 未知：${item.reason} |`).join('\n')}\n\n${sections.join('\n\n')}\n`,
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
  }, 60_000);
  it('遞迴解析導航呼叫、href、邏輯分支與動態拼接', () => {
    const { links, unknown } = extractLinkCandidates(
      `
      router.push(ok ? '/missing-a' : '/missing-b');
      router.push('/course/' + id);
      const href = '/course/' + id; const alias = href; router.push(alias);
      const view = <Link href={ready && ('/course/' + id)}/>;
      router.replace(fallback || '/fallback');
      redirect(destination ?? '/default');
      router.push(appendSchoolContext('/missing', schoolId));
      const url = \`/course/\${ok ? '?tab=a' : '/missing'}\`; router.push(url);
    `,
      'fixture.tsx',
    );
    expect(links.map((link) => link.target)).toEqual([
      '/missing-a',
      '/missing-b',
      '/course/__dynamic__',
      '/course/__dynamic__',
      '/course/__dynamic__',
      '/fallback',
      '/default',
      '/missing',
      '/missing',
      '/course/?tab=a',
      '/course//missing',
    ]);
    expect(unknown).toHaveLength(3);
    expect(matchesRoute('/course/__dynamic__', '/course/[id]')).toBe(true);
  });
  it('只解析導航資料流或設定欄位，並遵守變數作用域', () => {
    expect(
      extractLinks("const path = '/tmp/export.csv'; fs.writeFileSync(path, data);", 'fixture.tsx'),
    ).toEqual([]);
    expect(
      extractLinks(
        `const destination = '/missing'; router.push(destination);
      function unused() { const destination = '/classroom'; }
      function local(destination: string) { router.push(destination); }
    `,
        'fixture.tsx',
      ).map((link) => link.target),
    ).toEqual(['/missing']);
  });
  it('可變導航變數與其別名一律列未知，不使用初始值', () => {
    const result = extractLinkCandidates(
      `
      let destination = '/classroom'; destination = '/missing-reassigned'; router.push(destination);
      let reverse = '/missing-initial'; reverse = '/classroom'; router.push(reverse);
      let unchanged = '/classroom'; router.push(unchanged);
      let conditional = '/classroom'; if (ok) conditional = '/missing';
      const alias = conditional; router.push(alias);
      let compound = '/classroom'; compound += '/missing'; router.push(compound);
      var legacy = '/classroom'; router.push(legacy);
    `,
      'fixture.tsx',
    );
    expect(result.links).toEqual([]);
    expect(result.unknown).toHaveLength(6);
  });
  it('偵測直接、解構、複合、遞增與迴圈寫入，且不混淆同名符號', () => {
    const result = extractLinkCandidates(
      `
      const direct = '/classroom'; direct = '/missing'; router.push(direct);
      const destructured = '/classroom'; [destructured] = values; router.push(destructured);
      const compound = '/classroom'; compound += suffix; router.push(compound);
      const incremented = '/classroom'; incremented++; router.push(incremented);
      const looped = '/classroom'; for (looped of values) {} router.push(looped);
      const outer = '/classroom';
      function local() { let outer = '/missing'; outer = '/other'; }
      router.push(outer);
    `,
      'fixture.tsx',
    );
    expect(result.links.map((link) => link.target)).toEqual(['/classroom']);
    expect(result.unknown).toHaveLength(5);
  });
  it('已知左值遵守或、且、空值的短路語意', () => {
    const result = extractLinkCandidates(
      `
      const fallback = '/missing-unused';
      const target = '/classroom'; const alias = target;
      router.push('/classroom' || fallback);
      router.push(alias || fallback);
      router.push('' || '/classroom');
      router.push(false && fallback);
      router.push(true && '/classroom');
      router.push(null ?? '/classroom');
      router.push((void 0) ?? '/classroom');
      router.push('' ?? fallback);
      router.push(0 ?? fallback);
      router.push(target ?? fallback);
      router.push(target && '/classroom');
      router.push(false || '/classroom');
    `,
      'fixture.tsx',
    );
    expect(result.links.map((link) => link.target)).toEqual(Array(9).fill('/classroom'));
    expect(result.unknown).toEqual([]);
  });
  it('未知計算與循環不會被當成字串片段或斷鏈', () => {
    const result = extractLinkCandidates(
      `
      router.push('/course/' + computeId());
      const a = b; const b = a; router.push(a);
      const view = <Link href={computeUrl('/fragment')}/>;
    `,
      'fixture.tsx',
    );
    expect(result.links).toEqual([]);
    expect(result.unknown).toHaveLength(3);
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
