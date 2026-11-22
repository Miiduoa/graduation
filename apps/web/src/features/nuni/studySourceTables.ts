import { calc } from '@csstools/css-calc';

/**
 * Reconstruct only simple Markdown pipe tables already present in a passage.
 * This is a source-text view, not a model interpretation of an image or chart.
 * Ambiguous/malformed tables are omitted instead of guessing missing cells.
 */
export type StudySourceTable = {
  startLine: number;
  headers: string[];
  rows: string[][];
};

const MAX_TABLES = 3;
const MAX_COLUMNS = 8;
const MAX_ROWS = 20;

// A Markdown-looking table in an explicitly hidden HTML wrapper is not
// visible course material. Check HTML hiding attributes and inline visibility
// declarations that can be resolved from the passage. External stylesheets
// and browser-dependent CSS are outside the source scanner's scope.
// Also recognize hidden semantic block wrappers used in real course handouts.
// Inline/implicitly-closed HTML needs a renderer. Only follow explicit
// wrappers with matching closing tags when they are hidden; this is not CSS
// layout computation and never rewrites the original course source.
const HIDDEN_HTML_CONTAINERS = new Set([
  'div', 'section', 'aside', 'article', 'figure', 'blockquote',
  'main', 'header', 'footer', 'nav', 'form', 'fieldset',
  // Teacher-only notes may use paragraph, label, or heading wrappers too.
  // Scan explicit hidden attributes/styles on these elements as well, while
  // leaving ordinary visible HTML wrappers eligible for source tables.
  'span', 'p', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  // The HTML hidden attribute is global, including older <center> handouts,
  // definition lists and inline semantic wrappers. If these are omitted,
  // teacher-only Markdown-looking rows can escape into the derived study view.
  // Only explicit source attributes/styles are checked, not computed CSS.
  'center', 'address', 'hgroup', 'dl', 'dt', 'dd',
  'a', 'em', 'strong', 'b', 'i', 'u', 'small', 'mark', 'time',
  'output', 'ins', 'del', 'sup', 'sub',
]);
// HTML disclosure / dialog bodies are not standalone Markdown tables. Keep
// nested disclosures balanced so a closed inner example cannot expose its parent.
// HTML templates, preformatted examples, nested code and SVG/MathML roots
// can contain another same-name wrapper. An inner closing tag must not
// release the outer suppressed content and expose a teacher-only table.
const NESTABLE_HTML_BLOCKS = new Set([
  ...HIDDEN_HTML_CONTAINERS, 'details', 'dialog',
  'template', 'pre', 'code', 'svg', 'math',
]);
// Raw-text/RCDATA children can contain a literal closing tag for their parent.
// Track them even inside a hidden wrapper: </div> in a script string must not
// release unpublished answer rows. This is source-boundary tracking, not an HTML parser.
const RAW_HTML_TEXT_BLOCKS = new Set([
  'script', 'style', 'textarea',
  // In these raw-text/RCDATA elements, a literal </div> is not an HTML tag.
  'xmp', 'iframe', 'noembed', 'noframes', 'title', 'plaintext',
]);
// Form controls are not standalone Markdown table containers. Their options,
// labels and fallbacks may contain table-shaped text which must not be
// reconstructed into a separate public study table.
const HTML_FORM_TEXT_BLOCKS = new Set([
  'select', 'datalist', 'optgroup', 'option', 'button',
]);
// Scan every syntactically complete tag so quoted attributes on other HTML
// elements cannot smuggle fake opening/closing tags into the block tracker.
const TABLE_SUPPRESSED_HTML_TAGS = new Set([
  ...NESTABLE_HTML_BLOCKS, ...HTML_FORM_TEXT_BLOCKS,
  'pre', 'code', 'script', 'style', 'textarea',
  'template', 'noscript', 'svg', 'math', 'table',
  'xmp', 'iframe', 'noembed', 'noframes', 'title', 'plaintext',
]);

// HTML custom elements use hyphenated tag names. A teacher-only
// <lesson-answer hidden> must be treated like <div hidden>, including nested
// same-name wrappers. Do not guess visibility of unrelated unknown tags.
function isCustomHtmlContainer(tag: string): boolean {
  return /^[a-z][a-z0-9_-]*-[a-z0-9_-]+$/u.test(tag);
}
function isTrackedHtmlTag(tag: string): boolean {
  return TABLE_SUPPRESSED_HTML_TAGS.has(tag) || isCustomHtmlContainer(tag);
}
function isNestableHtmlTag(tag: string): boolean {
  return NESTABLE_HTML_BLOCKS.has(tag) || isCustomHtmlContainer(tag);
}
function canCarryHiddenHtmlAttribute(tag: string): boolean {
  return HIDDEN_HTML_CONTAINERS.has(tag) || isCustomHtmlContainer(tag);
}

/** Split CSS declarations without treating semicolons in strings, URLs or comments as separators. */
function splitCssDeclarations(style: string, stylesheet = false): string[] {
  const declarations: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let nestedFunctions = 0;
  for (let index = 0; index < style.length; index += 1) {
    const char = style[index];
    if (quote) {
      current += char;
      if (char === '\\' && index + 1 < style.length) {
        index += 1;
        current += style[index];
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '/' && style[index + 1] === '*') {
      // CSS comments are whitespace; a trailing comment must not change "none".
      const end = style.indexOf('*/', index + 2);
      current += ' ';
      if (end < 0) break;
      index = end + 1;
    } else if (char === '(') {
      nestedFunctions += 1;
      current += char;
    } else if (char === ')') {
      nestedFunctions = Math.max(0, nestedFunctions - 1);
      current += char;
    } else if (nestedFunctions === 0 && (char === ';' || (stylesheet && (char === '{' || char === '}')))) {
      declarations.push(current);
      current = '';
    } else current += char;
  }
  declarations.push(current);
  return declarations;
}

// HTML resolves character references in quoted attributes before parsing
// CSS/ARIA. Decode one pass only: &amp;colon; represents literal &colon; in
// the DOM, not a second colon escape. These named references affect explicit
// hidden styles; this is intentionally not a full HTML entity parser.
function decodeHtmlAttributeReferences(value: string): string {
  // Use a Map so an unrecognized &constructor;/&toString; is never
  // substituted by an inherited Object prototype member.
  const cssEntities = new Map<string, string>([
    ['colon', ':'], ['semi', ';'], ['Tab', '\t'], ['NewLine', '\n'],
    ['excl', '!'], ['sol', '/'], ['lpar', '('], ['rpar', ')'],
    ['period', '.'], ['percnt', '%'], ['plus', '+'],
  ]);
  return value.replace(/&(?:#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?|([A-Za-z]+);)/gu,
    (reference: string, hex: string | undefined, decimal: string | undefined,
      name: string | undefined) => {
      if (name !== undefined) return cssEntities.get(name) ?? reference;
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex === undefined ? 10 : 16);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint) : '\uFFFD';
    });
}

// CSS identifiers may use a backslash followed by up to six hex digits and
// optional whitespace. Without decoding, "display:\\6e one" is visually
// hidden in a browser but looks non-hidden to a source-text table scanner.
function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([^\r\n\f]))/giu,
    (_, hex: string | undefined, literal: string | undefined) => {
      if (hex === undefined) return literal ?? '';
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint) : '\uFFFD';
    });
}

// Browsers discard unsupported literal declarations instead of letting them
// override an earlier valid hidden value. A fallback such as
// "display:none;display:not-a-mode" must remain hidden in the derived table.
const CSS_CONTEXTUAL_WIDE_VALUES = new Set(['inherit', 'unset', 'revert', 'revert-layer']);
const CSS_DISPLAY_KEYWORDS = new Set([
  'none', 'contents', 'block', 'inline', 'run-in', 'flow-root',
  'inline-block', 'inline-flex', 'inline-grid', 'inline-table',
  'flex', 'grid', 'table', 'list-item',
  '-webkit-box', '-webkit-inline-box', '-webkit-flex', '-webkit-inline-flex', '-ms-flexbox',
  'table-caption', 'table-cell', 'table-column', 'table-column-group',
  'table-footer-group', 'table-header-group', 'table-row', 'table-row-group',
  'ruby', 'ruby-base', 'ruby-text', 'ruby-base-container', 'ruby-text-container',
]);
const CSS_ALPHA_VALUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?%?$/iu;
// Opacity accepts numeric math functions. Other literal functions are invalid for it.
const CSS_MATH_FUNCTION = /^(?:calc|min|max|clamp|round|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign|progress|media-progress|container-progress|random|sibling-count|sibling-index)\(/iu;
const CSS_SUBSTITUTION_FUNCTION = /\b(?:var|env|attr|if)\(/iu;
const CSS_CUSTOM_PROPERTY = /^\s*(--[\w\p{L}\p{N}-]+)\s*:\s*([\s\S]*?)\s*$/u;
const HTML_BOUNDARY_TOKEN = /<!--|--!?>|<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const HTML_ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\x60=<>]+)))?/gu;
const CSS_IMPORTANT_SUFFIX = /\s*!\s*important\s*$/iu;

function isRecognizedInlineCssValue(name: string, value: string): boolean {
  if (value === 'initial') return true;
  if (name === 'opacity') return CSS_ALPHA_VALUE.test(value);
  if (name === 'display') {
    if (CSS_DISPLAY_KEYWORDS.has(value)) return true;
    // Display allows an outside and an inside keyword. A list-item
    // additionally accepts either flow or flow-root as its inside keyword.
    const tokens = value.split(/\s+/u);
    const outside = tokens.filter((token) => /^(?:block|inline|run-in)$/u.test(token));
    const inside = tokens.filter((token) => /^(?:flow|flow-root|flex|grid|table|ruby)$/u.test(token));
    const listItem = tokens.includes('list-item');
    return outside.length <= 1 && inside.length <= 1 &&
      tokens.length === outside.length + inside.length + Number(listItem) &&
      (!listItem || !inside.length || /^flow(?:-root)?$/u.test(inside[0]));
  }
  if (name === 'visibility') return ['visible', 'hidden', 'collapse'].includes(value);
  return ['visible', 'hidden', 'auto'].includes(value);
}

function substituteCssVariables(
  value: string, lookup: (name: string) => string | null | undefined, stylesheetProperties: ReadonlySet<string>,
): string | null | undefined {
  for (let substitutions = 0; substitutions < 32; substitutions += 1) {
    const variable = /\bvar\(\s*(--[\w\p{L}\p{N}-]+)\s*/iu.exec(value);
    if (!variable) return CSS_SUBSTITUTION_FUNCTION.test(value) ? null : value;
    const argumentEnd = variable.index + variable[0].length;
    const definition = lookup(variable[1]);
    if (definition === null) return null;
    const isGuaranteedInvalid = definition?.toLowerCase() === 'initial';
    const localValue = isGuaranteedInvalid ? undefined : definition;
    const hasFallback = value[argumentEnd] === ',';
    if (!hasFallback && value[argumentEnd] !== ')') return undefined;
    if (localValue === undefined && !isGuaranteedInvalid && stylesheetProperties.has(variable[1])) return null;
    if (localValue === undefined && !hasFallback) return undefined;
    let depth = 1;
    let end = argumentEnd;
    while (end < value.length && depth > 0) {
      if (value[end] === '(') depth += 1;
      if (value[end] === ')') depth -= 1;
      end += 1;
    }
    if (depth !== 0) return undefined;
    const replacement = localValue ?? value.slice(argumentEnd + 1, end - 1).trim();
    if (localValue !== undefined &&
        CSS_CONTEXTUAL_WIDE_VALUES.has(localValue.toLowerCase())) {
      return null;
    }
    value = value.slice(0, variable.index) + ' ' + replacement + ' ' + value.slice(end);
    value = value.trim();
  }
  return null;
}

function resolveInlineVisibilityValue(name: string, value: string): string | undefined {
  if (name !== 'opacity' || !CSS_MATH_FUNCTION.test(value)) return value.toLowerCase();
  // A numeric visibility value must be a single complete function.
  // The math evaluator also accepts fragments and multiple CSS tokens.
  let depth = 0;
  for (const parenthesis of value.matchAll(/[()]/gu)) {
    depth += parenthesis[0] === '(' ? 1 : -1;
    if (depth === 0 && parenthesis.index !== value.length - 1) return value.toLowerCase();
    if (depth > 32) return undefined;
  }
  if (depth !== 0) return undefined;
  const computed = calc(value, { rawPercentages: true });
  if (/^calc\(\+?infinity%?\)$/iu.test(computed)) return '1';
  if (/^calc\((?:-infinity|nan)%?\)$/iu.test(computed)) return '0';
  // A reduced dimension (such as a length) is invalid for opacity.
  // An expression the evaluator cannot reduce remains ambiguous.
  return /[()]/u.test(computed) ? undefined : computed;
}

function inlineCustomProperties(
  declarations: string[], inherited: ReadonlyMap<string, string | null>, stylesheetProperties: ReadonlySet<string>,
): ReadonlyMap<string, string | null> {
  const localProperties = new Map<string, string>();
  const importantCustomProperties = new Set<string>();
  for (const declaration of declarations) {
    const property = CSS_CUSTOM_PROPERTY.exec(declaration);
    if (!property) continue;
    const [, name, raw] = property;
    if (CSS_IMPORTANT_SUFFIX.test(raw)) importantCustomProperties.add(name);
    else if (importantCustomProperties.has(name)) continue;
    localProperties.set(name, raw.replace(CSS_IMPORTANT_SUFFIX, '').trim());
  }
  if (!localProperties.size) return inherited;

  // Resolve aliases where they are declared, before descendants can shadow
  // their dependencies. Unknown stylesheet values and cycles stay ambiguous.
  const computed = new Map(inherited);
  const resolved = new Set<string>();
  const resolving = new Set<string>();
  const lookup = (name: string): string | null | undefined => {
    if (!localProperties.has(name) || resolved.has(name)) return computed.get(name);
    if (resolving.has(name) || resolving.size >= 32) return null;
    const declared = localProperties.get(name)!;
    if (/^(?:inherit|unset)$/iu.test(declared)) return inherited.get(name);
    resolving.add(name);
    const value = substituteCssVariables(declared, lookup, stylesheetProperties);
    resolving.delete(name);
    resolved.add(name);
    computed.set(name, value === undefined ? 'initial' : value);
    return computed.get(name);
  };
  for (const name of localProperties.keys()) lookup(name);
  return computed;
}

const INLINE_VISIBILITY_INHERITS = {
  display: false,
  visibility: true,
  'content-visibility': false,
  opacity: false,
} as const;

type InlineVisibility = Partial<Record<keyof typeof INLINE_VISIBILITY_INHERITS, string>>;

function readInlineVisibility(
  declarations: string[], properties: ReadonlyMap<string, string | null>,
  stylesheetProperties: ReadonlySet<string>, parent: InlineVisibility,
): InlineVisibility {
  // Apply order and !important independently for each visibility property.
  const effective = new Map<keyof InlineVisibility, { value: string | undefined; important: boolean }>();
  for (const declaration of declarations) {
    const property = /^\s*(display|visibility|content-visibility|opacity)\s*:\s*([\s\S]*?)\s*$/iu.exec(declaration);
    if (!property) continue;
    const name = property[1].toLowerCase() as keyof InlineVisibility;
    const important = CSS_IMPORTANT_SUFFIX.test(property[2]);
    const declared = property[2].replace(CSS_IMPORTANT_SUFFIX, '').trim();
    const substituted = substituteCssVariables(declared, (key) => properties.get(key), stylesheetProperties);
    const resolved = typeof substituted === 'string' ? resolveInlineVisibilityValue(name, substituted) : undefined;
    const wide = resolved !== undefined && CSS_CONTEXTUAL_WIDE_VALUES.has(resolved);
    const deferred = CSS_SUBSTITUTION_FUNCTION.test(declared) ||
      (resolved === undefined && CSS_MATH_FUNCTION.test(declared));
    const recognized = resolved !== undefined && isRecognizedInlineCssValue(name, resolved);
    if (!recognized && !wide && !deferred) continue;
    // Invalid substitutions fall back to unset. Of these properties, only
    // visibility inherits by default, and a descendant can override it.
    const inherits = resolved === 'inherit' ||
      (INLINE_VISIBILITY_INHERITS[name] && !recognized);
    const value = inherits ? parent[name] : recognized ? resolved : undefined;
    const previous = effective.get(name);
    if (!previous || important || !previous.important) {
      effective.set(name, { value, important });
    }
  }
  return {
    ...Object.fromEntries(Array.from(effective, ([name, { value }]) => [name, value])),
    visibility: effective.has('visibility') ? effective.get('visibility')?.value : parent.visibility,
  };
}

function hidesByVisibility(style: InlineVisibility): boolean {
  return style.visibility === 'hidden' || style.visibility === 'collapse';
}

function readHtmlVisibility(
  token: string, parent: { properties: ReadonlyMap<string, string | null>; style: InlineVisibility },
  stylesheetProperties: ReadonlySet<string>,
): { hidden: boolean; properties: ReadonlyMap<string, string | null>; style: InlineVisibility } {
  const opening = /^<[A-Za-z][\w:-]*/u.exec(token);
  const attributes = token.slice(opening?.[0].length);
  let hidden = false;
  let declarations: string[] | undefined;
  for (const match of attributes.matchAll(HTML_ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    const value = decodeHtmlAttributeReferences(match[2] ?? match[3] ?? match[4] ?? '');
    if (name === 'hidden' || (name === 'aria-hidden' && value.trim().toLowerCase() === 'true')) hidden = true;
    if (name === 'style' && !declarations) declarations = splitCssDeclarations(value).map(decodeCssEscapes);
  }
  const properties = declarations
    ? inlineCustomProperties(declarations, parent.properties, stylesheetProperties)
    : parent.properties;
  const style = declarations
    ? readInlineVisibility(declarations, properties, stylesheetProperties, parent.style)
    : { visibility: parent.style.visibility };
  hidden ||= style.display === 'none' || style['content-visibility'] === 'hidden' ||
    (style.opacity !== undefined && CSS_ALPHA_VALUE.test(style.opacity) &&
      Number(style.opacity.replace(/%$/u, '')) <= 0);
  return { hidden, properties, style };
}

// An odd number of backslashes escapes Markdown punctuation; an even
// number leaves a real HTML tag behind the literal backslashes.
function isEscapedMarkdownTag(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1)
    slashCount += 1;
  return slashCount % 2 === 1;
}

function parseSimplePipeRow(line: string): string[] | null {
  if (/^(?: {4}| {0,3}\t)/u.test(line)) return null;
  const trimmed = line.trim();
  // Literal HTML in paired Markdown inline-code spans is visible lesson
  // text (for example, a programming syntax table), not active HTML. An
  // actual element or comment outside paired code still makes the entire
  // table ambiguous, so hidden teacher-only cells are never reconstructed.
  for (const marker of trimmed.matchAll(
    /<\/?[A-Za-z][\w:-]*(?=[\s/>])[^>]*>|<!--|--!?>/gu,
  )) {
    // A closing HTML-comment marker without a preceding <!-- is ordinary
    // visible lesson text (for example, a syntax table). Real comments
    // still fail the marker check at their opening token.
    if (marker[0] === '-->' || marker[0] === '--!>') continue;
    if (isEscapedMarkdownTag(trimmed, marker.index ?? 0)) continue;
    if (!isInsideInlineCode(trimmed, marker.index ?? 0)) return null;
  }
  // Only unescaped pipes outside paired inline-code spans separate columns.
  // Reject unmatched code spans rather than shift values into the wrong cells.
  const cells: string[] = [];
  let current = '';
  let codeWidth = 0;
  let separators = 0;
  let lastWasSeparator = false;
  for (let index = 0; index < trimmed.length;) {
    const character = trimmed[index];
    if (character === String.fromCharCode(96)) {
      let backslashes = 0;
      for (let at = current.length - 1; at >= 0 && current[at] === '\\'; at -= 1)
        backslashes += 1;
      // Backslashes inside code spans are literal, including before closing ticks.
      if (codeWidth !== 0 || backslashes % 2 === 0) {
        let next = index + 1;
        while (trimmed[next] === String.fromCharCode(96)) next += 1;
        const width = next - index;
        if (codeWidth === 0) codeWidth = width;
        else if (codeWidth === width) codeWidth = 0;
        current += trimmed.slice(index, next);
        index = next;
        lastWasSeparator = false;
        continue;
      }
    }
    if (character === '|' && codeWidth === 0) {
      let backslashes = 0;
      for (let at = current.length - 1; at >= 0 && current[at] === '\\'; at -= 1)
        backslashes += 1;
      if (backslashes > 0) {
        // Every paired backslash is literal; one final slash escapes the pipe.
        current = current.slice(0, -backslashes) + '\\'.repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 1) {
          current += '|';
          index += 1;
          lastWasSeparator = false;
          continue;
        }
      }
      cells.push(current.trim());
      current = '';
      separators += 1;
      lastWasSeparator = true;
      index += 1;
      continue;
    }
    current += character;
    lastWasSeparator = false;
    index += 1;
  }
  if (codeWidth !== 0 || separators === 0) return null;
  cells.push(current.trim());
  if (trimmed.startsWith('|')) cells.shift();
  if (lastWasSeparator) cells.pop();
  return cells.length >= 2 && cells.length <= MAX_COLUMNS ? cells : null;
}

function fenceMarker(line: string): { character: string; length: number; suffix: string } | null {
  const trimmed = line.trimStart();
  // Markdown fences may be indented by at most three ASCII spaces.
  // A leading tab reaches the fourth column and is an indented code line,
  // not an opening/closing fence. Never let it expose fake table rows.
  const indent = line.slice(0, line.length - trimmed.length);
  if (!/^ {0,3}$/u.test(indent)) return null;
  const marker = trimmed[0];
  if (marker !== '~' && marker !== String.fromCharCode(96)) return null;
  let length = 0;
  while (trimmed[length] === marker) length += 1;
  if (length < 3) return null;
  const suffix = trimmed.slice(length);
  // CommonMark forbids backticks inside a backtick fence's info string.
  // Treat that line as ordinary lesson text, not a code block hiding a
  // legitimate source table below. Tilde fence info may contain backticks.
  if (marker === String.fromCharCode(96) && suffix.includes(String.fromCharCode(96)))
    return null;
  return { character: marker, length, suffix };
}

/** Markdown inline code contains literal tags, not active HTML blocks. */
function isInsideInlineCode(line: string, target: number): boolean {
  const tick = String.fromCharCode(96);
  for (let offset = 0; offset < line.length;) {
    if (line[offset] !== tick) { offset += 1; continue; }
    // In Markdown text, an escaped backtick cannot open inline code.
    // Ignore only the escaped character: additional backticks in the same
    // run may still form a delimiter. Inside code, closing ticks remain raw.
    let backslashes = 0;
    for (let previous = offset - 1; previous >= 0 && line[previous] === '\\'; previous -= 1)
      backslashes += 1;
    if (backslashes % 2 === 1) { offset += 1; continue; }
    const start = offset;
    while (line[offset] === tick) offset += 1;
    const width = offset - start;
    let closingEnd = -1;
    for (let probe = offset; probe < line.length;) {
      if (line[probe] !== tick) { probe += 1; continue; }
      const begin = probe;
      while (line[probe] === tick) probe += 1;
      if (probe - begin === width) { closingEnd = probe; break; }
    }
    if (closingEnd < 0) continue;
    if (target >= start && target < closingEnd) return true;
    offset = closingEnd;
    if (offset > target) break;
  }
  return false;
}

function collectStylesheetProperties(lines: string[]): Set<string> {
  const names = new Set<string>();
  let inComment = false;
  let rawTag: string | undefined;
  let stylesheet = '';
  let fence: ReturnType<typeof fenceMarker> = null;
  const record = (css: string) => {
    for (const declaration of splitCssDeclarations(css, true)) {
      const property = CSS_CUSTOM_PROPERTY.exec(decodeCssEscapes(declaration));
      if (property) names.add(property[1]);
    }
  };
  for (const line of lines) {
    const marker = fenceMarker(line);
    if (fence) {
      if (marker && fence.character === marker.character &&
          marker.length >= fence.length && !marker.suffix.trim()) fence = null;
      continue;
    }
    if (!inComment && !rawTag && marker) {
      fence = marker;
      continue;
    }
    if (!inComment && !rawTag && /^(?: {4}| {0,3}\t)/u.test(line)) continue;
    let cssStart = 0;
    for (const match of line.matchAll(HTML_BOUNDARY_TOKEN)) {
      const [token, rawName] = match;
      const tag = rawName?.toLowerCase();
      if (rawTag) {
        if (tag === rawTag && rawTag !== 'plaintext' && token.startsWith('</')) {
          if (rawTag === 'style') {
            record(stylesheet + line.slice(cssStart, match.index));
            stylesheet = '';
          }
          rawTag = undefined;
        }
        continue;
      }
      if (inComment) {
        if (token === '-->' || token === '--!>') inComment = false;
        continue;
      }
      if (isEscapedMarkdownTag(line, match.index) || isInsideInlineCode(line, match.index)) continue;
      if (token === '<!--') inComment = true;
      if (!tag || token.startsWith('</')) continue;
      if (RAW_HTML_TEXT_BLOCKS.has(tag)) {
        rawTag = tag;
        cssStart = match.index + token.length;
      }
    }
    if (rawTag === 'style') stylesheet += line.slice(cssStart) + '\n';
  }
  if (stylesheet) record(stylesheet);
  return names;
}

export function extractStudySourceTables(source: string): StudySourceTable[] {
  if (!source.includes('|')) return [];
  // A valid HTML opening/closing tag may wrap its attributes across lines:
  // <section\n aria-hidden="true">. Scanning one line at a time would miss
  // that hidden wrapper and expose a teacher-only table as a public table.
  // Fold complete visibility wrappers and inline styles in the temporary copy.
  // Move each original line break after its tag so source line numbers stay
  // unchanged, including classic Mac CR and mixed line endings. Never rewrite
  // or export the student's original source.
  const scanSource = source.replace(
    /<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gu,
    (token, tag: string, offset: number) => {
      // Do not fold a Markdown-escaped example into an active HTML tag.
      if (isEscapedMarkdownTag(source, offset)) return token;
      if (!/[\r\n]/u.test(token) || (!isTrackedHtmlTag(tag.toLowerCase()) && !/\bstyle\s*=/iu.test(token))) return token;
      const newlines = token.match(/\r\n|\r|\n/gu) ?? [];
      return token.replace(/\r\n|\r|\n/gu, ' ') + '\n'.repeat(newlines.length);
    },
  );
  const lines = scanSource.split(/\r\n|\r|\n/u);
  const stylesheetProperties = collectStylesheetProperties(lines);
  const root = { properties: new Map<string, string | null>(), style: {} };
  const ancestors: ({ tag: string } & Omit<ReturnType<typeof readHtmlVisibility>, 'hidden'>)[] = [];
  const tables: StudySourceTable[] = [];
  let fence: { character: string; length: number } | null = null;
  let inHtmlComment = false;
  const htmlCodeBlocks: string[] = [];

  for (let index = 0; index < lines.length - 2 && tables.length < MAX_TABLES; index += 1) {
    const line = lines[index];
    // Recognize fences before HTML-looking words in the fence info string.
    // Within a real HTML comment/raw block, fence-like text is inert.
    const marker = fenceMarker(line);
    if (fence) {
      if (marker && fence.character === marker.character &&
          marker.length >= fence.length && !marker.suffix.trim()) fence = null;
      continue;
    }
    if (!inHtmlComment && htmlCodeBlocks.length === 0 && marker) {
      fence = marker;
      continue;
    }
    // An indented Markdown code line is literal source text. A sample
    // "<!--" or "<pre>" in that line must not hide the next real table.
    // Keep processing indented closing tags while inside an actual HTML block.
    if (!inHtmlComment && htmlCodeBlocks.length === 0 &&
        /^(?: {4}| {0,3}\t)/u.test(line)) continue;
    // HTML boundaries follow source order; Markdown inline code is literal.
    let hiddenLine = inHtmlComment || htmlCodeBlocks.length > 0;
    for (const match of line.matchAll(HTML_BOUNDARY_TOKEN)) {
      const token = match[0];
      // A Markdown escape outside HTML/comment blocks is visible syntax,
      // not a hidden element or an opening comment.
      if (!inHtmlComment && htmlCodeBlocks.length === 0 &&
          isEscapedMarkdownTag(line, match.index ?? 0)) continue;
      // In a disclosure or hidden container, a paired inline-code example
      // such as `</details>` is not an actual closing tag. Otherwise it
      // prematurely exposes the still-hidden answer beneath the example.
      // Raw <pre>/<code> blocks are HTML, not Markdown inline-code contexts.
      if (!inHtmlComment &&
          (htmlCodeBlocks.length === 0 ||
            isNestableHtmlTag(htmlCodeBlocks[htmlCodeBlocks.length - 1])) &&
          isInsideInlineCode(line, match.index ?? 0)) continue;
      if (inHtmlComment) {
        if (token === '-->' || token === '--!>') inHtmlComment = false;
        hiddenLine = true;
        continue;
      }
      if (token === '<!--') {
        // A real HTML comment still begins inside a hidden <div>, <details>,
        // or <pre>. Closing-tag text inside it must not release unpublished
        // lesson rows. Only script/style/textarea consume <!-- as raw text.
        if (!RAW_HTML_TEXT_BLOCKS.has(htmlCodeBlocks[htmlCodeBlocks.length - 1] ?? ''))
          inHtmlComment = true;
        hiddenLine = true;
        continue;
      }
      if (token === '-->' || token === '--!>') {
        // No opening comment is active. A lone terminator is plain text;
        // only the inHtmlComment branch above suppresses comment content.
        continue;
      }
      const tag = match[1]?.toLowerCase();
      if (!tag) continue;
      const tracked = isTrackedHtmlTag(tag);
      // Preformatted examples contain literal tag-looking text. In contrast,
      // nested containers of the same type inside a hidden wrapper must be
      // balanced, or the inner closing tag could expose unpublished rows.
      const closing = token.startsWith('</');
      // A trailing slash on an HTML non-void element does not close it.
      // Only tracked SVG/MathML foreign roots honor the slash: otherwise
      // <div hidden /> could expose answers which the browser still hides.
      const selfClosing = /\/>$/u.test(token) && (tag === 'svg' || tag === 'math');
      if (htmlCodeBlocks.length > 0) {
        const current = htmlCodeBlocks[htmlCodeBlocks.length - 1];
        // HTML <plaintext> consumes everything to EOF; even a literal
        // </plaintext> must not expose a teacher-only table below it.
        if (closing && current === tag && current !== 'plaintext') htmlCodeBlocks.pop();
        else if (!closing && !selfClosing && !RAW_HTML_TEXT_BLOCKS.has(current) &&
            ((current === tag && (isNestableHtmlTag(tag) || !isTrackedHtmlTag(tag))) || RAW_HTML_TEXT_BLOCKS.has(tag)))
          htmlCodeBlocks.push(tag);
      } else if (closing) {
        for (let index = ancestors.length - 1; index >= 0; index -= 1) {
          if (ancestors[index].tag === tag) {
            ancestors.length = index;
            break;
          }
        }
      } else if (!selfClosing && !HTML_VOID_TAGS.has(tag)) {
        const parent = ancestors.at(-1) ?? root;
        const { hidden, properties, style } = readHtmlVisibility(token, parent, stylesheetProperties);
        if (hidden || (tracked && !canCarryHiddenHtmlAttribute(tag))) htmlCodeBlocks.push(tag);
        else ancestors.push({ tag, properties, style });
      }
      if (tracked) hiddenLine = true;
    }
    if (hiddenLine || hidesByVisibility((ancestors.at(-1) ?? root).style)) continue;
    const headers = parseSimplePipeRow(lines[index]);
    const separator = parseSimplePipeRow(lines[index + 1]);
    if (!headers || !separator || headers.some((header) => !header) ||
        separator.length !== headers.length ||
        !separator.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;

    const rows: string[][] = [];
    let cursor = index + 2;
    let malformed = false;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const row = parseSimplePipeRow(line);
      if (!row) {
        // An escaped pipe, inline code or indented row can make a table
        // ambiguous. Do not show only the earlier rows as if complete.
        if (line.includes('|')) malformed = true;
        break;
      }
      if (row.length !== headers.length) {
        malformed = true;
        break;
      }
      rows.push(row);
      cursor += 1;
      if (rows.length > MAX_ROWS) break;
    }
    // Never quietly truncate an oversized or malformed source table.
    if (!malformed && rows.length > 0 && rows.length <= MAX_ROWS)
      tables.push({ startLine: index + 1, headers, rows });
    index = cursor - 1;
  }
  return tables;
}
