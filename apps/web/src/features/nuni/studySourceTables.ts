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
// visible course material. Do not infer CSS visibility or parse arbitrary
// HTML: recognize explicit hidden / aria-hidden=true and literal inline display:none,
// visibility:hidden / visibility:collapse / content-visibility:hidden;
// this does not infer computed CSS, external stylesheets or chart meaning.
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
function splitInlineCssDeclarations(style: string): string[] {
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
    } else if (char === ';' && nestedFunctions === 0) {
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
// This covers literal values and simple display fallbacks. Other CSS functions
// and combinations can depend on the browser's computed style.
// 'initial' is a known literal for all four properties. The scanner resolves
// 'unset' to 'initial' for non-inherited properties. The remaining contextual
// values can depend on an ancestor or cascade rules outside the source text.
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
function isRecognizedInlineCssValue(name: string, value: string): boolean {
  if (value === 'initial') return true;
  if (name === 'opacity') {
    // CSS <alpha-value>: an ordinary number/percentage, or a functional
    // expression whose computed value cannot be established by this scanner.
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/iu.test(value) ||
      /^(?:calc|min|max|clamp|var|env)\(/iu.test(value);
  }
  // Unknown multi-token values must not silently override a preceding
  // display:none or visibility:hidden: an invalid CSS declaration is ignored
  // by the browser. Recognize common valid two-keyword display values only;
  // keep other ambiguous combinations out of the optional source table.
  if (name === 'display' &&
      /^(?:(?:block|inline|run-in)\s+(?:flow|flow-root|flex|grid|table|ruby)|(?:flow|flow-root|flex|grid|table|ruby)\s+(?:block|inline|run-in))$/u.test(value)) return true;
  if (!/^[a-z-]+$/u.test(value)) return false;
  if (name === 'display') return CSS_DISPLAY_KEYWORDS.has(value);
  if (name === 'visibility') return ['visible', 'hidden', 'collapse'].includes(value);
  if (name === 'content-visibility') return ['visible', 'hidden', 'auto'].includes(value);
  return true;
}

// Unresolved inline CSS functions can depend on custom properties, viewport
// settings or browser computation. We cannot prove their rendered visibility
// from Markdown source text, so withhold optional derived tables rather than
// accidentally show a teacher-only table that the renderer may hide.
// Future or unrecognized functions can be valid in some browsers. Never
// assume a rendered display state from their source-text spelling.
const UNRESOLVED_VISIBILITY_FUNCTION = /\b[a-z][a-z-]*\s*\(/iu;
function hasExplicitHiddenInlineStyle(style: string): boolean {
  // Recognize literal inline values and explicit display fallbacks. CSS properties
  // cascade independently; a visible value for one property cannot override
  // a hidden value for another. Same-property !important and order still apply.
  // Custom property values from the rendered cascade are unavailable.
  const effective = new Map<string, { value: string; important: boolean; unresolved: boolean }>();
  // CSS permits whitespace (including comments) between ! and important.
  // The comment splitter above normalizes /* ... */ to whitespace.
  const importantSuffix = /\s*!\s*important\s*$/iu;
  for (const declaration of splitInlineCssDeclarations(style)) {
    const part = decodeCssEscapes(declaration);
    const property = /^\s*(display|visibility|content-visibility|opacity)\s*:\s*(.*?)\s*$/iu.exec(part);
    if (!property) continue;
    const name = property[1].toLowerCase();
    const important = importantSuffix.test(property[2]);
    const declaredValue = property[2].replace(importantSuffix, '').trim().toLowerCase();
    const displayFallback = name === 'display'
      ? /^var\(\s*--[^\s,()]+\s*,\s*([^(),]+?)\s*\)$/u.exec(declaredValue)?.[1]
      : undefined;
    const resolvedValue = displayFallback && isRecognizedInlineCssValue(name, displayFallback)
      ? displayFallback : declaredValue;
    // Unset resolves to the initial value for the three non-inherited properties.
    const value = resolvedValue === 'unset' && name !== 'visibility' ? 'initial' : resolvedValue;
    const unresolved = UNRESOLVED_VISIBILITY_FUNCTION.test(value) || CSS_CONTEXTUAL_WIDE_VALUES.has(value);
    if (!unresolved && !isRecognizedInlineCssValue(name, value)) continue;
    const previous = effective.get(name);
    if (!previous || important || !previous.important)
      effective.set(name, { value, important, unresolved });
  }
  // CSS <number> also permits a base-ten exponent: 0e3 and .0e-2 stay
  // completely transparent. Match a zero mantissa, not floating-point
  // underflow (e.g. 1e-99999), and preserve normal cascade precedence.
  // Explicit zero opacity hides the whole wrapper even when display/visibility
  // are otherwise visible. Do not infer variables, calc(), animations or
  // external CSS; only literal zero numbers/percentages with cascade applied.
  const opacity = effective.get('opacity')?.value;
  return [...effective.values()].some(({ unresolved }) => unresolved) || effective.get('display')?.value === 'none' ||
    ['hidden', 'collapse'].includes(effective.get('visibility')?.value ?? '') ||
    effective.get('content-visibility')?.value === 'hidden' ||
    (opacity !== undefined && /^[+-]?(?:0+(?:\.0+)?|\.0+)(?:e[+-]?\d+)?%?$/u.test(opacity));
}

function hasHiddenHtmlAttribute(token: string): boolean {
  // Only actual HTML attributes count. Searching the whole token for words
  // such as "hidden" also matches a quoted title/description and can hide a
  // legitimate course table that students need to read.
  const opening = /^<[A-Za-z][\w:-]*/u.exec(token);
  if (!opening) return false;
  const attributes = token.slice(opening[0].length);
  for (const match of attributes.matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\x60=<>]+)))?/gu)) {
    const name = match[1].toLowerCase();
    const attributeValue = decodeHtmlAttributeReferences(match[2] ?? match[3] ?? match[4] ?? '');
    // HTML's boolean hidden attribute is active even when written hidden="false".
    if (name === 'hidden') return true;
    if (name === 'style' && hasExplicitHiddenInlineStyle(attributeValue))
      return true;
    if (name === 'aria-hidden' &&
        attributeValue.trim().toLowerCase() === 'true') return true;
  }
  return false;
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

export function extractStudySourceTables(source: string): StudySourceTable[] {
  if (!source.includes('|')) return [];
  // A valid HTML opening/closing tag may wrap its attributes across lines:
  // <section\n aria-hidden="true">. Scanning one line at a time would miss
  // that hidden wrapper and expose a teacher-only table as a public table.
  // Fold only complete, tracked HTML tags in the scanner's temporary copy.
  // Move each original line break after its tag so source line numbers stay
  // unchanged, including classic Mac CR and mixed line endings. Never rewrite
  // or export the student's original source.
  const scanSource = source.replace(
    /<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gu,
    (token, tag: string, offset: number) => {
      // Do not fold a Markdown-escaped example into an active HTML tag.
      if (isEscapedMarkdownTag(source, offset)) return token;
      if (!isTrackedHtmlTag(tag.toLowerCase()) || !/[\r\n]/u.test(token)) return token;
      const newlines = token.match(/\r\n|\r|\n/gu) ?? [];
      return token.replace(/\r\n|\r|\n/gu, ' ') + '\n'.repeat(newlines.length);
    },
  );
  const lines = scanSource.split(/\r\n|\r|\n/u);
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
    for (const match of line.matchAll(/<!--|--!?>|<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu)) {
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
      if (!tag || !isTrackedHtmlTag(tag)) continue;
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
            ((current === tag && isNestableHtmlTag(tag)) || RAW_HTML_TEXT_BLOCKS.has(tag)))
          htmlCodeBlocks.push(tag);
      } else if (!closing && !selfClosing &&
          (!canCarryHiddenHtmlAttribute(tag) || hasHiddenHtmlAttribute(token))) {
        htmlCodeBlocks.push(tag);
      }
      hiddenLine = true;
    }
    if (hiddenLine) continue;
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
