'use strict';

/**
 * Fly 把 secret 寫進 process.env；Cloud Functions 則走 defineSecret().value()。
 * 先讀環境變數，.value() 失敗時當成未設定，避免在 Fly 上變成 500。
 */
function readSecretValue(secretParam, envName) {
  const name = String(envName || secretParam?.name || '').trim();
  if (name) {
    const fromEnv = String(process.env[name] || '').trim();
    if (fromEnv) return fromEnv;
  }
  try {
    const value = typeof secretParam?.value === 'function' ? secretParam.value() : '';
    return value == null ? '' : String(value);
  } catch {
    return '';
  }
}

module.exports = { readSecretValue };
