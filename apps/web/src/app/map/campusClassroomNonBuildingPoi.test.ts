import { describe, expect, it } from 'vitest';
import {
  resolveCampusClassroom,
} from '@campus/shared/src/campusClassroomLookup';
import {
  PROVIDENCE_BUS_STOPS,
  type CampusMapPlaceLike,
} from '@campus/shared/src/providenceCampus';

// Synthetic colliding POI labels: NOT a claim about the physical location of
// any classroom, entrance, road, or building floor.
const hall: CampusMapPlaceLike = {
  id: 'synthetic-hall',
  name: '主顧樓',
  category: '教學',
  description: '',
  lat: 24.226939,
  lng: 120.583587,
};

describe('classroom map destination classification', () => {
  it('does not select a homonymous bus stop instead of the building for PH303', () => {
    const bus = {
      ...hall, id: 'synthetic-bus', category: '公車站',
      building: '主顧樓',
    };
    for (const query of ['PH303', '主顧樓 PH303', '主顧303']) {
      const result = resolveCampusClassroom({
        schoolId: 'pu', query, locations: [bus, hall],
      });
      expect(result.status, query).toBe('matched');
      expect(result.matches, query).toEqual([hall]);
    }
  });

  it('does not turn the real named campus bus stop into a classroom destination', () => {
    const zhuguStop = PROVIDENCE_BUS_STOPS.find((stop) => stop.id === 'pu-bus-zhugu');
    expect(zhuguStop).toBeDefined();
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: '靜宜大學主顧樓 PH303',
      locations: [zhuguStop!],
    });
    expect(result.status).toBe('unmatched');
    expect(result.matches).toEqual([]);
  });

  it('rejects transport and parking aliases even if a record has a building field', () => {
    for (const category of [
      '公車站', '公車站牌', '公車', '交通', '停車', '道路',
      'bus', 'bus stop', 'bus_stop', 'transit', 'parking', 'road',
    ]) {
      const stop = {
        ...hall, category, name: '服務站', building: '主顧樓',
      };
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [stop],
      }).matches, category).toEqual([]);
    }
  });

  it('does not block legitimate non-teaching building categories or another school', () => {
    for (const category of ['教學', '圖書館', '住宿']) {
      const building = { ...hall, category };
      const result = resolveCampusClassroom({
        schoolId: 'school-b', query: '主顧樓 PH303', locations: [building],
      });
      expect(result.status, category).toBe('matched');
      expect(result.matches, category).toEqual([building]);
    }
  });

  it('rejects common parking, shuttle and gate aliases without selecting a wrong classroom destination', () => {
    for (const category of [
      '停車場', '校車站', '接駁站', '巴士站', '校門', '出入口',
      'bus station', 'bus_station', 'shuttle stop', 'shuttle_stop',
      'car park', 'car_park', 'gate', 'entrance',
    ]) {
      const unrelatedPOI = {
        ...hall, id: `synthetic-${category}`, name: '服務設施',
        building: '主顧樓', category,
      };
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [unrelatedPOI, hall],
      });
      expect(result.status, category).toBe('matched');
      expect(result.matches, category).toEqual([hall]);
    }
  });

  it('rejects qualified stop labels but preserves exact building-category boundaries', () => {
    for (const category of ['公車站（校內）', 'Bus Stop (Campus)', '停車場 (P1)']) {
      const stop = {
        ...hall, id: 'synthetic-qualified-stop', category, building: '主顧樓',
      };
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [stop],
      }).status, category).toBe('unmatched');
    }
    for (const category of ['教學 (校內)', '圖書館（主校區）', '交通工程學院']) {
      const building = { ...hall, category };
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [building],
      });
      expect(result.status, category).toBe('matched');
      expect(result.matches, category).toEqual([building]);
    }
  });
});
