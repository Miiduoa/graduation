'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const {
  ASSISTANT_PERMISSIONS_DOC_ID,
  assistantWritePermissionDeniedMessage,
  isAssistantWriteToolAllowed,
  normalizeAssistantWritePermissions,
} = require('../../lib/assistantWritePermissions');

/** Recheck the server-selected Agent tool in the same transaction as its writes. */
async function readAgentWritePermission(tx, db, ctx, toolName) {
  // Ordinary service calls retain their own authorization. Only the validated
  // proposal handler supplies this key; raw tool input cannot enable this path.
  if (!ctx.agentActionKey) return;
  const snapshot = await tx.get(db.doc(`users/${ctx.uid}/settings/${ASSISTANT_PERMISSIONS_DOC_ID}`));
  // A missing or malformed grant is closed. Read failures abort the transaction
  // unchanged, and a Firestore retry must read the latest permission again.
  const permissions = normalizeAssistantWritePermissions(snapshot.exists ? snapshot.data() : undefined);
  if (!isAssistantWriteToolAllowed(permissions, toolName)) {
    throw new HttpsError('permission-denied', assistantWritePermissionDeniedMessage(toolName));
  }
}

module.exports = { readAgentWritePermission };
