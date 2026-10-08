'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { createInspectionEnforcement } = require('./inspectionEnforcement');

module.exports.onInspectionWritten = onDocumentWritten(
  { document: 'schools/{schoolId}/inspections/{inspectionId}', region: 'asia-east1', retry: true },
  (event) => createInspectionEnforcement({ db: getFirestore() })(event),
);
