import { describe, expect, it } from 'vitest';
import {
  resolveCampusClassroom,
} from '@campus/shared/src/campusClassroomLookup';
import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
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

  it('does not navigate to a restaurant or retail point that merely references the classroom building', () => {
    const realDiningPoint = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-jingyuan');
    expect(realDiningPoint?.category).toBe('餐飲');
    const foodPoint = { ...realDiningPoint!, id: 'synthetic-food-with-building-field', building: '主顧樓' };
    for (const category of [
      '餐飲', '餐廳', '咖啡廳', '商店', '販賣部',
      'restaurant', 'cafe', 'cafeteria', 'food court', 'food_court',
      'shop', 'store', 'convenience store', 'convenience_store', 'atm',
    ]) {
      const point = { ...foodPoint, category, name: '主顧樓' };
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [point, hall],
      });
      expect(result.status, category).toBe('matched');
      expect(result.matches, category).toEqual([hall]);
    }
    // The published dining POI is sourced, but the additional building field is
    // synthetic; no physical classroom/entrance assignment is inferred here.
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [foodPoint],
    }).status).toBe('unmatched');
  });

  it('rejects stacked short transit/retail category qualifiers without rejecting teaching buildings', () => {
    for (const category of [
      'Bus Stop (Campus) (Inbound)',
      '公車站（校內）（往返）',
      '餐飲 [校內] [B1]',
      'Restaurant (Main) (Open)',
    ]) {
      const point = { ...hall, id: 'synthetic-nonbuilding', category, building: '主顧樓' };
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [point, hall],
      });
      expect(result.status, category).toBe('matched');
      expect(result.matches, category).toEqual([hall]);
    }
    for (const category of ['教學 (主校區) (大樓)', '交通工程學院 (公車站)']) {
      const building = { ...hall, category };
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [building],
      }).status, category).toBe('matched');
    }
  });
});

describe('defensive classroom destination coordinates and category qualifiers', () => {
  it('does not navigate to unset (0, 0) coordinates for an otherwise matching hall', () => {
    const unset = { ...hall, id: 'synthetic-unset-coordinates', lat: 0, lng: 0 };
    const scoped = { schoolId: 'pu', query: 'PH303' };
    expect(resolveCampusClassroom({
      ...scoped, locations: [unset],
    }).status).toBe('unmatched');
    expect(resolveCampusClassroom({
      ...scoped, locations: [unset, hall],
    }).matches).toEqual([hall]);

    // A zero latitude OR longitude on its own is not an unset pair;
    // these are synthetic coordinates, not claims about a campus.
    for (const place of [
      { ...hall, lat: 0 },
      { ...hall, lng: 0 },
    ]) {
      expect(resolveCampusClassroom({
        ...scoped, locations: [place],
      }).matches).toEqual([place]);
    }
  });

  it('still excludes a known bus category after more than three full qualifiers', () => {
    const stop = {
      ...hall,
      id: 'synthetic-many-qualifiers-stop',
      category: 'Bus Stop (Campus) (Inbound) (Shuttle) (Temporary)',
      building: '主顧樓',
    };
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [stop, hall],
    });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([hall]);

    const legitimate = {
      ...hall,
      category: '交通工程學院 (Main) (North) (Level) (Wing)',
    };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [legitimate],
    }).matches).toEqual([legitimate]);
  });
});

describe('source-identified transport stops remain non-classroom destinations', () => {
  it('rejects a relabelled bundled stop even when its category and building name look like a hall', () => {
    const publishedStop = PROVIDENCE_BUS_STOPS.find((stop) => stop.id === 'pu-bus-zhugu');
    expect(publishedStop?.transitStopIds?.length).toBeGreaterThan(0);
    // The stop ID list comes from the bundled transit catalog. The changed
    // category/name/building are synthetic data-integrity regression inputs.
    const relabelledStop = {
      ...publishedStop!,
      id: 'synthetic-relabelled-stop',
      name: '主顧樓',
      category: '教學',
      building: '主顧樓',
    };
    const result = resolveCampusClassroom({
      schoolId: 'pu',
      query: 'PH303',
      locations: [relabelledStop, hall],
    });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([hall]);
    expect(resolveCampusClassroom({
      schoolId: 'pu',
      query: '主顧樓 PH303',
      locations: [relabelledStop],
    }).status).toBe('unmatched');
  });

  it('does not reject a genuine hall for an empty or whitespace-only optional transit marker', () => {
    for (const transitStopIds of [[], [' ', '']]) {
      const building = { ...hall, transitStopIds };
      const result = resolveCampusClassroom({
        schoolId: 'pu',
        query: 'PH303',
        locations: [building],
      });
      expect(result.status).toBe('matched');
      expect(result.matches).toEqual([building]);
    }
  });
});

describe('published stop identity survives missing imported metadata', () => {
  it('keeps a bundled Providence stop out of PH303 even when a Firestore row loses stop IDs and category', () => {
    const stop = PROVIDENCE_BUS_STOPS.find((entry) => entry.id === 'pu-bus-zhugu');
    expect(stop).toBeDefined();
    // This simulates an incomplete server row replacing the bundled stop by
    // the exact published ID. Name/category/building edits are synthetic.
    const { transitStopIds: _omitted, ...withoutOptionalMarker } = stop!;
    expect(_omitted?.length).toBeGreaterThan(0);
    const incompleteServerStop = {
      ...withoutOptionalMarker,
      name: '主顧樓',
      building: '主顧樓',
      category: '教學',
    };
    expect('transitStopIds' in incompleteServerStop).toBe(false);
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303',
      locations: [incompleteServerStop, hall],
    });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([hall]);
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: '主顧樓 PH303',
      locations: [incompleteServerStop],
    }).status).toBe('unmatched');
  });

  it('does not reserve guessed bus ID prefixes or apply Providence IDs to other schools', () => {
    const nonPublished = { ...hall, id: 'pu-bus-not-in-catalog' };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303',
      locations: [nonPublished],
    }).matches).toEqual([nonPublished]);

    const knownStopId = PROVIDENCE_BUS_STOPS.find((stop) => stop.id === 'pu-bus-zhugu')!.id;
    const otherSchoolBuilding = { ...hall, id: knownStopId };
    expect(resolveCampusClassroom({
      schoolId: 'other-school', query: '主顧樓 PH303',
      locations: [otherSchoolBuilding],
    }).matches).toEqual([otherSchoolBuilding]);
  });
});


describe('published building identity cannot drift into a classroom destination', () => {
  const sourcedHall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');

  it('rejects a moved known building ID rather than routing PH303 to a different point', () => {
    expect(sourcedHall?.sourceUrl).toBe('https://www.openstreetmap.org/way/255784268');
    // Only the changed coordinate is synthetic; it is NOT a surveyed location.
    const displaced = { ...sourcedHall!, lat: sourcedHall!.lat + 0.007 };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [displaced],
    }).status).toBe('unmatched');
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [displaced, sourcedHall!],
    }).matches).toEqual([]); // The same published ID is duplicated: fail closed.
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [sourcedHall!],
    }).matches).toEqual([sourcedHall]);
  });

  it('rejects a relabelled known ID but permits small coordinate refinements and other schools', () => {
    expect(sourcedHall).toBeDefined();
    const relabelled = { ...sourcedHall!, name: '合成錯誤名稱', building: '主顧樓' };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [relabelled],
    }).status).toBe('unmatched');
    const refined = { ...sourcedHall!, lat: sourcedHall!.lat + 0.0001, lng: sourcedHall!.lng - 0.0001 };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [refined],
    }).matches).toEqual([refined]);
    // Other schools do not inherit Providence's identity catalog.
    expect(resolveCampusClassroom({
      schoolId: 'other-school', query: '主顧樓 PH303', locations: [relabelled],
    }).matches).toEqual([relabelled]);
  });
});

describe('published Providence service identity is not a classroom building', () => {
  it('rejects a sourced dining POI relabelled as teaching while keeping its original name and coordinates', () => {
    const sourcedDining = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-jingyuan');
    expect(sourcedDining?.category).toBe('餐飲');
    // The original ID/name/coordinates are unchanged, so the existing
    // provenance identity check alone cannot detect this category edit.
    // This Firestore import corruption is synthetic, not a campus observation.
    const relabelledDining = {
      ...sourcedDining!,
      category: '教學',
      building: '主顧樓',
    };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [relabelledDining],
    }).status).toBe('unmatched');
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [relabelledDining, hall],
    }).matches).toEqual([hall]);
  });

  it('preserves a sourced real teaching building and isolation for another school', () => {
    const sourcedHall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');
    expect(sourcedHall?.category).toBe('教學');
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [sourcedHall!],
    }).matches).toEqual([sourcedHall]);

    // An identical ID at another school does not inherit Providence labels.
    const otherSchoolHall = {
      ...PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-jingyuan')!,
      category: '教學',
      building: '主顧樓',
    };
    expect(resolveCampusClassroom({
      schoolId: 'another-school', query: '主顧樓 PH303', locations: [otherSchoolHall],
    }).matches).toEqual([otherSchoolHall]);
  });
});


describe('published POI classroom routing never trusts an unrelated Firestore building alias', () => {
  it('does not redirect a sourced clinic or chapel to PH303 after synthetic building/category corruption', () => {
    const hallFromCatalog = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');
    expect(hallFromCatalog).toBeDefined();
    for (const id of ['pu-health', 'pu-chapel']) {
      const sourced = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === id);
      expect(sourced, id).toBeDefined();
      // The original sourced POI name/coordinates are unchanged. The imported
      // category and unrelated building label are synthetic corruptions,
      // not observed facts about campus rooms or entrances.
      const altered = { ...sourced!, category: '教學', building: '主顧樓' };
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [altered],
      }).status, id).toBe('unmatched');
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [altered, hallFromCatalog!],
      }).matches, id).toEqual([hallFromCatalog]);
    }
  });

  it('keeps the sourced building name and verified English alias without restricting other schools', () => {
    const hallFromCatalog = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');
    expect(hallFromCatalog).toBeDefined();
    const withOfficialAlias = { ...hallFromCatalog!, building: 'Providence Hall' };
    for (const query of ['PH303', 'Providence Hall 303', '主顧樓 PH303']) {
      expect(resolveCampusClassroom({
        schoolId: 'pu', query, locations: [withOfficialAlias],
      }).matches, query).toEqual([withOfficialAlias]);
    }
    const otherSchool = {
      ...PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-health')!,
      name: '不同名稱的教學樓', category: '教學', building: '主顧樓',
    };
    expect(resolveCampusClassroom({
      schoolId: 'other-school', query: '主顧樓 PH303', locations: [otherSchool],
    }).matches).toEqual([otherSchool]);
  });
});


describe('malformed imported transit stop markers cannot become classroom destinations', () => {
  it('rejects a scalar stop ID after an otherwise teaching-labelled POI import', () => {
    // Synthetic Firestore schema drift: one string instead of a string array.
    const imported = {
      ...hall, id: 'synthetic-scalar-stop', transitStopIds: 'stop-123',
      category: '教學', building: '主顧樓',
    } as unknown as CampusMapPlaceLike;
    for (const schoolId of ['pu', 'another-school']) {
      expect(resolveCampusClassroom({
        schoolId, query: schoolId === 'pu' ? 'PH303' : '主顧樓 PH303', locations: [imported, hall],
      }).matches, schoolId).toEqual([hall]);
    }
  });

  it('rejects malformed non-string stop markers while accepting blank metadata', () => {
    // A number from a damaged import still signals transit metadata; no
    // physical bus stop or room location is claimed by these synthetic rows.
    const malformed = {
      ...hall, id: 'synthetic-numeric-stop',
      transitStopIds: ['', 42, null],
    } as unknown as CampusMapPlaceLike;
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [malformed, hall],
    }).matches).toEqual([hall]);

    for (const transitStopIds of ['', '  ', []]) {
      const building = {
        ...hall, transitStopIds,
      } as unknown as CampusMapPlaceLike;
      expect(resolveCampusClassroom({
        schoolId: 'another-school', query: '主顧樓 PH303', locations: [building],
      }).matches).toEqual([building]);
    }
  });
});

describe('nested and long POI qualifiers never override classroom destinations', () => {
  it('rejects synthetically nested or long stop and dining labels', () => {
    const nonBuildingCategories = [
      'Bus Stop (Campus (Inbound))',
      '公車站（校內（臨時站））',
      '餐飲 [North [B1]]',
      'Bus Stop (Campus detail '.concat('long annotation '.repeat(4), ')'),
    ];
    for (const category of nonBuildingCategories) {
      const unrelated = {
        ...hall, id: 'synthetic-nested-category', category, building: '主顧樓',
      };
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [unrelated, hall],
      });
      expect(result.status, category).toBe('matched');
      expect(result.matches, category).toEqual([hall]);
    }
  });

  it('retains legitimate annotated teaching categories without substring blocking', () => {
    for (const category of [
      '教學 (主校區 (北側))',
      '圖書館 [Main [East]]',
      '交通工程學院 (公車站 (校內))',
    ]) {
      const building = { ...hall, category };
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [building],
      }).matches, category).toEqual([building]);
    }
  });
});


describe('malformed import rows never crash classroom lookup', () => {
  it('skips null, primitive and non-string-ID rows without hiding a valid classroom destination', () => {
    // Synthetic malformed Firestore payload: no assertion about actual campus
    // data or physical building coordinates. The valid hall stays selectable.
    const malformed = [
      null,
      undefined,
      42,
      'not-a-place',
      { id: 123, name: '主顧樓', category: '教學', lat: hall.lat, lng: hall.lng },
      { id: null, name: '主顧樓', category: '教學', lat: hall.lat, lng: hall.lng },
      { id: 'incomplete-place', name: '主顧樓', category: '教學' },
      hall,
    ] as unknown as CampusMapPlaceLike[];
    for (const schoolId of ['pu', 'another-school']) {
      const result = resolveCampusClassroom({
        schoolId, query: schoolId === 'pu' ? 'PH303' : '主顧樓 PH303',
        locations: malformed,
      });
      expect(result.status, schoolId).toBe('matched');
      expect(result.matches, schoolId).toEqual([hall]);
    }
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303',
      locations: null as unknown as CampusMapPlaceLike[],
    }).status).toBe('unmatched');
  });

  it('fails closed on a duplicate published-ID import even when one row is malformed', () => {
    const published = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');
    expect(published).toBeDefined();
    // The damaged duplicate is not a valid destination, but its string ID
    // must still block ambiguous MapClient ID-based selection.
    const duplicate = {
      ...published!, lat: 'invalid-coordinate',
    } as unknown as CampusMapPlaceLike;
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [duplicate, published!],
    });
    expect(result.status).toBe('unmatched');
    expect(result.matches).toEqual([]);
  });
});
