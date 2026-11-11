// @vitest-environment node
import { expect, it } from 'vitest';
import { projectPlatformPublicAgent } from './platformPublicAgentProjector';
const op = 'pago_11111111-1111-1111-1111-111111111111';
const scope = { schoolId: 'pu', query: '我在甲樓想去乙館', requestId: 'req_0000001' };
const request = {
  task: 'public-campus-navigation',
  data: {
    task: 'public-campus-navigation',
    phase: 'execute',
    ...scope,
    consent: {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      version: 1,
      schoolId: scope.schoolId,
      query: scope.query,
      fingerprint: 'f'.repeat(64),
    },
  },
};
const disclosure = {
  request,
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  dataScope: ['校園', '問題', '公開地點名稱與 ID'],
  sourceDate: '2026-10-19',
  sourceLabel: 'OSM',
  placeCount: 2,
};
const plan = { kind: 'navigation-plan', fromId: 'a', toId: 'b', fromName: '甲樓', toName: '乙館' };
const result = {
  status: 'completed',
  operationId: op,
  expiresAt: 123,
  result: {
    task: 'public-campus-navigation',
    schoolId: 'pu',
    sourceFingerprint: 'f'.repeat(64),
    checkedAt: 1,
    receipt: plan,
  },
};
const from = {
    id: 'a',
    name: '甲樓',
    lat: 24,
    lng: 120,
    sourceUrl: 'https://www.openstreetmap.org/way/1',
  },
  to = {
    id: 'b',
    name: '乙館',
    lat: 24.1,
    lng: 120.1,
    sourceUrl: 'https://www.openstreetmap.org/way/2',
  };
const receipt = {
  kind: 'walking-route',
  from,
  to,
  url: 'https://www.google.com/maps/dir/?api=1&origin=24%2C120&destination=24.1%2C120.1&travelmode=walking',
  sourceDate: '2026-10-19',
  sourceLabel: 'OSM',
  mode: 'groq',
};
const input = { approved: true, operationId: op, request, fromId: 'a', toId: 'b' };
it('preserves exact disclosure and validates Groq provider and model in the bound request', () => {
  expect(projectPlatformPublicAgent('prepareGroq', disclosure, scope)).toEqual(disclosure);
  expect(() =>
    projectPlatformPublicAgent('prepareGroq', { ...disclosure, model: 'other' }, scope),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'prepareGroq',
      {
        ...disclosure,
        request: {
          ...request,
          data: { ...request.data, consent: { ...request.data.consent, model: 'other' } },
        },
      },
      scope,
    ),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'prepareGroq',
      { ...disclosure, dataScope: ['校園', '問題', '私人課表'] },
      scope,
    ),
  ).toThrow();
});
it('projects a model plan without a link and accepts only explicit approved matching route', () => {
  expect(
    projectPlatformPublicAgent('execute', result, { confirmationId: 'pagc_test', request }),
  ).toEqual(result);
  expect(projectPlatformPublicAgent('route', { operationId: op, receipt }, input)).toEqual({
    operationId: op,
    receipt,
  });
  expect(() =>
    projectPlatformPublicAgent(
      'route',
      { operationId: op, receipt },
      { ...input, approved: false },
    ),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'route',
      { operationId: op, receipt },
      { ...input, fromId: 'different' },
    ),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'route',
      {
        operationId: op,
        receipt: { ...receipt, url: 'https://www.google.com.attacker.test/maps/dir/' },
      },
      input,
    ),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'route',
      {
        operationId: op,
        receipt: {
          ...receipt,
          from: { ...from, sourceUrl: 'https://www.openstreetmap.org.attacker.test/way/1' },
        },
      },
      input,
    ),
  ).toThrow();
});
it('treats provider quota failure as a terminal failed operation rather than success', () => {
  const failed = {
    status: 'failed',
    operationId: op,
    expiresAt: 123,
    failureCode: 'FREE_QUOTA_UNAVAILABLE',
  };
  expect(
    projectPlatformPublicAgent('execute', failed, { confirmationId: 'pagc_test', request }),
  ).toEqual(failed);
  expect(() =>
    projectPlatformPublicAgent(
      'execute',
      { ...failed, failureCode: ['FREE_QUOTA_UNAVAILABLE'] },
      { confirmationId: 'pagc_test', request },
    ),
  ).toThrow();
});
it('distinguishes a proven undelivered operation from an unknown failure code', () => {
  const failed = {
    status: 'failed',
    operationId: op,
    expiresAt: 123,
    failureCode: 'NOT_DISPATCHED',
  };
  expect(
    projectPlatformPublicAgent('execute', failed, { confirmationId: 'pagc_test', request }),
  ).toEqual(failed);
  expect(() =>
    projectPlatformPublicAgent(
      'execute',
      { ...failed, failureCode: 'UNKNOWN' },
      { confirmationId: 'pagc_test', request },
    ),
  ).toThrow();
});
it('projects only the known free assurance refusal as a terminal failure', () => {
  const failed = {
    status: 'failed',
    operationId: op,
    expiresAt: 123,
    failureCode: 'FREE_ASSURANCE_UNAVAILABLE',
  };
  expect(projectPlatformPublicAgent('execute', failed, { confirmationId: 'pagc_test', request })).toEqual(failed);
  expect(() => projectPlatformPublicAgent('execute', { ...failed, failureCode: 'FREE_ASSURANCE_FAKE' }, {
    confirmationId: 'pagc_test', request,
  })).toThrow();
});
it('projects reconciliation only when the failed result matches the requested operation', () => {
  const body = { task: 'public-campus-navigation', schoolId: 'pu', operationId: op };
  expect(
    projectPlatformPublicAgent('reconcile', { status: 'failed', operationId: op }, body),
  ).toEqual({ status: 'failed', operationId: op });
  expect(() =>
    projectPlatformPublicAgent('reconcile', { status: 'unknown', operationId: op }, body),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'reconcile',
      { status: 'failed', operationId: 'pago_22222222-2222-2222-2222-222222222222' },
      body,
    ),
  ).toThrow();
});
