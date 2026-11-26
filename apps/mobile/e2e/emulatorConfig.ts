/** Test-entrypoint guard. The normal mobile entrypoint never imports this module. */
export type MaestroEmulatorConfig = {
  appEnv: unknown;
  maestro: unknown;
  useEmulator: unknown;
  projectId: unknown;
  host: unknown;
  authPort: unknown;
  firestorePort: unknown;
  allowMockAuth: unknown;
  universalDevAccounts: unknown;
};

export function assertMaestroEmulatorConfig(config: MaestroEmulatorConfig): void {
  if (config.appEnv !== 'development' || config.maestro !== '1' ||
      !['1', 'true'].includes(String(config.useEmulator)) ||
      config.projectId !== 'demo-campus-one' || config.host !== '127.0.0.1' ||
      String(config.authPort) !== '19291' || String(config.firestorePort) !== '18291' ||
      config.allowMockAuth !== false || config.universalDevAccounts !== false) {
    throw new Error('Maestro requires the isolated demo-campus-one loopback emulators; mock and universal accounts must stay disabled.');
  }
}

export const MAESTRO_STUDENT_EMAIL = 's0000001@test.campus-one.local';
export const MAESTRO_STUDENT_UID = 'test-student-a';
export const MAESTRO_LOGIN_LINK = 'campus://maestro/sign-in';
