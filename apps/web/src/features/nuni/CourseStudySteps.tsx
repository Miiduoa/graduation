'use client';

import { useId } from 'react';
import type { StudyTutorStep } from '@/lib/studyTutor';
import { StudyFormula } from './StudyFormula';
import styles from './CourseStudyPanel.module.css';

type Props = {
  steps: StudyTutorStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onLocate: () => void;
  evidenceAvailable: boolean;
};

/** Navigation is local to the displayed lesson; saved answers remain separate. */
export function CourseStudySteps({ steps, activeIndex, onSelect, onLocate, evidenceAvailable }: Props) {
  const headingId = useId();
  const contentId = useId();
  const stepHeadingId = useId();
  const step = steps[activeIndex];
  if (!step) return null;

  return (
    <section className={styles.studySteps} aria-labelledby={headingId}>
      <h5 id={headingId}>一步一步理解</h5>
      <p className={styles.note} role="status" aria-live="polite">
        第 {activeIndex + 1} 步，共 {steps.length} 步
      </p>
      <div className={styles.studyStepsBody}>
        <nav aria-label="講解步驟">
          <ol className={styles.studyStepList}>
            {steps.map((item, index) => <li key={index}>
              <button type="button" className={styles.studyStepButton}
                aria-current={index === activeIndex ? 'step' : undefined} aria-controls={contentId}
                onClick={() => onSelect(index)}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span>第 {index + 1} 步：{item.title}</span>
              </button>
            </li>)}
          </ol>
        </nav>
        <section id={contentId} className={styles.studyStepContent} aria-labelledby={stepHeadingId}>
          <h6 id={stepHeadingId}>{step.title}</h6>
          <p className={styles.explanationText}>{step.explanation}</p>
          {step.formula && <StudyFormula formula={step.formula} />}
          <p className={styles.note}>這一步的教材依據</p>
          <blockquote className={styles.evidenceQuote}>{step.sourceQuote}</blockquote>
          <button type="button" className={styles.button} disabled={!evidenceAvailable} onClick={onLocate}>
            定位這一步的原文
          </button>
        </section>
      </div>
      <div className={styles.studyStepActions}>
        <button type="button" className={styles.button} disabled={activeIndex === 0}
          onClick={() => onSelect(activeIndex - 1)}>上一步</button>
        <button type="button" className={styles.button} disabled={activeIndex === steps.length - 1}
          onClick={() => onSelect(activeIndex + 1)}>下一步</button>
      </div>
    </section>
  );
}
