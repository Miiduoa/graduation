const crypto = require("crypto");

const SENSITIVE_SSO_FIELDS = [
  "clientSecret",
  "spPrivateKey",
  "spCertificate",
  "idpCertificate",
];

function cloneConfig(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

function normalizeConfigShape(value) {
  const config = cloneConfig(value);
  if (!config || typeof config !== "object") {
    return { ssoConfig: null };
  }

  if (!config.ssoConfig || typeof config.ssoConfig !== "object") {
    return {
      ...config,
      ssoConfig: config.ssoConfig ?? null,
    };
  }

  return config;
}

function splitSsoConfig(config) {
  const normalized = normalizeConfigShape(config);
  const publicConfig = cloneConfig(normalized);
  const secretConfig = { ssoConfig: {} };

  if (!publicConfig.ssoConfig || typeof publicConfig.ssoConfig !== "object") {
    return {
      publicConfig,
      secretConfig: {},
    };
  }

  for (const field of SENSITIVE_SSO_FIELDS) {
    if (publicConfig.ssoConfig[field]) {
      secretConfig.ssoConfig[field] = publicConfig.ssoConfig[field];
      delete publicConfig.ssoConfig[field];
    }
  }

  if (Object.keys(secretConfig.ssoConfig).length === 0) {
    return {
      publicConfig,
      secretConfig: {},
    };
  }

  return {
    publicConfig,
    secretConfig,
  };
}

function mergeSsoConfig(publicConfig = {}, secretConfig = {}) {
  const normalizedPublic = normalizeConfigShape(publicConfig);
  const merged = cloneConfig(normalizedPublic);
  const publicSsoConfig = merged.ssoConfig && typeof merged.ssoConfig === "object" ? merged.ssoConfig : null;
  const secretSsoConfig =
    secretConfig?.ssoConfig && typeof secretConfig.ssoConfig === "object"
      ? secretConfig.ssoConfig
      : null;

  if (!publicSsoConfig && !secretSsoConfig) {
    return merged;
  }

  merged.ssoConfig = {
    ...(publicSsoConfig || {}),
    ...(secretSsoConfig || {}),
  };

  return merged;
}

function getKeyBuffer(secret) {
  if (!secret) {
    throw new Error("Missing SSO encryption key");
  }

  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, "hex");
  }

  const base64Buffer = Buffer.from(secret, "base64");
  if (base64Buffer.length === 32) {
    return base64Buffer;
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecretConfig(secretConfig, encryptionKey) {
  const normalizedSecret =
    secretConfig && typeof secretConfig === "object" ? secretConfig : {};

  if (Object.keys(normalizedSecret).length === 0) {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const key = getKeyBuffer(encryptionKey);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(normalizedSecret), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptSecretConfig(payload, encryptionKey) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (payload.ssoConfig) {
    return payload;
  }

  const { iv, tag, ciphertext } = payload;
  if (!iv || !tag || !ciphertext) {
    return {};
  }

  const key = getKeyBuffer(encryptionKey);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext);
}

module.exports = {
  SENSITIVE_SSO_FIELDS,
  decryptSecretConfig,
  encryptSecretConfig,
  mergeSsoConfig,
  splitSsoConfig,
};
