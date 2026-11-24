// Isolated candidate; do not register production routes until issuer and integration gates are satisfied.
import { createHash, randomBytes, randomUUID } from "node:crypto";
const nodeCrypto = Object.freeze({
  hash: value => createHash("sha256").update(value).digest("hex"),
  token: () => randomBytes(32).toString("base64url"),
  uuid: () => randomUUID()
});
export class GoogleLinkError extends Error {
  constructor(code,statusCode) { super(code); this.name="GoogleLinkError"; this.code=code; this.statusCode=statusCode; }
}
export function createGoogleLinkService({ db, verifier, crypto = nodeCrypto }) {
  const issuer = "https://accounts.google.com";
  const jwksUri = "https://www.googleapis.com/oauth2/v3/certs";
  const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenEndpoint = "https://oauth2.googleapis.com/token";
  const ttl = 300;
  const hash = crypto.hash;
  const fail = (code, statusCode) => { throw new GoogleLinkError(code, statusCode); };
  const invalid = () => fail("GOOGLE_LINK_INVALID", 401);
  const conflict = () => fail("GOOGLE_LINK_CONFLICT", 409);
  const unavailable = () => fail("GOOGLE_LINK_UNAVAILABLE", 503);
  const id = (value, prefix) => typeof value === "string" &&
    new RegExp("^" + prefix + "_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "u").test(value);
  function actorShape(actor) {
    if (!actor || !id(actor.platformAccountId, "pa") || !id(actor.credentialId, "pac") ||
        typeof actor.sessionHash !== "string" || !/^[a-f0-9]{64}$/u.test(actor.sessionHash)) invalid();
    // The route adapter must obtain this actor from the authenticated server session, never JSON.
    return { platformAccountId: actor.platformAccountId, credentialId: actor.credentialId, sessionHash: actor.sessionHash };
  }
  async function requireFreshActor(tx, actor) {
    // Same account-first lock order as account closure. Hold credential and session until commit.
    const account = await tx.query(`/* link:account */ SELECT id FROM platform_accounts
      WHERE id=$1 AND state='active' FOR UPDATE`, [actor.platformAccountId]);
    if (account.rows.length !== 1) invalid();
    const credential = await tx.query(`/* link:credential */ SELECT id,method FROM platform_account_credentials
      WHERE id=$1 AND platform_account_id=$2 AND state='active' FOR SHARE`, [actor.credentialId, actor.platformAccountId]);
    // No school password, QA, or operator credential can become a platform login proof by this candidate.
    if (credential.rows.length !== 1 || !["google","apple"].includes(credential.rows[0].method)) invalid();
    const session = await tx.query(`/* link:session */ SELECT token_sha256 FROM platform_account_sessions
      WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3
        AND expires_at>clock_timestamp() AND created_at>clock_timestamp()-interval '5 minutes' FOR SHARE`,
      [actor.sessionHash, actor.platformAccountId, actor.credentialId]);
    if (session.rows.length !== 1) fail("GOOGLE_LINK_REAUTH_REQUIRED", 401);
    const operator = await tx.query(`/* link:operator */ SELECT 1 FROM platform_operator_assignments
      WHERE platform_account_id=$1 AND state='active' AND role_key='platform-operator' FOR SHARE`, [actor.platformAccountId]);
    if (operator.rows.length) fail("GOOGLE_LINK_UNAVAILABLE", 403);
  }
  async function provider(tx) {
    const result = await tx.query(`/* link:provider */ SELECT issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint
      FROM platform_identity_providers WHERE kind='google-consumer' AND state='enabled' FOR SHARE`);
    const p = result.rows[0];
    if (result.rows.length !== 1 || p.issuer !== issuer || p.jwks_uri !== jwksUri ||
        p.authorization_endpoint !== authorizationEndpoint || p.token_endpoint !== tokenEndpoint ||
        typeof p.client_id !== "string" || !/^[A-Za-z0-9._-]{1,240}\.apps\.googleusercontent\.com$/u.test(p.client_id)) unavailable();
    return p;
  }
  function inputShape(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
        Object.keys(raw).sort().join(",") !== "idToken,nonce,transactionId" ||
        typeof raw.transactionId !== "string" || !/^gl_[A-Za-z0-9_-]{43}$/u.test(raw.transactionId) ||
        typeof raw.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(raw.nonce) ||
        typeof raw.idToken !== "string" || raw.idToken.length < 32 || raw.idToken.length > 16384) invalid();
    return { transactionId: raw.transactionId, nonce: raw.nonce, idToken: raw.idToken };
  }
  async function readPending(tx, actor, input, p) {
    const args = [hash(input.transactionId), actor.platformAccountId, actor.credentialId,
      actor.sessionHash, hash(input.nonce), p.client_id];
    const row = await tx.query(`/* link:pending */ SELECT token_sha256 FROM platform_google_link_transactions
      WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3 AND session_sha256=$4
        AND nonce_sha256=$5 AND client_id=$6 AND consumed_at IS NULL AND expires_at>clock_timestamp()
      FOR UPDATE`, args);
    if (row.rows.length !== 1) invalid();
    return args;
  }
  function trustedCredential(row) {
    const expectedIssuer = row?.method === "google" ? issuer :
      row?.method === "apple" ? "https://appleid.apple.com" : null;
    return expectedIssuer !== null && row.provider_issuer === expectedIssuer &&
      row.state === "active" && row.verified_at != null &&
      typeof row.provider_subject === "string" && row.provider_subject.length > 0 &&
      row.provider_subject.length <= 255 && row.provider_subject.trim() === row.provider_subject &&
      !/[\u0000-\u001f\u007f]/u.test(row.provider_subject);
  }
  return {
    async status(rawActor) {
      const actor = actorShape(rawActor);
      return db.transaction(async tx => {
        // Read-only, account-first locks keep closure/revocation from overtaking this snapshot.
        // A status read does not require step-up and never creates or consumes a link request.
        const account = await tx.query(`/* link:status-account */ SELECT id FROM platform_accounts
          WHERE id=$1 AND state='active' FOR SHARE`, [actor.platformAccountId]);
        if (account.rows.length !== 1) invalid();
        const current = await tx.query(`/* link:status-credential */
          SELECT id,method,provider_issuer,provider_subject,state,verified_at FROM platform_account_credentials
          WHERE id=$1 AND platform_account_id=$2 AND state='active' FOR SHARE`,
          [actor.credentialId, actor.platformAccountId]);
        if (current.rows.length !== 1 || !trustedCredential(current.rows[0])) invalid();
        const session = await tx.query(`/* link:status-session */
          SELECT created_at>clock_timestamp()-interval '5 minutes' AS fresh FROM platform_account_sessions
          WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3
            AND expires_at>clock_timestamp() AND created_at<=clock_timestamp() FOR SHARE`,
          [actor.sessionHash, actor.platformAccountId, actor.credentialId]);
        if (session.rows.length !== 1) fail("GOOGLE_LINK_REAUTH_REQUIRED", 401);
        // Include inactive rows: their existence prevents a replacement through the link service.
        const credentials = await tx.query(`/* link:status-methods */
          SELECT id,method,provider_issuer,provider_subject,state,verified_at FROM platform_account_credentials
          WHERE platform_account_id=$1 AND method IN ('google','apple') ORDER BY method,id LIMIT 17 FOR SHARE`,
          [actor.platformAccountId]);
        const rows = credentials.rows;
        // Bounded inventory must not present a truncated or ambiguous account as linkable.
        if (rows.length >= 17) unavailable();
        const google = rows.filter(row => row.method === "google");
        const linked = google.length === 1 && trustedCredential(google[0]);
        const methods = ["google", "apple"].filter(method =>
          rows.some(row => row.method === method && trustedCredential(row)));
        // A current verified credential must be present in the inventory under the same account.
        // A malformed/ambiguous Google history can still be viewed, but never linked again here.
        if (!rows.some(row => row.id === actor.credentialId) || !methods.includes(current.rows[0].method)) invalid();
        let googleLink = linked ? "linked" : google.length ? "unavailable" : "available";
        if (googleLink === "available") {
          const operator = await tx.query(`/* link:operator */ SELECT 1 FROM platform_operator_assignments
            WHERE platform_account_id=$1 AND state='active' AND role_key='platform-operator' FOR SHARE`,
            [actor.platformAccountId]);
          if (operator.rows.length) googleLink = "restricted";
          else if (session.rows[0].fresh !== true) googleLink = "reauth-required";
          else {
            try { await provider(tx); }
            catch (error) {
              if (error instanceof GoogleLinkError && error.code === "GOOGLE_LINK_UNAVAILABLE") googleLink = "unavailable";
              else throw error;
            }
          }
        }
        return { platformAccountId: actor.platformAccountId, currentMethod: current.rows[0].method, methods, googleLink };
      });
    },
    async start(rawActor) {
      const actor = actorShape(rawActor);
      const transactionId = "gl_" + crypto.token();
      const nonce = crypto.token();
      const p = await db.transaction(async tx => {
        await requireFreshActor(tx, actor);
        const current = await provider(tx);
        // One pending link per account; starting another cancels the old request under the account lock.
        await tx.query(`/* link:replace */ DELETE FROM platform_google_link_transactions WHERE platform_account_id=$1`,
          [actor.platformAccountId]);
        await tx.query(`/* link:create */ WITH clock AS (SELECT clock_timestamp() AS t)
          INSERT INTO platform_google_link_transactions
            (token_sha256,platform_account_id,credential_id,session_sha256,nonce_sha256,client_id,created_at,expires_at)
          SELECT $1,$2,$3,$4,$5,$6,t,t+interval '5 minutes' FROM clock`,
          [hash(transactionId),actor.platformAccountId,actor.credentialId,actor.sessionHash,hash(nonce),current.client_id]);
        return current;
      });
      return { transactionId, nonce, clientId: p.client_id, issuer, authorizationEndpoint, tokenEndpoint,
        expiresInSeconds: ttl, scopes: ["openid","email","profile"] };
    },
    async cancel(rawActor, rawInput) {
      const actor = actorShape(rawActor);
      if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput) ||
          Object.keys(rawInput).sort().join(",") !== "nonce,transactionId" ||
          typeof rawInput.transactionId !== "string" || !/^gl_[A-Za-z0-9_-]{43}$/u.test(rawInput.transactionId) ||
          typeof rawInput.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(rawInput.nonce)) invalid();
      const input = { transactionId: rawInput.transactionId, nonce: rawInput.nonce };
      return db.transaction(async tx => {
        await requireFreshActor(tx, actor);
        // Cancellation remains possible when Google is disabled. Never undo a completed link.
        const deleted = await tx.query(`/* link:cancel */ DELETE FROM platform_google_link_transactions
          WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3 AND session_sha256=$4
            AND nonce_sha256=$5 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING token_sha256`,
          [hash(input.transactionId), actor.platformAccountId, actor.credentialId, actor.sessionHash, hash(input.nonce)]);
        return { status: deleted.rows.length === 1 ? "cancelled" : "not-pending" };
      });
    },
    async complete(rawActor, rawInput) {
      const actor = actorShape(rawActor);
      const input = inputShape(rawInput);
      const p = await db.transaction(async tx => {
        await requireFreshActor(tx, actor);
        const current = await provider(tx);
        await readPending(tx, actor, input, current);
        return current;
      });
      // Network verification must not hold database locks. Recheck every binding after it completes.
      // Preserve the verifier's fail-closed availability and signature/nonce validation; no raw claims from clients.
      const identity = await verifier.verify({ kind:"google-consumer", issuer, clientId:p.client_id,
        jwksUri, idToken:input.idToken, expectedNonce:input.nonce });
      if (!identity || identity.method !== "google" || identity.providerIssuer !== issuer ||
          typeof identity.providerSubject !== "string" || identity.providerSubject.length < 1 ||
          identity.providerSubject.length > 255 || identity.providerSubject.trim() !== identity.providerSubject ||
          /[\u0000-\u001f\u007f]/u.test(identity.providerSubject)) invalid();
      const subject = identity.providerSubject;
      const email = identity.emailVerified === true && typeof identity.email === "string" &&
        identity.email.length <= 320 && /^[^\s@]+@[^\s@]+$/u.test(identity.email) ? identity.email : null;
      const outcome = await db.transaction(async tx => {
        await requireFreshActor(tx, actor);
        const current = await provider(tx);
        if (current.client_id !== p.client_id) invalid();
        const args = await readPending(tx, actor, input, current);
        const consumed = await tx.query(`/* link:consume */ UPDATE platform_google_link_transactions
          SET consumed_at=clock_timestamp() WHERE token_sha256=$1 AND platform_account_id=$2
            AND credential_id=$3 AND session_sha256=$4 AND nonce_sha256=$5 AND client_id=$6
            AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING token_sha256`, args);
        if (consumed.rows.length !== 1) invalid();
        const existing = await tx.query(`/* link:own-google */ SELECT id,provider_issuer,provider_subject,state
          FROM platform_account_credentials WHERE platform_account_id=$1 AND method='google' FOR SHARE`,
          [actor.platformAccountId]);
        if (existing.rows.length) {
          // Do not replace, revive, or add a second Google identity. Conflicts consume the request.
          return existing.rows.length === 1 && existing.rows[0].state === "active" &&
            existing.rows[0].provider_issuer === issuer && existing.rows[0].provider_subject === subject
            ? "already-linked" : "conflict";
        }
        // The existing global UNIQUE(issuer, subject) is the race-safe ownership boundary.
        // A concurrent normal login can win; never migrate another account automatically.
        const inserted = await tx.query(`/* link:insert */ INSERT INTO platform_account_credentials
          (id,platform_account_id,method,provider_issuer,provider_subject,email_at_registration,email_verified,verified_at,last_authenticated_at)
          VALUES ($1,$2,'google',$3,$4,$5,$6,now(),now())
          ON CONFLICT (provider_issuer,provider_subject) DO NOTHING RETURNING id`,
          ["pac_"+crypto.uuid(),actor.platformAccountId,issuer,subject,email,email !== null]);
        return inserted.rows.length === 1 ? "linked" : "conflict";
      });
      if (outcome === "conflict") conflict();
      // No session minted, switched or revoked, no role or membership modified.
      return { status:outcome, platformAccountId:actor.platformAccountId };
    }
  };
}

