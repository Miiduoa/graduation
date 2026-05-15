/** 未登入導覽路由參數（獨立檔以避免 LoginLanding ↔ PreAuthStack 循環 import） */
export type PreAuthStackParamList = {
  LoginLanding: undefined;
  SSOLogin: undefined;
};
