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

  it.each(['Providence Hall', '  PROVIDENCE HALL  ', 'Ｐｒｏｖｉｄｅｎｃｅ Ｈａｌｌ'])('preserves the published ID with verified English name %s', (name) => {
    expect(sourcedHall).toBeDefined();
    // Synthetic bilingual import variant; coordinates remain the catalog's
    // building point, not a surveyed classroom or indoor destination.
    const imported = { ...sourcedHall!, name };
    for (const query of ['PH303', 'Providence Hall 303']) {
      const result = resolveCampusClassroom({ schoolId: 'pu', query, locations: [imported] });
      expect(result.status, query).toBe('matched');
      expect(result.matches, query).toEqual([imported]);
      expect(result.matches[0]).toBe(imported);
    }
    const withChineseLabel = { ...imported, building: '主顧樓' };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: '主顧樓303', locations: [withChineseLabel],
    }).matches).toEqual([withChineseLabel]);
  });

  it('keeps identity, category, transit and duplicate safeguards for an English-named published building', () => {
    expect(sourcedHall).toBeDefined();
    const imported = { ...sourcedHall!, name: 'Providence Hall' };
    const invalidVariants = [
      { ...imported, lat: imported.lat + 0.007 },
      { ...imported, name: 'Unverified Hall', building: 'Providence Hall' },
      { ...imported, category: '公車站' },
      { ...imported, transitStopIds: ['synthetic-stop'] },
    ];
    for (const invalid of invalidVariants) {
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [invalid],
      }).status).toBe('unmatched');
    }
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [imported, sourcedHall!],
    }).status).toBe('unmatched');
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: '無關建築303', locations: [{ ...imported, building: '無關建築' }],
    }).status).toBe('unmatched');
  });

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


describe('classroom duplicate IDs are scoped to the selected school', () => {
  const sourcedHall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');

  it('keeps a valid hall selectable despite another school reusing its ID', () => {
    expect(sourcedHall).toBeDefined();
    // An imported cross-campus collision is synthetic. Its coordinates and
    // school marker do not establish a real building or destination.
    const foreign = {
      ...sourcedHall!,
      schoolId: 'other-school',
      name: 'Synthetic foreign campus place',
    };
    for (const locations of [[foreign, sourcedHall!], [sourcedHall!, foreign]]) {
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations,
      });
      expect(result.status).toBe('matched');
      expect(result.matches).toEqual([sourcedHall]);
    }
  });

  it('still fails closed on same-school and unscoped duplicate IDs', () => {
    expect(sourcedHall).toBeDefined();
    const duplicate = { ...sourcedHall!, schoolId: 'pu' };
    const missingScope = { ...sourcedHall!, name: 'Corrupted duplicate source label' };
    // An explicitly scoped second copy and a legacy unscoped copy are
    // both potentially selectable by the map using the same location ID.
    for (const collision of [duplicate, missingScope]) {
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303',
        locations: [sourcedHall!, collision],
      });
      expect(result.status).toBe('unmatched');
      expect(result.matches).toEqual([]);
    }
  });
});

describe('explicitly joined floor and room classroom labels', () => {
  it('finds the existing building for compact floor-room input without asserting a room coordinate', () => {
    // Synthetic room strings describe the user's query, not surveyed indoor floors.
    // Only the existing building POI can be returned as an outdoor destination.
    for (const query of [
      '主顧樓3F303', '主顧樓３Ｆ３０３', '主顧樓3樓303',
      '主顧樓3F303室', '主顧樓B1F12', '主顧樓 3F 303',
    ]) {
      const result = resolveCampusClassroom({
        schoolId: 'pu', query, locations: [hall],
      });
      expect(result.status, query).toBe('matched');
      expect(result.matches, query).toEqual([hall]);
    }
  });

  it('rejects malformed joined room suffixes and keeps transit POIs excluded', () => {
    for (const query of ['主顧樓3Froom303', '主顧樓3Fabc303', '主顧樓3F999999']) {
      expect(resolveCampusClassroom({
        schoolId: 'pu', query, locations: [hall],
      }).status, query).toBe('unmatched');
    }
    const relabelledTransit = {
      ...hall, id: 'synthetic-joined-transit',
      category: '公車站', building: '主顧樓',
    };
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: '主顧樓3F303',
      locations: [relabelledTransit, hall],
    });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([hall]);
  });
});

describe('verified PH code with explicit floor and room text', () => {
  const sourcedHall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');

  it('resolves compact floor-room notations only to the existing sourced building POI', () => {
    expect(sourcedHall).toBeDefined();
    // These are synthetic timetable strings, not verified PH indoor room
    // locations or floor-by-floor wayfinding.
    for (const query of [
      'PH3F303', 'ＰＨ３Ｆ３０３', 'PH 3F 303',
      'PH3樓303', 'PHB1F12', 'PH B1F-12',
    ]) {
      const result = resolveCampusClassroom({
        schoolId: 'pu', query, locations: [sourcedHall!],
      });
      expect(result.status, query).toBe('matched');
      expect(result.matches, query).toEqual([sourcedHall]);
    }
  });

  it('rejects incomplete or malformed floor-room text and never leaks the PH code to other schools', () => {
    expect(sourcedHall).toBeDefined();
    for (const query of ['PH3F', 'PH3F室', 'PH23F', 'PH3Froom303', 'PH3Fabc303', 'PH3F999999']) {
      expect(resolveCampusClassroom({
        schoolId: 'pu', query, locations: [sourcedHall!],
      }).status, query).toBe('unmatched');
    }
    const renamedStop = {
      ...sourcedHall!, id: 'synthetic-stop', category: '公車站', building: 'Providence Hall',
    };
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH3F303', locations: [renamedStop, sourcedHall!],
    }).matches).toEqual([sourcedHall]);
    expect(resolveCampusClassroom({
      schoolId: 'another-school', query: 'PH3F303', locations: [sourcedHall!],
    }).status).toBe('unmatched');
  });
});

describe('classroom floor-only labels require a room number', () => {
  it('does not turn bare floors into classroom destinations for either school', () => {
    // Synthetic timetable strings; the building POI is NOT an indoor
    // room or floor coordinate and a floor alone is not a classroom.
    const labelled = { ...hall, building: 'Providence Hall' };
    for (const query of [
      '主顧樓3F', '主顧樓３Ｆ', '主顧樓3樓',
      '主顧樓 B1F', '主顧樓3F室', '主顧樓3F教室',
      '主顧樓地下1樓', 'Providence Hall 3F',
      'Providence Hall3F', 'Providence Hall B1F',
      'Providence Hall 3F室',
    ]) {
      for (const schoolId of ['pu', 'another-school']) {
        const result = resolveCampusClassroom({
          schoolId, query, locations: [labelled],
        });
        expect(result.status, `${schoolId}: ${query}`).toBe('unmatched');
        expect(result.matches, `${schoolId}: ${query}`).toEqual([]);
      }
    }
  });

  it('preserves real room-suffixed searches and direct building-name lookup', () => {
    const labelled = { ...hall, building: 'Providence Hall' };
    for (const query of [
      '主顧樓3F303', '主顧樓 3F 303', '主顧樓B1F12',
      '主顧樓3樓303', '主顧樓303', 'Providence Hall 3F 303',
      'Providence Hall303', 'Providence 303', '主顧 303',
      '主顧樓',
    ]) {
      expect(resolveCampusClassroom({
        schoolId: 'pu', query, locations: [labelled],
      }).matches, query).toEqual([labelled]);
    }
    // The University's PH building code is never inherited by another school.
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH3F303', locations: [labelled],
    }).matches).toEqual([labelled]);
    expect(resolveCampusClassroom({
      schoolId: 'another-school', query: 'PH3F303', locations: [labelled],
    }).status).toBe('unmatched');
  });
});

describe('nullable, blank and absent school markers are unscoped ID reservations', () => {
  const sourcedHall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');

  it('fails closed when a malformed duplicate has an explicit null, undefined or blank schoolId', () => {
    expect(sourcedHall).toBeDefined();
    // These are synthetic Firestore import shapes, not real campus data.
    // An unscoped duplicate could be selected by the map using the same ID.
    for (const marker of [null, undefined, '', '   ']) {
      const duplicate = {
        ...sourcedHall!, schoolId: marker,
        name: 'Damaged imported campus location',
      };
      for (const locations of [[duplicate, sourcedHall!], [sourcedHall!, duplicate]]) {
        const result = resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations });
        expect(result.status, String(marker)).toBe('unmatched');
        expect(result.matches).toEqual([]);
      }
    }
  });

  it('can still search one unscoped record and ignores explicitly foreign or invalid school scopes', () => {
    expect(sourcedHall).toBeDefined();
    for (const marker of [null, undefined, '', '   ']) {
      const unscoped = { ...sourcedHall!, schoolId: marker };
      const result = resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations: [unscoped] });
      expect(result.status, String(marker)).toBe('matched');
      expect(result.matches).toEqual([unscoped]);
    }
    const foreign = { ...sourcedHall!, schoolId: 'other-campus' };
    const malformed = { ...sourcedHall!, schoolId: 123 };
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [foreign, malformed, sourcedHall!],
    });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([sourcedHall]);
  });
});

describe('delimited non-building category annotations', () => {
  it('does not choose a bus, parking or dining POI with a descriptive suffix as a classroom', () => {
    // Synthetic import categories, not evidence of new campus places.
    for (const category of [
      '公車站 / 校內', 'Bus Stop (Campus) / Inbound',
      '公車站（主校區）：往主顧樓', '餐飲 - B1 美食街',
      'parking — P1', '餐廳／主校區',
    ]) {
      const unrelated = {
        ...hall, id: 'synthetic-qualified-nonbuilding',
        name: '非教室設施', building: '主顧樓', category,
      };
      for (const schoolId of ['pu', 'another-school']) {
        const query = schoolId === 'pu' ? 'PH303' : '主顧樓303';
        const result = resolveCampusClassroom({ schoolId, query, locations: [unrelated, hall] });
        expect(result.matches, `${schoolId}: ${category}`).toEqual([hall]);
        expect(result.status).toBe('matched');
        expect(resolveCampusClassroom({
          schoolId, query, locations: [unrelated],
        }).status, `${schoolId}: ${category}`).toBe('unmatched');
      }
    }
  });

  it('keeps teaching buildings with similar words or descriptive separators selectable', () => {
    for (const category of [
      '交通工程學院 - 教學區', '交通工程學院 (公車站)',
      '教學 / 主校區', '圖書館 — 綜合樓',
    ]) {
      const building = { ...hall, category };
      const result = resolveCampusClassroom({
        schoolId: 'pu', query: '主顧樓303', locations: [building],
      });
      expect(result.matches, category).toEqual([building]);
      expect(result.status).toBe('matched');
    }
  });
});

describe('malformed scalar transit markers cannot impersonate classroom buildings', () => {
  it('rejects non-null numeric, boolean and object metadata across schools', () => {
    // Synthetic import schema drift, not an observation of any physical stop.
    for (const transitStopIds of [0, 42, false, true, {}, { stop: 'synthetic' }]) {
      const malformed = {
        ...hall, id: 'synthetic-malformed-scalar-stop', transitStopIds,
        building: '主顧樓',
      } as unknown as CampusMapPlaceLike;
      for (const schoolId of ['pu', 'another-school']) {
        const query = schoolId === 'pu' ? 'PH303' : '主顧樓303';
        expect(resolveCampusClassroom({
          schoolId, query, locations: [malformed, hall],
        }).matches, `${schoolId}: ${typeof transitStopIds}`).toEqual([hall]);
        expect(resolveCampusClassroom({
          schoolId, query, locations: [malformed],
        }).status).toBe('unmatched');
      }
    }
  });

  it('preserves a classroom POI when transit metadata is absent or blank', () => {
    for (const transitStopIds of [null, undefined, '', ' ', []]) {
      const building = {
        ...hall, transitStopIds,
      } as unknown as CampusMapPlaceLike;
      expect(resolveCampusClassroom({
        schoolId: 'pu', query: 'PH303', locations: [building],
      }).matches).toEqual([building]);
      expect(resolveCampusClassroom({
        schoolId: 'another-school', query: '主顧樓303', locations: [building],
      }).matches).toEqual([building]);
    }
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [hall],
    }).matches).toEqual([hall]);
  });
});


describe('padded imported school scope cannot bypass classroom ID safety', () => {
  const sourcedHall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu');

  it('reserves the ID of a same-school duplicate even when its schoolId has surrounding whitespace', () => {
    expect(sourcedHall).toBeDefined();
    // Synthetic import damage; neither row asserts an indoor room location.
    for (const schoolId of [' pu ', '\tpu\n']) {
      const duplicate = { ...sourcedHall!, schoolId, name: 'Damaged duplicated hall' };
      for (const locations of [[duplicate, sourcedHall!], [sourcedHall!, duplicate]]) {
        const result = resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations });
        expect(result.status, JSON.stringify(schoolId)).toBe('unmatched');
        expect(result.matches).toEqual([]);
      }
    }
  });

  it('keeps one padded local row eligible while excluding padded foreign-school rows', () => {
    expect(sourcedHall).toBeDefined();
    const local = { ...sourcedHall!, schoolId: ' pu ' };
    const foreign = { ...sourcedHall!, schoolId: ' other-campus ' };
    const result = resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [foreign, local],
    });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([local]);
    expect(resolveCampusClassroom({
      schoolId: 'pu', query: 'PH303', locations: [foreign],
    }).status).toBe('unmatched');
  });
});
