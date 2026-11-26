// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertTronClassStudentEnrollment } from './tronClassCourseEnrollment';

const FLAGS = '<input type="hidden" id="courseId" value="101"><input type="hidden" id="enrollment-is-student" value="True">';
const PAGE = `<!doctype html><html><body>${FLAGS}</body></html>`;

describe('positive server-rendered TronClass enrollment', () => {
  it('accepts exactly one real hidden course ID and the exact student flag', () => {
    expect(() => assertTronClassStudentEnrollment(PAGE, 101)).not.toThrow();
    expect(() => assertTronClassStudentEnrollment(FLAGS.replaceAll('type="hidden"', 'type="HIDDEN"'), 101)).not.toThrow();
  });

  it('does not count strings inside comments or scripts as actual duplicate elements', () => {
    const markup = `${PAGE}<script>const sample = '${FLAGS}';</script><!-- ${FLAGS} -->`;
    expect(() => assertTronClassStudentEnrollment(markup, 101)).not.toThrow();
  });

  it.each([
    FLAGS.replace('value="True"', 'value="False"'), FLAGS.replace('value="True"', 'value="true"'),
    FLAGS.replace('value="True"', 'value="1"'), FLAGS.replace('value="True"', 'value=" True "'),
    FLAGS.replace('value="True"', ''), FLAGS.replace('id="enrollment-is-student"', 'id="other"'),
    FLAGS.replace('value="101"', 'value="102"'), FLAGS.replace('value="101"', 'value="0101"'),
    FLAGS.replace('type="hidden"', 'type="text"'), FLAGS.replace('type="hidden"', ''),
    '<div id="courseId" value="101"></div><div id="enrollment-is-student" value="True"></div>',
    `<script>const html = '${FLAGS}';</script>`, `<!-- ${FLAGS} -->`, `<template>${FLAGS}</template>`,
    `<textarea>${FLAGS}</textarea>`, `<noscript>${FLAGS}</noscript>`,
    `${FLAGS}<div id="enrollment-is-student"></div>`, `${FLAGS}<input id="courseId" type="text" value="101">`,
    `<input id="courseId" type="hidden" value="101">${FLAGS}`,
    `${FLAGS}<template><input id="courseId" type="hidden" value="101"></template>`,
    FLAGS.replace('value="True"', 'value="True" value="False"'),
    FLAGS.replace('type="hidden"', 'type="hidden" type="text"'),
    FLAGS.replace('value="True"', 'value="True\u0000"'),
  ])('refuses missing, foreign, unknown, duplicated or inert enrollment markup (%#)', html => {
    expect(() => assertTronClassStudentEnrollment(html, 101)).toThrow('TRONCLASS_COURSE_ACCESS_DENIED');
  });

  it.each([null, undefined, [], [PAGE], { html: PAGE }, 101, '', `${PAGE}${'界'.repeat(700_000)}`])(
    'rejects non-string, empty or oversized HTML without inspecting it (%#)', html => {
      expect(() => assertTronClassStudentEnrollment(html, 101)).toThrow('TRONCLASS_COURSE_ACCESS_DENIED');
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '101', ['101']])('requires a positive numeric course ID (%#)', courseId => {
    expect(() => assertTronClassStudentEnrollment(PAGE, courseId as number)).toThrow('TRONCLASS_COURSE_ACCESS_DENIED');
  });

  it('returns only a fixed access error and never includes the received page', () => {
    expect(() => assertTronClassStudentEnrollment('<html>private school response</html>', 101))
      .toThrowError(expect.objectContaining({ status: 403, code: 'TRONCLASS_COURSE_ACCESS_DENIED', message: 'TRONCLASS_COURSE_ACCESS_DENIED' }));
  });
});
