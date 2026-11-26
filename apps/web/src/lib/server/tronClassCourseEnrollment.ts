import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { NuniError } from '@campus/shared/src/nuni';

type HtmlNode = DefaultTreeAdapterMap['node'];
function denied(): never { throw new NuniError(403, 'TRONCLASS_COURSE_ACCESS_DENIED'); }

/**
 * Official public course module 22033 (66297.9aa2f6d5.js) reads courseId and
 * tests enrollment-is-student against the exact server-rendered value "True".
 * A normalized course.role can default to student, so it is not this evidence.
 * Call only for the fixed authenticated course GET, never caller-supplied HTML.
 * This checks one enrollment observation; it grants no submission permission.
 */
export function assertTronClassStudentEnrollment(html: unknown, courseId: number): void {
  if (typeof courseId !== 'number' || !Number.isSafeInteger(courseId) || courseId <= 0 ||
    typeof html !== 'string' || !html || Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024) return denied();
  let ambiguousAttributes = false;
  const document = parse(html, { onParseError(error) {
    if (error.code === 'duplicate-attribute' || error.code === 'unexpected-null-character') ambiguousAttributes = true;
  } });
  if (ambiguousAttributes) return denied();
  const matches: { node: HtmlNode; inert: boolean }[] = [];
  const pending: { node: HtmlNode; inert: boolean }[] = [{ node: document, inert: false }];
  while (pending.length) {
    const entry = pending.pop()!;
    const { node, inert } = entry;
    if ('attrs' in node && node.attrs.some(attribute => attribute.name === 'id' &&
      (attribute.value === 'courseId' || attribute.value === 'enrollment-is-student'))) matches.push(entry);
    if ('childNodes' in node) {
      for (const child of node.childNodes) pending.push({ node: child, inert });
    }
    // Template nodes are never active enrollment evidence; a colliding ID in
    // their inert content is ambiguous too. Script/comment strings are not HTML.
    if (node.nodeName === 'template' && 'content' in node) pending.push({ node: node.content, inert: true });
  }
  for (const [key, value] of [['courseId', String(courseId)], ['enrollment-is-student', 'True']]) {
    const entries = matches.filter(({ node }) => 'attrs' in node && node.attrs.some(attribute => attribute.name === 'id' && attribute.value === key));
    if (entries.length !== 1) return denied();
    const { node, inert } = entries[0];
    if (inert || !('tagName' in node) || node.tagName !== 'input' || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      node.attrs.find(attribute => attribute.name === 'type')?.value.toLowerCase() !== 'hidden' ||
      node.attrs.find(attribute => attribute.name === 'value')?.value !== value) return denied();
  }
}
