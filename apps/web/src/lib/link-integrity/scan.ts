import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function files(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.join(root, entry.name);
      return entry.isDirectory() ? files(name) : [name];
    })
    .sort();
}

export type InternalLink = { file: string; line: number; target: string };

// 這些既有 helper／變數只附加查詢字串，不改變頁面路徑。
function querySuffix(node: ts.Expression): boolean {
  return (
    /^(schoolSearch|search|queryString)$/.test(node.getText()) ||
    (ts.isCallExpression(node) && node.expression.getText() === 'redirectQuery') ||
    (ts.isConditionalExpression(node) && /['"`]\?/.test(node.getText()))
  );
}

export function extractLinks(source: string, file: string): InternalLink[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const links: InternalLink[] = [];
  const navigationCall =
    /^(?:(?:router|window\.location|location)\.(?:push|replace|assign)|redirect|permanentRedirect|window\.open|appendSchoolContext|withSchoolContext|academicLabel|lmsLabel|campusServiceHref|loginHref|route|href|replaceServiceListQuery|useServiceListQuery)$/;
  const referenced = new Set<string>();
  const declarations = new Map<string, ts.Expression>();
  function identifiers(node: ts.Node) {
    if (ts.isIdentifier(node)) referenced.add(node.text);
    ts.forEachChild(node, identifiers);
  }
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      declarations.set(node.name.text, node.initializer);
    if (
      ts.isJsxAttribute(node) &&
      /^(href|to|action|returnUrl)$/.test(node.name.getText(tree)) &&
      node.initializer
    )
      identifiers(node.initializer);
    if (
      ts.isCallExpression(node) &&
      navigationCall.test(node.expression.getText(tree)) &&
      node.arguments[0]
    )
      identifiers(node.arguments[0]);
    ts.forEachChild(node, collect);
  }
  collect(tree);
  // 追溯同檔常數與中間變數；不執行產品程式碼。
  let previous = -1;
  while (previous !== referenced.size) {
    previous = referenced.size;
    for (const name of referenced) {
      const initializer = declarations.get(name);
      if (initializer) identifiers(initializer);
    }
  }
  function visit(node: ts.Node) {
    let target: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) target = node.text;
    if (ts.isTemplateExpression(node)) {
      target =
        node.head.text +
        node.templateSpans
          .map(
            (span) => `${querySuffix(span.expression) ? '?' : '__dynamic__'}${span.literal.text}`,
          )
          .join('');
    }
    if (target?.startsWith('/') && !target.startsWith('//')) {
      let navigation = false;
      for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
        if (
          ts.isJsxAttribute(parent) &&
          /^(href|to|action|returnUrl)$/.test(parent.name.getText(tree))
        )
          navigation = true;
        if (
          ts.isPropertyAssignment(parent) &&
          /^(.*Href|href|path|route|to)$/.test(parent.name.getText(tree).replace(/['"]/g, ''))
        )
          navigation = true;
        if (
          ts.isCallExpression(parent) &&
          parent.arguments[0] === node &&
          navigationCall.test(parent.expression.getText(tree))
        )
          navigation = true;
        if (
          ts.isVariableDeclaration(parent) &&
          (/(?:href|path|route|url)$/i.test(parent.name.getText(tree)) ||
            referenced.has(parent.name.getText(tree)))
        )
          navigation = true;
        if (ts.isBinaryExpression(parent) && /location\.href$/.test(parent.left.getText(tree)))
          navigation = true;
        if (ts.isReturnStatement(parent) && /(?:link|navigation|destination)/i.test(file))
          navigation = true;
        if (ts.isStatement(parent)) break;
      }
      if (navigation)
        links.push({
          file,
          line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
          target,
        });
    }
    if (ts.isTemplateExpression(node)) {
      // 插值屬於外層目標的資料，避免把 returnUrl 或外部 URL 片段當成另一個站內入口。
      return;
    }
    // 模板片段由外層模板統一處理。
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return links;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function appRoute(file: string): string {
  return (
    '/' +
    file
      .split('/')
      .slice(0, -1)
      .filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith('@'))
      .join('/')
  );
}
export function matchesRoute(target: string, route: string): boolean {
  const segments = route
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (/^\[\[\.\.\..+\]\]$/.test(part)) return '(?:/[^/]+)*';
      if (/^\[\.\.\..+\]$/.test(part)) return '(?:/[^/]+)+';
      if (/^\[.+\]$/.test(part)) return '/[^/]+';
      if (/^:\w+\*$/.test(part)) return '(?:/[^/]+)*';
      if (/^:\w+$/.test(part)) return '/[^/]+';
      return '/' + escape(part);
    });
  return new RegExp('^' + (segments.join('') || '/') + '/?$').test(target.split(/[?#]/)[0]);
}
