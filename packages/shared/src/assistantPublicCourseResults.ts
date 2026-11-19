import {
  publicCourseAssistantRead,
  type PublicCourseAssistantRead,
  type PublicCourseAssistantSearch,
} from './publicCourseAssistant';
import { isPublicCourseOperationQuery } from './publicCourseOperations';
import { hasPublicCourseFilters, parsePublicCourseFilters } from './publicCourseFilters';

export type AssistantPublicCourseResult = { search: PublicCourseAssistantSearch; data: unknown };

function record(value: unknown, fields: string[], required = fields): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return null;
    result[key] = descriptor.value;
  }
  return required.every(key => Object.prototype.hasOwnProperty.call(result, key)) ? result : null;
}

/** Copy data properties only before passing them to existing catalog validators.
 * This also gives the complete result group a bounded size and nesting depth.
 */
function copyJson(value: unknown, budget: { bytes: number; nodes: number }, depth = 0): unknown {
  if (--budget.nodes < 0 || depth > 10) throw new Error('Result too large');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return value;
  }
  if (typeof value === 'string') {
    for (const character of value) {
      const code = character.codePointAt(0)!;
      budget.bytes -= code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (budget.bytes < 0) throw new Error('Result too large');
    }
    return value;
  }
  if (!value || typeof value !== 'object') throw new Error('Invalid data');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null))
    throw new Error('Invalid data prototype');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > budget.nodes) throw new Error('Result too large');
  const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
  if (array && (value.length > 50 || keys.length !== value.length + 1)) throw new Error('Invalid list');
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || (array && !/^(?:0|[1-9]\d*)$/.test(key))) throw new Error('Invalid field');
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Invalid field');
    copyJson(key, budget, depth + 1);
    const copied = copyJson(descriptor.value, budget, depth + 1);
    if (array) (result as unknown[])[Number(key)] = copied;
    else (result as Record<string, unknown>)[key] = copied;
  }
  return result;
}

/** Accept the whole group or none of it. Links and source labels are rebuilt
 * from the reviewed search/catalog contract; response-supplied links are not used.
 */
export function parseAssistantPublicCourseResults(raw: unknown): PublicCourseAssistantRead[] | null {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 12) return null;
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).length !== raw.length + 1) return null;
    const budget = { bytes: 512 * 1024, nodes: 50_000 };
    const reads: PublicCourseAssistantRead[] = [];
    for (let index = 0; index < raw.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      const item = record(descriptor.value, ['search', 'data']);
      if (!item) return null;
      const input = record(item.search, ['kind', 'schoolId', 'query', 'filters'], ['kind', 'schoolId', 'query']);
      if (!input || input.kind !== 'search' || typeof input.schoolId !== 'string' || !['nthu', 'ncnu'].includes(input.schoolId) ||
          !isPublicCourseOperationQuery(input.query) || input.query.trim() !== input.query ||
          /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input.query)) return null;
      const filterInput = Object.prototype.hasOwnProperty.call(input, 'filters')
        ? record(input.filters, ['weekday', 'credits'], []) : {};
      const filters = parsePublicCourseFilters(filterInput);
      if (!filters) return null;
      const search: PublicCourseAssistantSearch = { kind: 'search',
        schoolId: input.schoolId as PublicCourseAssistantSearch['schoolId'], query: input.query,
        ...(hasPublicCourseFilters(filters) ? { filters } : {}) };
      const data = copyJson(item.data, budget);
      if (data && typeof data === 'object' && !Array.isArray(data) &&
          (data as Record<string, unknown>).partial === true) return null;
      reads.push(publicCourseAssistantRead(search, data));
    }
    return reads;
  } catch {
    return null;
  }
}
