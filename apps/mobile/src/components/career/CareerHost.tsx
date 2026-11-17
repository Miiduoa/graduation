import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../state/auth';
import { getAuthInstance as getAuth } from '../../firebase';
import { Linking, Text } from 'react-native';
const getCloudFunctionUrl = (name: string) => `https://nuni.tw/api/fn/${name}`;
import { loadPersonalTimetable } from '../../services/personalTimetable';
import {
  createCareerCallableTransport,
  createWorkstudyService,
} from '@campus/shared/src/careerWorkstudy';
import { createInternshipCallableTransport } from '@campus/shared/src/careerInternship';
import { createCareerInternshipPorts } from './careerInternshipPorts';
import { CareerWorkstudy } from './CareerWorkstudy';
import { CareerInternship } from './CareerInternship';

export function CareerHost({ schoolId }: { schoolId: string }) {
  const { user } = useAuth();
  const loginUrl = `/login?returnUrl=${encodeURIComponent(`/career?schoolId=${schoolId}`)}`;
  return user ? (
    <Workspace
      key={`${user.uid}:${schoolId}`}
      uid={user.uid}
      schoolId={schoolId}
      loginUrl={loginUrl}
    />
  ) : (
    <>
      <Text>登入後查看本校工讀、實習與校徵</Text>
      <Text
        onPress={() => {
          void Linking.openURL(`https://nuni.tw${loginUrl}`);
        }}
      >
        登入後可申請校內工讀與查看實習學分
      </Text>
    </>
  );
}
function Workspace({
  uid,
  schoolId,
  loginUrl,
}: {
  uid: string;
  schoolId: string;
  loginUrl: string;
}) {
  const [review, setReview] = useState(false);
  const [operate, setOperate] = useState(false);
  const [internshipStaff, setInternshipStaff] = useState(false);
  const ports = useMemo(
    () =>
      createPorts(uid, schoolId, (canReview, canOperate, canManageInternship) => {
        setReview(canReview);
        setOperate(canOperate);
        setInternshipStaff(canManageInternship);
      }),
    [uid, schoolId],
  );
  useEffect(() => {
    ports.activate();
    return () => {
      ports.dispose();
    };
  }, [ports]);
  const onLogin = () => {
    void Linking.openURL(`https://nuni.tw${loginUrl}`);
  };
  const workstudy = (audience: 'student' | 'staff' | 'ops') => (
    <CareerWorkstudy
      key={`workstudy:${audience}`}
      schoolId={schoolId}
      ownerKey={uid}
      service={ports.workstudy}
      audience={audience}
      loadCourses={ports.loadCourses}
      onLogin={onLogin}
      onCareerEvents={({ event }) => {
        const schoolSearch = `schoolId=${encodeURIComponent(schoolId)}`;
        const path = event
          ? `/events/${encodeURIComponent(event.id)}?${schoolSearch}&source=${event.source}`
          : `/events?${schoolSearch}`;
        void Linking.openURL(`https://nuni.tw${path}`);
      }}
    />
  );
  const internship = (audience: 'student' | 'staff' | 'ops') => (
    <CareerInternship
      key={`internship:${audience}`}
      schoolId={schoolId}
      ownerKey={uid}
      uid={uid}
      service={ports.service}
      audience={audience}
      onLogin={onLogin}
      onAddCalendar={ports.onAddCalendar}
    />
  );
  return (
    <>
      {workstudy('student')}
      {internship('student')}
      {review && workstudy('staff')}
      {operate && workstudy('ops')}
      {internshipStaff && internship('staff')}
      {internshipStaff && operate && internship('ops')}
    </>
  );
}

function createPorts(
  uid: string,
  schoolId: string,
  onPermissions: (review: boolean, operate: boolean, internshipManage: boolean) => void,
) {
  let live = true;
  const active = () => live && getAuth()?.currentUser?.uid === uid;
  const waitForUser = async () => {
    const deadline = Date.now() + 12000;
    while (live && Date.now() < deadline) {
      const user = getAuth()?.currentUser;
      if (user?.uid === uid) return user;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return getAuth()?.currentUser?.uid === uid ? getAuth()!.currentUser : null;
  };
  const authHeaders = async () => {
    const user = await waitForUser();
    if (!live) throw new Error('帳號已變更');
    if (!user) throw new Error('請重新登入');
    const token = await user.getIdToken();
    if (!active()) throw new Error('帳號已變更');
    return { Authorization: `Bearer ${token}` };
  };
  const fetcher: typeof fetch = async (input, init) => {
    try {
      return await fetch(input, init);
    } catch {
      throw Object.assign(new Error('職涯服務暫時無法使用，請重新整理。'), {
        code: 'network-request-failed',
      });
    }
  };
  const workstudy = createWorkstudyService(
    schoolId,
    createCareerCallableTransport({
      endpoint: getCloudFunctionUrl('careerWorkstudy'),
      fetcher,
      authHeaders,
    }),
  );
  const permissionState = { canReview: false, canOperate: false, internshipManage: false };
  const originalWorkstudyLoad = workstudy.load;
  workstudy.load = async (audience, options) => {
    const result = await originalWorkstudyLoad(audience, options);
    if (active() && audience === 'student') {
      permissionState.canReview = result.canReview;
      permissionState.canOperate = result.canOperate;
      onPermissions(
        permissionState.canReview,
        permissionState.canOperate,
        permissionState.internshipManage,
      );
    }
    return result;
  };
  const internshipPorts = createCareerInternshipPorts({
    schoolId,
    transport: createInternshipCallableTransport({
      endpoint: getCloudFunctionUrl('careerInternship'),
      fetcher,
      authHeaders,
    }),
    scope: { owner: `platform:${uid}`, schoolId },
    active,
  });
  const internshipLoad = internshipPorts.service.load;
  internshipPorts.service.load = async (audience, options) => {
    const result = await internshipLoad(audience, options);
    if (active() && audience === 'student') {
      permissionState.internshipManage = result.canManage === true;
      onPermissions(
        permissionState.canReview,
        permissionState.canOperate,
        permissionState.internshipManage,
      );
    }
    return result;
  };
  return {
    workstudy,
    loadCourses: async () => {
      const { courses } = await loadPersonalTimetable(uid, schoolId);
      return courses.length ? courses : null;
    },
    ...internshipPorts,
    activate: () => {
      live = true;
    },
    dispose: () => {
      live = false;
    },
  };
}
