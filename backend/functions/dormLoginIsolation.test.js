const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index'), 'utf8');
const callback = source.slice(
  source.indexOf('exports.verifySSOCallback ='),
  source.indexOf('exports.getSSOConfig ='),
);

test.each([false, true])(
  'login issues a token even when dorm sync is unavailable (new=%s)',
  async (isNewUser) => {
    // Run the actual callback's profile-to-response path, with all dorm access failing.
    const login = callback.slice(
      callback.indexOf('      const schoolRole ='),
      callback.indexOf('    } catch (error)'),
    );
    const requireDorm = jest.fn(() => {
      throw new Error('dorm unavailable');
    });
    const createCustomToken = jest.fn().mockResolvedValue('test-token');
    const json = jest.fn();
    await vm.runInNewContext(`(async () => { ${login} })()`, {
      uid: 'student',
      schoolId: 'pu',
      userInfo: { sub: 'verified', name: '同學' },
      existingUserDoc: null,
      isNewUser,
      resolvedRole: 'student',
      ssoLinkRef: {},
      availability: { isProductionReady: true },
      writeSchoolLoginProfile: jest.fn().mockResolvedValue({ role: 'student' }),
      auth: { createCustomToken },
      syncAuthClaims: jest.fn(),
      res: { json },
      require: requireDorm,
      db: {
        collection: () => {
          throw new Error('dorm database unavailable');
        },
      },
    });
    expect(requireDorm).not.toHaveBeenCalled();
    expect(callback).not.toMatch(/dormSsoIdentity|refreshDormSsoIdentity/);
    expect(createCustomToken).toHaveBeenCalledWith(
      'student',
      expect.objectContaining({ schoolId: 'pu' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, customToken: 'test-token' }),
    );
  },
);
