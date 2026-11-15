import React, { useEffect, useState } from 'react';
import { getDormWorkflowConfig } from '../services/dormitoryCloud';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { AICard, AIButton } from '../ui/aiFirst';
import { DormWorkflow } from '../components/dorm/DormWorkflow';

/** dorm_staff remains a staff subtype; confirmed service capabilities add to the existing workspace. */
export function DormStaffHome({
  fallback,
  onOpen,
}: {
  fallback: (dormSection?: React.ReactNode) => React.ReactNode;
  onOpen: (route: string) => void;
}) {
  const { school } = useSchool();
  const { user } = useAuth();
  const capabilityKey = JSON.stringify([user?.uid, school.id]);
  const [capability, setCapability] = useState<{ key: string; available: boolean } | null>(null);
  const available = capability?.key === capabilityKey ? capability.available : false;
  useEffect(() => {
    let active = true;
    setCapability(null);
    if (!user?.uid) {
      setCapability({ key: capabilityKey, available: false });
      return;
    }
    void getDormWorkflowConfig(school.id)
      .then((config) => {
        if (active)
          setCapability({
            key: capabilityKey,
            available: config.enabled && (config.repairs || config.packages),
          });
      })
      .catch(() => {
        if (active) setCapability(null);
      });
    return () => {
      active = false;
    };
  }, [school.id, user?.uid, capabilityKey]);
  if (available !== true) return <>{fallback()}</>;
  return (
    <>
      {fallback(
        <>
          <DormWorkflow schoolId={school.id} uid={user?.uid} initialStaff />
          <AICard>
            <AIButton label="宿舍服務" onPress={() => onOpen('Dormitory')} />
          </AICard>
        </>,
      )}
    </>
  );
}
