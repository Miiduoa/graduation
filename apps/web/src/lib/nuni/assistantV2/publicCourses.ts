import {
  resolvePublicCourseAssistantIntent,
  type PublicCourseAssistantIntent,
  type PublicCourseAssistantSearch,
} from '@campus/shared/src/publicCourseAssistant';
import { publicCourseCompoundRequest } from '@campus/shared/src/publicCourseCompound';
import { isPublicCourseOperationQuery, resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import { hasPublicCourseFilters, parsePublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { fail, object, type Obj } from './contracts';

// A public catalog's first read may download a complete school snapshot. The
// request remains bounded and does not extend the overall assistant deadline.
export const PUBLIC_COURSE_TOOL_TIMEOUT_MS = 12_000;

function publicCourseIntents(question: string, schoolId: string): PublicCourseAssistantIntent[] {
  const compound = publicCourseCompoundRequest(question, schoolId);
  const intents = compound ? compound.clauses.map(clause => clause.publicCourseIntent)
    : [resolvePublicCourseAssistantIntent(question, schoolId)];
  return intents.filter((intent): intent is PublicCourseAssistantIntent => !!intent);
}

export function publicCourseSearches(question: string, schoolId: string): PublicCourseAssistantSearch[] {
  return publicCourseIntents(question, schoolId)
    .filter((intent): intent is PublicCourseAssistantSearch => intent.kind === 'search');
}

export function publicCourseClarifications(question: string, schoolId: string): string[] {
  return [...new Set(publicCourseIntents(question, schoolId)
    .flatMap(intent => intent.kind === 'clarify' ? [intent.content] : []))];
}

export function publicCourseArguments(search: PublicCourseAssistantSearch): Obj {
  const raw = object(search);
  const input: Obj = {};
  // Project known data properties before flattening. In particular a malformed
  // filter object must never replace the requested school or query.
  for (const key of ['kind', 'schoolId', 'query', 'filters']) {
    const property = Object.getOwnPropertyDescriptor(raw, key);
    if (!property && key === 'filters') continue;
    if (!property?.enumerable || !('value' in property) || property.value === undefined) return fail();
    input[key] = property.value;
  }
  if (input.kind !== 'search') return fail();
  const filters = parsePublicCourseFilters(Object.hasOwn(input, 'filters') ? input.filters : {});
  if (!filters) return fail();
  return { schoolId: input.schoolId, query: input.query, ...filters };
}

/** Keep title words out of private-domain selection, while retaining every other clause. */
export function taskQuestionOutsidePublicCourses(question: string, schoolId: string): string {
  const compound = publicCourseCompoundRequest(question, schoolId);
  if (compound) return compound.clauses.filter(clause => !clause.publicCourseIntent)
    .map(clause => clause.question).join('，');
  return resolvePublicCourseAssistantIntent(question, schoolId) ? '' : question;
}

/** A public lookup accepts only reviewed schools and exact supported filters. */
export function parsePublicCourseArguments(raw: unknown): PublicCourseAssistantSearch {
  const record = object(raw);
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== null && prototype !== Object.prototype) return fail();
  const args: Obj = {};
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !['schoolId', 'query', 'weekday', 'credits'].includes(key)) return fail();
    const property = Object.getOwnPropertyDescriptor(record, key);
    if (!property?.enumerable || !('value' in property) || property.value === undefined) return fail();
    args[key] = property.value;
  }
  const operation = typeof args.schoolId === 'string' ? resolvePublicCourseOperation(args.schoolId) : null;
  if (!operation || !isPublicCourseOperationQuery(args.query) || args.query.trim() !== args.query ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(args.query)) return fail();
  const input: Obj = {};
  for (const key of ['weekday', 'credits']) if (args[key] !== undefined) input[key] = args[key];
  const filters = parsePublicCourseFilters(input);
  if (!filters) return fail();
  return { kind: 'search', schoolId: operation.schoolId, query: args.query,
    ...(hasPublicCourseFilters(filters) ? { filters } : {}) };
}
