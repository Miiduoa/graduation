import { describe, expect, it } from 'vitest';
import { createExampleBuildingPlan } from './buildingPlan';
import { exportBuildingPlanSvg } from './buildingPlanSvg';

const scope = { schoolId: 'pu', buildingId: 'test-building' };

describe('printable building plan SVG', () => {
  it('exports every floor and labelled rooms without referring to external resources', () => {
    const plan = createExampleBuildingPlan(scope);
    const svg = exportBuildingPlanSvg(plan);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 960 838"');
    expect(svg).toContain('1F');
    expect(svg).toContain('2F');
    expect(svg).toContain('範例教室 101');
    expect(svg).toContain('範例教室 202');
    expect(svg).toContain('待核對圖面');
    expect(svg).not.toMatch(/<(script|image|foreignObject)\b|href=|url\(/i);
  });
  it('can download only the explicitly selected floor', () => {
    const plan = createExampleBuildingPlan(scope);
    const svg = exportBuildingPlanSvg(plan, 'example-2');
    expect(svg).toContain('viewBox="0 0 960 488"');
    expect(svg).toContain('範例教室 201');
    expect(svg).not.toContain('範例教室 101');
    expect(() => exportBuildingPlanSvg(plan, 'missing')).toThrow(/找不到所選樓層/);
  });
  it.each([
    { script: 'script', svgTag: 'svg', onload: 'onload', img: 'img' },
    { script: 'SCRIPT', svgTag: 'SVG', onload: 'ONLOAD', img: 'IMG' },
    { script: 'ScRiPt', svgTag: 'SvG', onload: 'OnLoAd', img: 'ImG' },
  ])('escapes unsafe $script names and never exports provenance URLs', ({ script, svgTag, onload, img }) => {
    const plan = createExampleBuildingPlan(scope);
    plan.name = `<${script}>alert("oops")</${script}> & test`;
    plan.floors[0].label = `1F <${svgTag} ${onload}="x">`;
    plan.floors[0].rooms[0].name = `A&B <${img} src=x>`;
    plan.source = { label: `來源 <${script}>`, url: 'https://example.com/path?token=secret' };
    const svg = exportBuildingPlanSvg(plan, 'example-1');
    expect(svg).toContain(`&lt;${script}&gt;alert(&quot;oops&quot;)&lt;/${script}&gt; &amp; test`);
    expect(svg).toContain(`A&amp;B &lt;${img} src=x&gt;`);
    expect(svg).toContain(`來源 &lt;${script}&gt;`);
    expect(svg).not.toContain('https://example.com');
    expect(svg).not.toMatch(/<script|<img|<svg[^>]+onload=|href=/i);

    // Parse the exported document to verify names remain text, not executable markup.
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('#plan-title')?.textContent).toBe(`${plan.name} · 待核對平面圖`);
    expect(Array.from(document.querySelectorAll('text'), element => element.textContent)).toEqual(
      expect.arrayContaining([plan.name, plan.floors[0].label, plan.floors[0].rooms[0].name, `來源：${plan.source.label}`]),
    );
  });
  it('does not suggest an unknown scale is measured in metres', () => {
    const plan = createExampleBuildingPlan(scope);
    plan.units = 'relative';
    const svg = exportBuildingPlanSvg(plan);
    expect(svg).toContain('未校正比例／示意單位');
    expect(svg).toContain('不能用於實際尺寸量測');
  });
});
