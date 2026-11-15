'use strict';

const { initializeApp, deleteApp } = require('firebase-admin/app');

const POLLUTION_MARKER = '__campusAdminOptionsPollutionProbe';

describe('Admin SDK application options', () => {
  test('copies nested options without polluting unrelated objects', async () => {
    const originalMarker = Object.getOwnPropertyDescriptor(Object.prototype, POLLUTION_MARKER);
    const overrides = JSON.parse(
      `{"uid":"student","scope":{"schoolId":"pu","permissions":["read"],"__proto__":{"${POLLUTION_MARKER}":true}}}`,
    );
    const credential = {
      getAccessToken: jest.fn(async () => {
        throw new Error('This options-only test must not request credentials or contact Firebase.');
      }),
    };
    let app;

    try {
      expect(originalMarker).toBeUndefined();
      app = initializeApp(
        {
          projectId: 'demo-campus-admin-security',
          credential,
          databaseAuthVariableOverride: overrides,
        },
        'admin-options-security',
      );

      expect(Object.hasOwn(Object.prototype, POLLUTION_MARKER)).toBe(false);
      expect({}[POLLUTION_MARKER]).toBeUndefined();

      const savedOptions = app.options.databaseAuthVariableOverride;
      expect(savedOptions).toMatchObject({
        uid: 'student',
        scope: { schoolId: 'pu', permissions: ['read'] },
      });

      // Neither changes to the caller's input nor to a returned snapshot may
      // change the application's stored authorization options.
      overrides.scope.schoolId = 'changed-input';
      overrides.scope.permissions.push('write');
      savedOptions.scope.schoolId = 'changed-snapshot';
      savedOptions.scope.permissions.push('delete');
      expect(app.options.databaseAuthVariableOverride).toMatchObject({
        uid: 'student',
        scope: { schoolId: 'pu', permissions: ['read'] },
      });
      expect(credential.getAccessToken).not.toHaveBeenCalled();
    } finally {
      // Also restore the test process when this regression is run against an
      // older SDK, whose options copy can set the marker on Object.prototype.
      if (originalMarker) {
        Object.defineProperty(Object.prototype, POLLUTION_MARKER, originalMarker);
      } else {
        delete Object.prototype[POLLUTION_MARKER];
      }
      if (app) await deleteApp(app);
    }
  });
});
