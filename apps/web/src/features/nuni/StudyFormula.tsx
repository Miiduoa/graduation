import { createElement, type ReactNode } from 'react';
import { parseStudyFormula, type StudyFormulaNode } from './studyFormula';
import styles from './StudyFormula.module.css';

function renderFormula(node: StudyFormulaNode): ReactNode {
  // React's runtime creates MathML nodes in the math namespace. Keep tags local
  // and fixed because the installed React JSX types do not define MathML tags.
  switch (node.kind) {
    case 'token': return createElement(node.tag, null, node.text);
    case 'row': return createElement('mrow', null, ...node.children.map(renderFormula));
    case 'fraction': return createElement('mfrac', null, renderFormula(node.numerator), renderFormula(node.denominator));
    case 'root': return createElement('msqrt', null, renderFormula(node.body));
    case 'script':
      if (node.sub && node.sup) return createElement('msubsup', null, renderFormula(node.base), renderFormula(node.sub), renderFormula(node.sup));
      if (node.sub) return createElement('msub', null, renderFormula(node.base), renderFormula(node.sub));
      return createElement('msup', null, renderFormula(node.base), node.sup ? renderFormula(node.sup) : null);
  }
}

export function StudyFormula({ formula }: { formula: string }) {
  const expression = parseStudyFormula(formula);
  return (
    <figure className={styles.root}>
      <figcaption className={styles.caption}>教材公式</figcaption>
      {expression ? <>
        <div className={styles.rendered} tabIndex={0} role="region" aria-label="公式，可橫向捲動">
          {createElement('math', { display: 'block', 'aria-label': formula }, renderFormula(expression))}
        </div>
        <details className={styles.original}>
          <summary>核對原始公式</summary>
          <pre className={styles.source} aria-label="原始公式">{formula}</pre>
        </details>
      </> : <>
        <pre className={styles.source} aria-label="原始公式">{formula}</pre>
        <p className={styles.note}>此格式先保留原文，請對照教材。</p>
      </>}
    </figure>
  );
}
