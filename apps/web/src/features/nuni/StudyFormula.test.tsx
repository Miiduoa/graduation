import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudyFormula } from './StudyFormula';
import { parseStudyFormula } from './studyFormula';

const MATH_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

describe('StudyFormula', () => {
  it('typesets a fraction before addition in native MathML and keeps the exact source', () => {
    const formula = '  a / b + c  ';
    const { container } = render(<StudyFormula formula={formula} />);
    const math = container.querySelector('math')!;
    const fraction = math.querySelector('mfrac')!;
    expect(math.namespaceURI).toBe(MATH_NAMESPACE);
    expect(math.getAttribute('aria-label')).toBe(formula);
    expect([...fraction.children].map((child) => child.textContent)).toEqual(['a', 'b']);
    expect([...fraction.parentElement!.children].map((child) => child.localName)).toEqual(['mfrac', 'mo', 'mi']);
    expect(fraction.parentElement!.lastElementChild?.textContent).toBe('c');
    expect(screen.getByRole('region', { name: '公式，可橫向捲動' }).tabIndex).toBe(0);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText('核對原始公式'));
    expect(details.open).toBe(true);
    expect(screen.getByLabelText('原始公式').textContent).toBe(formula);
  });

  it('binds superscripts before division and preserves grouped denominators', () => {
    const { container } = render(<StudyFormula formula="a^b/(c+d)" />);
    const fraction = container.querySelector('mfrac')!;
    expect(fraction.firstElementChild?.localName).toBe('msup');
    expect([...fraction.firstElementChild!.children].map((child) => child.textContent)).toEqual(['a', 'b']);
    expect(fraction.lastElementChild?.textContent).toBe('(c+d)');
    expect(fraction.lastElementChild?.localName).toBe('mrow');
  });

  it('associates repeated division left to right', () => {
    const { container } = render(<StudyFormula formula="a/b/c" />);
    const outer = container.querySelector('math > mfrac')!;
    expect(outer.firstElementChild?.localName).toBe('mfrac');
    expect([...outer.firstElementChild!.children].map((child) => child.textContent)).toEqual(['a', 'b']);
    expect(outer.lastElementChild?.textContent).toBe('c');
  });

  it('keeps unary negation outside a power and a negative exponent inside it', () => {
    const { container } = render(<StudyFormula formula="-x^2+x^-2" />);
    const powers = container.querySelectorAll('msup');
    expect([...powers[0].children].map((child) => child.textContent)).toEqual(['x', '2']);
    expect(powers[0].previousElementSibling?.textContent).toBe('-');
    expect([...powers[1].children].map((child) => child.textContent)).toEqual(['x', '-2']);
  });

  it('renders both scripts, braced expressions, roots, decimals and Greek symbols', () => {
    const { container } = render(<StudyFormula formula="x_{i+1}^2 = sqrt(α/2) + √(.5)" />);
    const scripts = container.querySelector('msubsup')!;
    expect([...scripts.children].map((child) => child.textContent)).toEqual(['x', 'i+1', '2']);
    expect([...container.querySelectorAll('msqrt')].map((root) => root.textContent)).toEqual(['α2', '.5']);
    expect(container.querySelector('msqrt mfrac mi')?.textContent).toBe('α');
    expect(container.querySelector('msqrt mn')?.textContent).toBe('2');
    for (const node of container.querySelectorAll('math *')) expect(node.namespaceURI).toBe(MATH_NAMESPACE);
  });

  it.each([
    ['implicit multiplication', '2x + 1'],
    ['ambiguous denominator', 'a/bc'],
    ['unrecognized function', 'sin(x)'],
    ['LaTeX', String.raw`\frac{a}{b}`],
    ['Chinese notation', '速度 = 距離 / 時間'],
    ['missing close', '(a+b'],
    ['missing operand', 'a /'],
    ['extra closing token', 'a+b)'],
    ['duplicate exponent', 'a^b^c'],
    ['duplicate subscript', 'x_1_2'],
    ['unbounded root extent', '√x+1'],
    ['unsupported suffix', 'x^2;'],
    ['empty group', 'a+()'],
    ['dollar delimiters', '$x^2$'],
    ['bidirectional control', 'a+\u202eb'],
    ['deeply nested groups', '('.repeat(20) + 'x' + ')'.repeat(20)],
    ['long source', 'x'.repeat(201)],
    ['too many tokens', 'x+'.repeat(61) + 'x'],
  ])('preserves %s verbatim instead of guessing or partially rendering', (_label, formula) => {
    const { container } = render(<StudyFormula formula={formula} />);
    expect(container.querySelector('math')).toBeNull();
    expect(screen.getByLabelText('原始公式').textContent).toBe(formula);
    expect(screen.getByText('此格式先保留原文，請對照教材。')).toBeTruthy();
  });

  it('treats supplied markup and URLs as literal text without creating elements', () => {
    const formula = '<img src="https://example.com/x" onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(<StudyFormula formula={formula} />);
    expect(container.querySelector('img, script, iframe, a, math')).toBeNull();
    expect(screen.getByLabelText('原始公式').textContent).toBe(formula);
  });

  it('does not evaluate or invent a correction for a mathematically undefined expression', () => {
    const { container } = render(<StudyFormula formula="1/0" />);
    expect([...container.querySelector('mfrac')!.children].map((child) => child.textContent)).toEqual(['1', '0']);
    expect(screen.getByLabelText('原始公式').textContent).toBe('1/0');
  });

  it('accepts a complete bounded expression while rejecting empty input', () => {
    expect(parseStudyFormula('a × b · c ÷ d ≤ 1.5')).not.toBeNull();
    expect(parseStudyFormula('x^2_1')).not.toBeNull();
    expect(parseStudyFormula('x^{a^2}')).not.toBeNull();
    expect(parseStudyFormula('')).toBeNull();
    expect(parseStudyFormula('   ')).toBeNull();
  });

  it('replaces both notation and original text when the teaching step changes', () => {
    const view = render(<StudyFormula formula="a/b" />);
    expect(view.container.querySelector('mfrac')).toBeTruthy();
    view.rerender(<StudyFormula formula="新步驟：總分 / 人數" />);
    expect(view.container.querySelector('math')).toBeNull();
    expect(screen.getByLabelText('原始公式').textContent).toBe('新步驟：總分 / 人數');
    expect(view.container.textContent).not.toContain('a/b');
  });
});
