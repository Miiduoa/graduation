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
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    setAvailable(null);
    if (!user?.uid) {
      setAvailable(false);
      return;
    }
    void httpsCallable<Record<string, unknown>, DormWorkflowConfig>(
      getFunctionsInstance(),
      'dormWorkflow',
    )({ action: 'config', schoolId: toPublicSchoolId(school.id) ?? school.id })
      .then((result) => {
        if (active)
          setAvailable(result.data.enabled && (result.data.repairs || result.data.packages));
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [school.id, user?.uid]);
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
