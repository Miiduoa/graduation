"use client";

import { useEffect, useState } from "react";
import { fetchSchoolSSOConfig, type SchoolSSOConfig } from "./firebase";

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
          setConfig(
            fallbackToNull
              ? null
              : {
                  schoolId,
                  allowEmailLogin: true,
                  ssoConfig: null,
                }
          );
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

  return {
    config,
    ssoConfig: config?.ssoConfig ?? null,
    allowEmailLogin: config?.allowEmailLogin ?? true,
    loading,
  };
}
