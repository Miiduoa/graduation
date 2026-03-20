"use client";

import { useEffect, useState } from "react";
import { getSchoolSsoAvailability, type SchoolSsoAvailability } from "@campus/shared/src/auth";
import { fetchSchoolSSOConfig, type SchoolSSOConfig } from "./firebase";

export type SchoolSsoState = {
  config: SchoolSSOConfig | null;
  ssoConfig: SchoolSSOConfig["ssoConfig"];
  allowEmailLogin: boolean;
  availability: SchoolSsoAvailability;
  ssoReady: boolean;
  loading: boolean;
};

export function getSchoolSsoFallbackConfig(
  schoolId: string,
  fallbackToNull: boolean = false
): SchoolSSOConfig | null {
  if (fallbackToNull) {
    return null;
  }

  return {
    schoolId,
    allowEmailLogin: true,
    ssoConfig: null,
  };
}

export function toSchoolSsoState(
  config: SchoolSSOConfig | null,
  loading: boolean
): SchoolSsoState {
  const availability = getSchoolSsoAvailability(config);

  return {
    config,
    ssoConfig: config?.ssoConfig ?? null,
    allowEmailLogin: config?.allowEmailLogin ?? true,
    availability,
    ssoReady: availability.isLoginReady,
    loading,
  };
}

export function useSchoolSsoConfig(schoolId: string, fallbackToNull: boolean = false) {
  const [config, setConfig] = useState<SchoolSSOConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await fetchSchoolSSOConfig(schoolId);
        if (active) {
          setConfig(next);
        }
      } catch (error) {
        console.error("Failed to load school SSO config:", error);
        if (active) {
          setConfig(getSchoolSsoFallbackConfig(schoolId, fallbackToNull));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [fallbackToNull, schoolId]);

  return toSchoolSsoState(config, loading);
}
