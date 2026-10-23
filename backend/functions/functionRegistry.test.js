'use strict';

const { classifyExport, classifyFunctions } = require('./functionRegistry');

describe('functionRegistry', () => {
  test('classifies callable, http, schedule, and firestore exports', () => {
    const callHandler = jest.fn();
    const httpHandler = jest.fn();
    const scheduleHandler = jest.fn();
    const exported = {
      joinLiveSession: Object.assign(jest.fn(), {
        run: callHandler,
        __endpoint: { callableTrigger: {}, platform: 'gcfv2' },
      }),
      signInPuStudentId: Object.assign(httpHandler, {
        __endpoint: { httpsTrigger: {}, platform: 'gcfv2' },
      }),
      scheduledOrderTimeoutSweep: Object.assign(jest.fn(), {
        run: scheduleHandler,
        __endpoint: {
          scheduleTrigger: { schedule: 'every 5 minutes', timeZone: 'Asia/Taipei' },
        },
      }),
      onUserProfileChanged: Object.assign(jest.fn(), {
        run: jest.fn(),
        __endpoint: {
          eventTrigger: {
            eventType: 'google.cloud.firestore.document.v1.written',
            eventFilterPathPatterns: { document: 'users/{uid}' },
          },
        },
      }),
      gradePublishedNotification: Object.assign(jest.fn(), {
        run: jest.fn(),
        __endpoint: {
          eventTrigger: {
            eventType: 'google.cloud.firestore.document.v1.created',
            eventFilterPathPatterns: { document: 'schools/{schoolId}/grades/{gradeId}' },
          },
        },
      }),
    };

    const classified = classifyFunctions(exported);
    expect(Object.keys(classified.callables)).toEqual(['joinLiveSession']);
    expect(Object.keys(classified.httpFunctions)).toEqual(['signInPuStudentId']);
    expect(classified.schedules.scheduledOrderTimeoutSweep.schedule).toBe('every 5 minutes');
    expect(classified.firestoreTriggers).toEqual([
      expect.objectContaining({
        name: 'onUserProfileChanged',
        supported: true,
        document: 'users/{uid}',
        createdOnly: false,
      }),
      expect.objectContaining({
        name: 'gradePublishedNotification',
        supported: true,
        document: 'schools/{schoolId}/grades/{gradeId}',
        createdOnly: true,
      }),
    ]);
    expect(typeof classified.firestoreTriggers[0].handler).toBe('function');
    expect(classifyExport('joinLiveSession', exported.joinLiveSession).kind).toBe('callable');
  });
});
