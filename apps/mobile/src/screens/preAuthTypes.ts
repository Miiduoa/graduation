/** 未登入導覽路由參數（獨立檔以避免 LoginLanding ↔ PreAuthStack 循環 import） */
export type PreAuthStackParamList = {
  LoginLanding: undefined;
  Map: undefined;
  BusSchedule: undefined;
  公告總覽: undefined;
  公告詳情: { id: string };
  SSOLogin: undefined;
  NuniWorkspace: { tab?: 'courses' | 'food' | 'merchant' | 'account' } | undefined;
};
