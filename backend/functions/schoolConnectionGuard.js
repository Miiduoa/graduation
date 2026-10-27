'use strict';

const PROVIDENCE_SCHOOL_ID = 'pu';

function canUsePuStudentLogin(schoolId) {
  if (schoolId === undefined || schoolId === null || schoolId === '') return true;
  return typeof schoolId === 'string' && schoolId === PROVIDENCE_SCHOOL_ID;
}

module.exports = { canUsePuStudentLogin };
