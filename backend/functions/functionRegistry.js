'use strict';

function endpointOf(fn) {
  return fn && (typeof fn === 'function' || typeof fn === 'object') ? fn.__endpoint || null : null;
}

function classifyExport(name, fn) {
  if (!fn) return { name, kind: 'unknown' };
  const endpoint = endpointOf(fn);
  if (endpoint?.callableTrigger) {
    return {
      name,
      kind: 'callable',
      handler: typeof fn.run === 'function' ? fn.run.bind(fn) : fn,
    };
  }
  if (endpoint?.scheduleTrigger) {
    return {
      name,
      kind: 'schedule',
      handler: typeof fn.run === 'function' ? fn.run.bind(fn) : fn,
      schedule: endpoint.scheduleTrigger.schedule,
      timeZone: endpoint.scheduleTrigger.timeZone || 'Asia/Taipei',
    };
  }
  if (endpoint?.eventTrigger) {
    const filters = endpoint.eventTrigger.eventFilters || {};
    const pathPatterns = endpoint.eventTrigger.eventFilterPathPatterns || {};
    return {
      name,
      kind: 'firestore',
      eventType: endpoint.eventTrigger.eventType,
      document: filters.document || pathPatterns.document || null,
      supported: false,
    };
  }
  if (endpoint?.httpsTrigger) {
    return {
      name,
      kind: 'http',
      handler: fn,
    };
  }
  return { name, kind: 'unknown' };
}

function classifyFunctions(exportsMap) {
  const callables = {};
  const httpFunctions = {};
  const schedules = {};
  const firestoreTriggers = [];
  const unknown = [];

  for (const [name, fn] of Object.entries(exportsMap || {})) {
    const classified = classifyExport(name, fn);
    if (classified.kind === 'callable') {
      callables[name] = classified.handler;
    } else if (classified.kind === 'http') {
      httpFunctions[name] = classified.handler;
    } else if (classified.kind === 'schedule') {
      schedules[name] = classified;
    } else if (classified.kind === 'firestore') {
      firestoreTriggers.push(classified);
    } else {
      unknown.push(name);
    }
  }

  return { callables, httpFunctions, schedules, firestoreTriggers, unknown };
}

module.exports = {
  classifyExport,
  classifyFunctions,
};
