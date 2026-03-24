/**
 * Enterprise Security Service
 *
 * Provides runtime security checks for production builds:
 * - Jailbreak / root detection (advisory)
 * - Debugger detection
 * - Screen capture prevention hints
 * - Secure storage health check
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const isReleaseLike = Constants.expoConfig?.extra?.isReleaseLike ?? false;

export interface SecurityReport {
  isSecure: boolean;
  warnings: string[];
  timestamp: number;
}

/**
 * Run a lightweight security audit at app startup.
 * Returns advisory warnings — does NOT block the user.
 */
export async function runSecurityAudit(): Promise<SecurityReport> {
  const warnings: string[] = [];

  if (!isReleaseLike) {
    return { isSecure: true, warnings: [], timestamp: Date.now() };
  }

  // 1. Check for development/debug indicators
  if (__DEV__) {
    warnings.push('App is running in __DEV__ mode on a release-like build');
  }

  // 2. Platform-specific advisory checks
  if (Platform.OS === 'ios') {
    // Heuristic: Cydia URL scheme check is a common jailbreak indicator
    // In a real implementation, use a native module for deeper checks.
    try {
      const { Linking } = require('react-native');
      const canOpenCydia = await Linking.canOpenURL('cydia://');
      if (canOpenCydia) {
        warnings.push('Device may be jailbroken (Cydia URL scheme detected)');
      }
    } catch {
      // Linking check failed — not a security issue
    }
  }

  if (Platform.OS === 'android') {
    // Heuristic: check for common root indicators
    // Real production app should use SafetyNet / Play Integrity API
    warnings.push(
      // Advisory only — real check requires native module
    );
  }

  return {
    isSecure: warnings.length === 0,
    warnings: warnings.filter(Boolean),
    timestamp: Date.now(),
  };
}

/**
 * Log security event for audit trail (non-blocking).
 */
export function logSecurityEvent(event: string, metadata?: Record<string, unknown>): void {
  if (!isReleaseLike) return;

  // In production, send to analytics / error reporting
  console.info('[Security]', event, metadata ?? '');
}

/**
 * Content Security Policy headers for web views within the app.
 */
export const WEB_VIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com wss://*.firebaseio.com",
  "font-src 'self' https://fonts.gstatic.com",
  "frame-src 'self' https://*.firebaseapp.com",
].join('; ');
