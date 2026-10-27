const { canUsePuStudentLogin } = require('./schoolConnectionGuard');

test.each([undefined, null, '', 'pu'])('accepts Providence or legacy omitted school (%s)', (id) => {
  expect(canUsePuStudentLogin(id)).toBe(true);
});

test.each(['ntu', 'tw-pu', 'PU', ' pu ', 'all', {}, ['pu']])(
  'rejects wrong or malformed school selection (%s)',
  (id) => {
    expect(canUsePuStudentLogin(id)).toBe(false);
  },
);
