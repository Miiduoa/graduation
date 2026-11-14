import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import type { DormWorkflowConfig } from '@campus/shared/src/dormWorkflow';
import { getFunctionsInstance } from '../firebase';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';
import { DormWorkflow } from '../components/dorm/DormWorkflow';

/** dorm_staff remains a staff subtype; service capabilities determine the workspace. */
export function DormStaffHome({
  fallback,
  onOpen,
}: {
  fallback: React.ReactNode;
  onOpen: (route: string) => void;
}) {
  const { school } = useSchool();
  const { user } = useAuth();
  const capabilityKey = JSON.stringify([user?.uid, school.id]);
  const [capability, setCapability] = useState<{ key: string; available: boolean } | null>(null);
  const available = capability?.key === capabilityKey ? capability.available : true;
  useEffect(() => {
    let active = true;
    setCapability(null);
    if (!user?.uid) {
      setCapability({ key: capabilityKey, available: false });
      return;
    }
    void httpsCallable<Record<string, unknown>, DormWorkflowConfig>(
      getFunctionsInstance(),
      'dormWorkflow',
    )({ action: 'config', schoolId: toPublicSchoolId(school.id) ?? school.id })
      .then((result) => {
        if (active)
          setCapability({
            key: capabilityKey,
            available: result.data.enabled && (result.data.repairs || result.data.packages),
          });
      })
      .catch(() => {
        if (active) setCapability(null);
      });
    return () => {
      active = false;
    };
  }, [school.id, user?.uid, capabilityKey]);
  if (available !== true) return <>{fallback}</>;
  return (
    <AIDetailScreen title="校務服務" subtitle="職員・宿舍輔導員">
      <DormWorkflow schoolId={school.id} uid={user?.uid} initialStaff />
      <AICard>
        <AIButton label="查看校方公告" onPress={() => onOpen('公告總覽')} />
        <AIButton label="宿舍服務" onPress={() => onOpen('Dormitory')} />
      </AICard>
    </AIDetailScreen>
  );
}
