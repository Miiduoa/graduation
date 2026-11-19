'use client';

import type { PersonalImportRecord } from '@campus/shared';
import { buildCampusRecommendations } from '@campus/shared/src/campusPersonalization';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { useCampusPersonalization } from '@/lib/useCampusPersonalization';
import type { PersonalImportScope } from '@/lib/personalImports';
import { campusPreferencesStorageKey } from '@/lib/campusPreferences';
import { CampusPersonalization } from './CampusPersonalization';

type Props = {
  scope: PersonalImportScope;
  now: Date;
  events: readonly PersonalImportRecord[];
  eventsReady: boolean;
  eventsError?: string;
  schoolName?: string;
};

export function CampusPersonalizationSection(props: Props) {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const currentOwner = platform?.session
    ? `platform:${platform.session.platformAccountId}`
    : auth.user
      ? `school:${auth.user.uid}`
      : 'guest';
  const available =
    !auth.loading &&
    !platform?.loading &&
    !platform?.pendingLogout &&
    !platform?.error &&
    (!auth.error || !!platform?.session) &&
    currentOwner === props.scope.owner;
  const { preferences, storageError, save } = useCampusPersonalization(
    available ? props.scope : null,
  );
  if (!available || !preferences) return null;
  const recommendations = buildCampusRecommendations({
    preferences,
    now: props.now,
    events: props.eventsReady && !props.eventsError ? props.events : [],
    schoolId: props.scope.schoolId,
  });
  return (
    <div>
      <CampusPersonalization
        key={campusPreferencesStorageKey(props.scope)}
        preferences={preferences}
        recommendations={recommendations}
        onSave={save}
        storageError={storageError}
        schoolName={props.schoolName}
        now={props.now}
        compactSetup
      />
      {props.scope.schoolId === 'personal' ? <p>選擇校園後，可以另外設定該校的首頁安排。</p> : null}
      {props.eventsError ? (
        <p role="status">個人行程暫時讀不到；目前依你的偏好安排，考試日期讀取完成後再更新。</p>
      ) : !props.eventsReady ? (
        <p role="status">正在確認個人行程，首頁偏好可以先設定。</p>
      ) : null}
    </div>
  );
}
