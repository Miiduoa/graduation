/**
 * A deliberately small notation reader, not a calculator or a LaTeX parser.
 * Only a complete, bounded expression is typeset; unsupported input stays verbatim.
 * Multiplication must be explicit. Scripts accept one atom or a grouped expression,
 * and roots require parentheses, so ambiguous scopes are never guessed.
 */
export type StudyFormulaNode =
  | { kind: 'token'; tag: 'mi' | 'mn' | 'mo'; text: string }
  | { kind: 'row'; children: StudyFormulaNode[] }
  | { kind: 'fraction'; numerator: StudyFormulaNode; denominator: StudyFormulaNode }
  | { kind: 'root'; body: StudyFormulaNode }
  | { kind: 'script'; base: StudyFormulaNode; sub?: StudyFormulaNode; sup?: StudyFormulaNode };

type Token = { kind: 'number' | 'symbol' | 'operator' | 'root'; text: string };

const MAX_CHARACTERS = 200;
const MAX_TOKENS = 120;
const MAX_NESTING = 12;
const SYMBOL = /^[A-Za-zΑ-Ωα-ωϑϕϖϰϱϵ]$/u;

function tokenize(formula: string): Token[] | null {
  const tokens: Token[] = [];
  for (let offset = 0; offset < formula.length;) {
    const character = formula[offset];
    if (/\s/u.test(character)) { offset += 1; continue; }
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)/u.exec(formula.slice(offset));
    if (number) {
      tokens.push({ kind: 'number', text: number[0] });
      offset += number[0].length;
    } else if (formula.startsWith('sqrt', offset)) {
      tokens.push({ kind: 'root', text: 'sqrt' });
      offset += 4;
    } else if (character === '√') {
      tokens.push({ kind: 'root', text: character });
      offset += 1;
    } else if (SYMBOL.test(character)) {
      tokens.push({ kind: 'symbol', text: character });
      offset += 1;
    } else if ('+-−±*×·/÷=≠≤≥<>≈^_(){}'.includes(character)) {
      tokens.push({ kind: 'operator', text: character });
      offset += 1;
    } else {
      return null;
    }
    if (tokens.length > MAX_TOKENS) return null;
  }
  return tokens;
}

function operator(text: string): StudyFormulaNode {
  return { kind: 'token', tag: 'mo', text };
}

function row(...children: StudyFormulaNode[]): StudyFormulaNode {
  return { kind: 'row', children };
}

/** No evaluation, HTML parsing, substitution, or silent truncation is performed. */
export function parseStudyFormula(formula: string): StudyFormulaNode | null {
  if (!formula.trim() || formula.length > MAX_CHARACTERS) return null;
  const tokens = tokenize(formula);
  if (!tokens?.length) return null;
  let cursor = 0;

  function peek(text: string): boolean { return tokens?.[cursor]?.text === text; }

  function group(depth: number, opening: '(' | '{'): StudyFormulaNode | null {
    if (depth > MAX_NESTING || !peek(opening)) return null;
    cursor += 1;
    const body = relation(depth + 1);
    const closing = opening === '(' ? ')' : '}';
    if (!body || !peek(closing)) return null;
    cursor += 1;
    return opening === '(' ? row(operator('('), body, operator(')')) : body;
  }

  function atom(depth: number): StudyFormulaNode | null {
    if (depth > MAX_NESTING) return null;
    const token = tokens?.[cursor];
    if (!token) return null;
    if (token.kind === 'number' || token.kind === 'symbol') {
      cursor += 1;
      return { kind: 'token', tag: token.kind === 'number' ? 'mn' : 'mi', text: token.text };
    }
    if (peek('(')) return group(depth, '(');
    if (token.kind === 'root') {
      cursor += 1;
      // A required pair of parentheses gives the radical an unambiguous extent.
      if (!peek('(')) return null;
      cursor += 1;
      const body = relation(depth + 1);
      if (!body || !peek(')')) return null;
      cursor += 1;
      return { kind: 'root', body };
    }
    return null;
  }

  function scriptArgument(depth: number): StudyFormulaNode | null {
    if (depth > MAX_NESTING) return null;
    if (peek('{')) return group(depth, '{');
    if (peek('+') || peek('-') || peek('−')) {
      const sign = tokens![cursor++].text;
      const value = atom(depth + 1);
      return value ? row(operator(sign), value) : null;
    }
    return atom(depth);
  }

  function script(depth: number): StudyFormulaNode | null {
    const base = atom(depth);
    if (!base) return null;
    let sub: StudyFormulaNode | undefined;
    let sup: StudyFormulaNode | undefined;
    while (peek('_') || peek('^')) {
      const marker = tokens![cursor++].text;
      if ((marker === '_' && sub) || (marker === '^' && sup)) return null;
      const argument = scriptArgument(depth + 1);
      if (!argument) return null;
      if (marker === '_') sub = argument;
      else sup = argument;
    }
    return sub || sup ? { kind: 'script', base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}) } : base;
  }

  function unary(depth: number): StudyFormulaNode | null {
    if (depth > MAX_NESTING) return null;
    if (peek('+') || peek('-') || peek('−')) {
      const sign = tokens![cursor++].text;
      const value = unary(depth + 1);
      return value ? row(operator(sign), value) : null;
    }
    return script(depth);
  }

  function product(depth: number): StudyFormulaNode | null {
    let left = unary(depth);
    if (!left) return null;
    while (['*', '×', '·', '/', '÷'].includes(tokens?.[cursor]?.text ?? '')) {
      const operation = tokens![cursor++].text;
      const right = unary(depth);
      if (!right) return null;
      // Division and multiplication associate left to right; scripts bind first.
      left = operation === '/'
        ? { kind: 'fraction', numerator: left, denominator: right }
        : row(left, operator(operation), right);
    }
    return left;
  }

  function sum(depth: number): StudyFormulaNode | null {
    let left = product(depth);
    if (!left) return null;
    while (['+', '-', '−', '±'].includes(tokens?.[cursor]?.text ?? '')) {
      const operation = tokens![cursor++].text;
      const right = product(depth);
      if (!right) return null;
      left = row(left, operator(operation), right);
    }
    return left;
  }

  function relation(depth: number): StudyFormulaNode | null {
    let left = sum(depth);
    if (!left) return null;
    while (['=', '≠', '≤', '≥', '<', '>', '≈'].includes(tokens?.[cursor]?.text ?? '')) {
      const operation = tokens![cursor++].text;
      const right = sum(depth);
      if (!right) return null;
      left = row(left, operator(operation), right);
    }
    return left;
  }

  const result = relation(0);
  return result && cursor === tokens.length ? result : null;
}
