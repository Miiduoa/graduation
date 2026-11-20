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

export type UnknownLink = { file: string; line: number; expression: string; reason: string };

export function extractLinkCandidates(source: string, file: string) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const links: InternalLink[] = [];
  const unknown: UnknownLink[] = [];
  const navigationCall =
    /^(?:(?:router|window\.location|location)\.(?:push|replace|assign)|redirect|permanentRedirect|window\.open|appendSchoolContext|withSchoolContext|academicLabel|lmsLabel|campusServiceHref|loginHref|route|href|replaceServiceListQuery|useServiceListQuery)$/;
  // 以符號查找同檔宣告，避免不同作用域的同名變數互相覆蓋。
  const program = ts.createProgram(
    [file],
    { noLib: true, noResolve: true },
    {
      ...ts.createCompilerHost({}),
      getSourceFile: (name) => (name === file ? tree : undefined),
    },
  );
  const checker = program.getTypeChecker();
  const written = new Set<ts.Symbol>();
  function markWritten(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) written.add(symbol);
    }
    ts.forEachChild(node, markWritten);
  }
  function findWrites(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      markWritten(node.left);
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    )
      markWritten(node.operand);
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    )
      markWritten(node.initializer);
    ts.forEachChild(node, findWrites);
  }
  findWrites(tree);
  // 不追蹤使用點的資料流；可變宣告一律未知，避免把初始值當成導航值。
  function constantInitializer(node: ts.Identifier): ts.Expression | undefined {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol && written.has(symbol)) return undefined;
    const declaration = symbol?.valueDeclaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    )
      return declaration.initializer;
    return undefined;
  }
  const unknownScalar = Symbol('unknown');
  type Scalar = string | number | boolean | null | undefined | typeof unknownScalar;
  function scalar(node: ts.Expression, seen = new Set<ts.Node>()): Scalar {
    if (seen.has(node)) return unknownScalar;
    const next = new Set(seen).add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return scalar(node.expression, next);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isVoidExpression(node)) return undefined;
    if (ts.isIdentifier(node)) {
      const initializer = constantInitializer(node);
      return initializer ? scalar(initializer, next) : unknownScalar;
    }
    return unknownScalar;
  }
  type Value = string | undefined;
  const dynamic = '__dynamic__';
  function combine(left: Value[], right: Value[]): Value[] {
    if (left.length * right.length > 256) return [undefined];
    return left.flatMap((a) =>
      right.map((b) => (a === undefined || b === undefined ? undefined : a + b)),
    );
  }
  function resolve(node: ts.Expression, seen = new Set<ts.Node>()): Value[] {
    if (seen.has(node)) return [undefined];
    const next = new Set(seen).add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return resolve(node.expression, next);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node))
      return [...resolve(node.whenTrue, next), ...resolve(node.whenFalse, next)];
    if (ts.isBinaryExpression(node)) {
      if (
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(node.operatorToken.kind)
      ) {
        const left = scalar(node.left);
        if (left !== unknownScalar) {
          const useRight =
            node.operatorToken.kind === ts.SyntaxKind.BarBarToken
              ? !left
              : node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
                ? Boolean(left)
                : left === null || left === undefined;
          if (useRight) return resolve(node.right, next);
          // false、null 等非字串值不會產生導航路徑。
          return typeof left === 'string' ? [left] : [];
        }
        return [...resolve(node.left, next), ...resolve(node.right, next)];
      }
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken)
        return combine(resolve(node.left, next), resolve(node.right, next));
    }
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce<Value[]>(
        (values, span) =>
          combine(combine(values, resolve(span.expression, next)), [span.literal.text]),
        [node.head.text],
      );
    }
    if (ts.isIdentifier(node)) {
      const initializer = constantInitializer(node);
      if (initializer) return resolve(initializer, next);
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      return declaration && ts.isVariableDeclaration(declaration) ? [undefined] : [dynamic];
    }
    // 只有已知保留第一參數頁面路徑的 helper 才可穿透。
    if (
      ts.isCallExpression(node) &&
      /^(appendSchoolContext|withSchoolContext)$/.test(node.expression.getText(tree)) &&
      node.arguments[0]
    )
      return resolve(node.arguments[0], next);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return [dynamic];
    return [undefined];
  }
  function emit(expression: ts.Expression) {
    const line = tree.getLineAndCharacterOfPosition(expression.getStart(tree)).line + 1;
    for (const target of new Set(resolve(expression))) {
      // 佔位值必須獨佔路徑段；直接接在頁名後可能是查詢後綴或另一個路徑。
      const pathname = target?.split(/[?#]/)[0];
      if (
        target === undefined ||
        target.startsWith(dynamic) ||
        pathname?.split('/').some((part) => part.includes(dynamic) && part !== dynamic)
      ) {
        unknown.push({
          file,
          line,
          expression: expression.getText(tree),
          reason: '無法靜態推導完整站內目標',
        });
      } else if (target.startsWith('/') && !target.startsWith('//')) {
        links.push({ file, line, target });
      }
    }
  }
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && /^(href|to|action|returnUrl)$/.test(node.name.getText(tree))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) emit(node.initializer);
      else if (
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      )
        emit(node.initializer.expression);
    }
    if (
      ts.isPropertyAssignment(node) &&
      /^(.*Href|href|path|route|to)$/.test(node.name.getText(tree).replace(/['"]/g, ''))
    )
      emit(node.initializer);
    if (
      ts.isCallExpression(node) &&
      navigationCall.test(node.expression.getText(tree)) &&
      node.arguments[0]
    )
      emit(node.arguments[0]);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      /^(?:window\.)?location\.href$/.test(node.left.getText(tree))
    )
      emit(node.right);
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      /(?:link|navigation|destination)/i.test(file)
    )
      emit(node.expression);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { links, unknown };
}

export function extractLinks(source: string, file: string): InternalLink[] {
  return extractLinkCandidates(source, file).links;
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
