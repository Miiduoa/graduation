import { resolvePublicCourseAssistantIntent, type PublicCourseAssistantIntent } from './publicCourseAssistant';
import { splitPublicCourseClauses } from './publicCourseClauses';

export type PublicCourseCompoundRequest = {
  clauses: { question: string; publicCourseIntent: PublicCourseAssistantIntent | null }[];
};

/** A routing hint, never authority to execute. Unknown clauses are retained
 * verbatim so the complete request can be handled or explicitly left unresolved.
 */
export function publicCourseCompoundRequest(
  question: string,
  selectedSchoolId?: string | null,
): PublicCourseCompoundRequest | null {
  const clauses = splitPublicCourseClauses(question);
  if (!clauses || clauses.length < 2 || clauses.length > 12) return null;
  const result = clauses.map(clause => ({
    question: clause,
    publicCourseIntent: resolvePublicCourseAssistantIntent(clause, selectedSchoolId),
  }));
  return result.some(clause => clause.publicCourseIntent) ? { clauses: result } : null;
}
