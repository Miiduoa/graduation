'use strict';

const {
  canonicalizeSchoolId,
  resolvePublicSchoolRecord,
  resolveWeatherLocation,
  resolveRouteOrigin,
  buildGroundedWebQuery,
  findExplicitSchoolMentions,
} = require('./assistantPublicSchoolContext');

describe('assistantPublicSchoolContext', () => {
  test('canonicalizes tw-pu to pu and resolves catalog label', () => {
    expect(canonicalizeSchoolId('tw-pu')).toBe('pu');
    expect(resolvePublicSchoolRecord('tw-pu')).toMatchObject({
      schoolId: 'pu',
      name: '靜宜大學',
    });
    expect(resolvePublicSchoolRecord('ntu')?.name).toBe('國立臺灣大學');
    expect(resolvePublicSchoolRecord('unknown-school')).toBeNull();
  });

  test('route origin prefers explicit text over selected school', () => {
    expect(resolveRouteOrigin({ explicitOrigin: '台大', schoolId: 'pu' })).toEqual({
      origin: '台大',
      source: 'explicit',
    });
    expect(resolveRouteOrigin({ schoolId: 'ncku' })).toEqual({
      origin: '國立成功大學',
      source: 'school',
    });
    expect(resolveRouteOrigin({ schoolId: 'nope' })).toEqual({
      needsOrigin: true,
      schoolLabel: null,
    });
  });

  test('ordinary PU weather chatter uses selected locality; connective words are not places', () => {
    for (const query of [
      '今天需要帶傘嗎？',
      '今天會下雨嗎？',
      '今天天氣如何？',
      '今天的天氣怎麼樣',
      '要不要帶傘',
    ]) {
      expect(resolveWeatherLocation({ query, schoolId: 'pu' }).location).toMatchObject({
        latitude: 24.226,
        longitude: 120.563,
      });
    }
  });

  test('unlisted city names never fall through to selected-school PU weather', () => {
    for (const query of ['東京今天天氣', '巴黎天氣', '紐約今天會下雨嗎', '明天的香港天氣']) {
      const result = resolveWeatherLocation({ query, schoolId: 'pu' });
      expect(result).toMatchObject({ unavailable: true, reason: 'unknown_locality' });
      expect(result.location).toBeUndefined();
      expect(result.message).not.toMatch(/沙鹿|靜宜大學/);
    }
  });

  test('weather uses verified localities only; unknown city and non-PU school stay unavailable', () => {
    expect(resolveWeatherLocation({ query: '靜宜天氣', schoolId: 'ntu' }).location).toMatchObject({
      latitude: 24.226,
      longitude: 120.563,
    });
    expect(resolveWeatherLocation({ query: '今天天氣', schoolId: 'pu' }).location.name).toContain(
      '沙鹿',
    );
    expect(resolveWeatherLocation({ query: '高雄天氣', schoolId: 'pu' })).toMatchObject({
      unavailable: true,
      reason: 'unknown_locality',
    });
    expect(resolveWeatherLocation({ query: '臺北今天天氣', schoolId: 'pu' })).toMatchObject({
      unavailable: true,
      reason: 'unknown_locality',
    });
    expect(resolveWeatherLocation({ query: '今天天氣', schoolId: 'ntpu' })).toMatchObject({
      unavailable: true,
      reason: 'missing_location',
    });
    expect(resolveWeatherLocation({ query: '臺北今天天氣', schoolId: 'pu' }).message).not.toMatch(
      /已驗證|座標/,
    );
    expect(resolveWeatherLocation({ query: '今天天氣', schoolId: 'ntu' }).message).not.toMatch(
      /靜宜|沙鹿/,
    );
  });

  test('web grounding preserves explicit other-school names and aliases', () => {
    expect(findExplicitSchoolMentions('臺大宿舍規定').some((hit) => hit.schoolId === 'ntu')).toBe(
      true,
    );
    expect(buildGroundedWebQuery('臺大宿舍規定', 'pu')).toBe('臺大宿舍規定');
    expect(buildGroundedWebQuery('國立臺灣大學宿舍規定', 'pu')).toBe('國立臺灣大學宿舍規定');
    expect(buildGroundedWebQuery('選課規定', 'ntu')).toBe('國立臺灣大學 選課規定');
    expect(buildGroundedWebQuery('什麼是光合作用', 'ntu')).toBe('什麼是光合作用');
  });
});
