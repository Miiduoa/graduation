const saml2 = require("saml2-js");
const xml2js = require("xml2js");
const crypto = require("crypto");

const REQUIRED_PROVIDER_FIELDS = {
  oidc: ["clientId", "clientSecret", "authorizationEndpoint", "tokenEndpoint"],
  cas: ["casServerUrl"],
  saml: [
    "samlEntryPoint",
    "spEntityId",
    "spPrivateKey",
    "spCertificate",
    "assertConsumerUrl",
    "idpCertificate",
  ],
};

function hasConfigValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function normalizeSetupStatus(value, hasSsoConfig) {
  if (value === "draft" || value === "testing" || value === "live") {
    return value;
  }

  return hasSsoConfig ? "testing" : "draft";
}

function getMissingSsoConfigFields(ssoConfig) {
  if (!ssoConfig?.provider || !REQUIRED_PROVIDER_FIELDS[ssoConfig.provider]) {
    return [];
  }

  return REQUIRED_PROVIDER_FIELDS[ssoConfig.provider].filter(
    (field) => !hasConfigValue(ssoConfig[field])
  );
}

function evaluateSsoConfiguration(config = {}) {
  const ssoConfig = config.ssoConfig || null;
  const setupStatus = normalizeSetupStatus(config.setupStatus, Boolean(ssoConfig));
  const missingFields = getMissingSsoConfigFields(ssoConfig);
  const isConfigured = Boolean(ssoConfig);
  const isEnabled = Boolean(ssoConfig?.enabled);
  const isComplete = isConfigured && missingFields.length === 0;
  const isLoginReady = isComplete && isEnabled && setupStatus !== "draft";
  const isProductionReady = isComplete && isEnabled && setupStatus === "live";

  if (!ssoConfig) {
    return {
      provider: null,
      setupStatus,
      reason: "not-configured",
      message: "SSO not configured for this school",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (!ssoConfig.enabled) {
    return {
      provider: ssoConfig.provider,
      setupStatus,
      reason: "disabled",
      message: "SSO is disabled for this school",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (!isComplete) {
    return {
      provider: ssoConfig.provider,
      setupStatus,
      reason: "incomplete",
      message: "SSO configuration is incomplete for this school",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (setupStatus === "draft") {
    return {
      provider: ssoConfig.provider,
      setupStatus,
      reason: "not-live",
      message: "SSO is not live for this school",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  if (setupStatus === "testing") {
    return {
      provider: ssoConfig.provider,
      setupStatus,
      reason: "not-live",
      message: "SSO is still in testing for this school",
      missingFields,
      isConfigured,
      isEnabled,
      isComplete,
      isLoginReady,
      isProductionReady,
    };
  }

  return {
    provider: ssoConfig.provider,
    setupStatus,
    reason: "ready",
    message: "SSO is ready",
    missingFields,
    isConfigured,
    isEnabled,
    isComplete,
    isLoginReady,
    isProductionReady,
  };
}

function decodeJWT(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

function toBase64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function verifyPkceChallenge(codeVerifier, expectedCodeChallenge) {
  if (!codeVerifier || !expectedCodeChallenge) {
    throw new Error("Missing PKCE verifier");
  }

  const actualChallenge = toBase64Url(
    crypto.createHash("sha256").update(codeVerifier, "utf8").digest()
  );

  if (actualChallenge !== expectedCodeChallenge) {
    throw new Error("PKCE validation failed");
  }
}

async function verifyOIDC({
  code,
  redirectUri,
  ssoConfig,
  codeVerifier,
  expectedCodeChallenge,
  expectedNonce,
}) {
  const fetch = (await import("node-fetch")).default;

  if (expectedCodeChallenge) {
    verifyPkceChallenge(codeVerifier, expectedCodeChallenge);
  }

  const tokenResponse = await fetch(ssoConfig.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: ssoConfig.clientId,
      client_secret: ssoConfig.clientSecret,
      redirect_uri: redirectUri,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("OIDC token error:", errorText);
    throw new Error("Failed to exchange authorization code");
  }

  const tokens = await tokenResponse.json();

  if (tokens.id_token) {
    const decoded = decodeJWT(tokens.id_token);
    if (expectedNonce && decoded.nonce && decoded.nonce !== expectedNonce) {
      throw new Error("OIDC nonce validation failed");
    }
    return {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.preferred_username,
      displayName: decoded.name || decoded.preferred_username,
      studentId: decoded.student_id || decoded.employee_id,
      department: decoded.department || decoded.ou,
      accessToken: tokens.access_token,
    };
  }

  const userInfoResponse = await fetch(ssoConfig.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw new Error("Failed to fetch user info");
  }

  const userInfo = await userInfoResponse.json();
  return {
    sub: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name || userInfo.preferred_username,
    displayName: userInfo.name || userInfo.preferred_username,
    studentId: userInfo.student_id || userInfo.employee_id,
    department: userInfo.department || userInfo.ou,
    accessToken: tokens.access_token,
  };
}

async function verifyCAS({ ticket, redirectUri, ssoConfig }) {
  const fetch = (await import("node-fetch")).default;
  const validateUrl =
    `${ssoConfig.casServerUrl}/serviceValidate?ticket=${ticket}` +
    `&service=${encodeURIComponent(redirectUri)}`;

  const response = await fetch(validateUrl);
  if (!response.ok) {
    throw new Error("CAS ticket validation failed");
  }

  const xmlText = await response.text();
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xmlText);
  const serviceResponse = result["cas:serviceResponse"];

  if (serviceResponse["cas:authenticationFailure"]) {
    throw new Error(
      serviceResponse["cas:authenticationFailure"]._ ||
        "CAS authentication failed"
    );
  }

  const success = serviceResponse["cas:authenticationSuccess"];
  if (!success) {
    throw new Error("Unexpected CAS response format");
  }

  const attributes = success["cas:attributes"] || {};
  return {
    sub: success["cas:user"],
    email: attributes["cas:email"] || attributes["cas:mail"],
    name:
      attributes["cas:displayName"] ||
      attributes["cas:cn"] ||
      success["cas:user"],
    displayName:
      attributes["cas:displayName"] || attributes["cas:cn"],
    studentId:
      attributes["cas:studentId"] ||
      attributes["cas:employeeNumber"],
    department:
      attributes["cas:department"] || attributes["cas:ou"],
  };
}

async function verifySAML({ SAMLResponse, ssoConfig }) {
  const sp = new saml2.ServiceProvider({
    entity_id: ssoConfig.spEntityId,
    private_key: ssoConfig.spPrivateKey,
    certificate: ssoConfig.spCertificate,
    assert_endpoint: ssoConfig.assertConsumerUrl,
  });

  const idp = new saml2.IdentityProvider({
    sso_login_url: ssoConfig.idpSsoUrl,
    sso_logout_url: ssoConfig.idpSloUrl,
    certificates: [ssoConfig.idpCertificate],
  });

  return new Promise((resolve, reject) => {
    sp.post_assert(
      idp,
      { request_body: { SAMLResponse } },
      (error, samlResponse) => {
        if (error) {
          reject(error);
          return;
        }

        const user = samlResponse.user;
        resolve({
          sub: user.name_id,
          email: user.attributes?.email?.[0],
          name:
            user.attributes?.displayName?.[0] ||
            user.attributes?.cn?.[0],
          displayName: user.attributes?.displayName?.[0],
          studentId:
            user.attributes?.studentId?.[0] ||
            user.attributes?.employeeNumber?.[0],
          department:
            user.attributes?.department?.[0] ||
            user.attributes?.ou?.[0],
        });
      }
    );
  });
}

const PROVIDER_ADAPTERS = {
  oidc: {
    getMissingCallbackFields(input = {}) {
      return ["code", "redirectUri"].filter(
        (field) => !hasConfigValue(input[field])
      );
    },
    verify(input) {
      return verifyOIDC(input);
    },
  },
  cas: {
    getMissingCallbackFields(input = {}) {
      return ["ticket", "redirectUri"].filter(
        (field) => !hasConfigValue(input[field])
      );
    },
    verify(input) {
      return verifyCAS(input);
    },
  },
  saml: {
    getMissingCallbackFields(input = {}) {
      return ["SAMLResponse"].filter(
        (field) => !hasConfigValue(input[field])
      );
    },
    verify(input) {
      return verifySAML(input);
    },
  },
};

function getProviderAdapter(provider) {
  return PROVIDER_ADAPTERS[provider] || null;
}

function toPublicSsoConfig(config = {}, ssoConfig = null) {
  const availability = evaluateSsoConfiguration({
    ...config,
    ssoConfig,
  });

  return {
    schoolId: config.schoolId,
    schoolName: config.schoolName,
    ssoConfig: ssoConfig
      ? {
          provider: ssoConfig.provider,
          name: ssoConfig.name,
          enabled: ssoConfig.enabled,
          clientId: ssoConfig.clientId,
          authUrl: ssoConfig.authUrl,
          authorizationEndpoint: ssoConfig.authorizationEndpoint,
          tokenEndpoint: ssoConfig.tokenEndpoint,
          userInfoEndpoint: ssoConfig.userInfoEndpoint,
          casServerUrl: ssoConfig.casServerUrl,
          samlEntryPoint: ssoConfig.samlEntryPoint,
          scopes: ssoConfig.scopes,
          customParams: ssoConfig.customParams,
          courseApiUrl: ssoConfig.courseApiUrl,
        }
      : null,
    emailDomain: config.emailDomain,
    allowEmailLogin: config.allowEmailLogin ?? true,
    setupStatus: availability.setupStatus,
    availability: {
      reason: availability.reason,
      missingFields: availability.missingFields,
      isConfigured: availability.isConfigured,
      isEnabled: availability.isEnabled,
      isComplete: availability.isComplete,
      isLoginReady: availability.isLoginReady,
      isProductionReady: availability.isProductionReady,
    },
  };
}

module.exports = {
  evaluateSsoConfiguration,
  getMissingSsoConfigFields,
  getProviderAdapter,
  normalizeSetupStatus,
  toPublicSsoConfig,
};
