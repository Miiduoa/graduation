"""Pure personal-import overlay adapter. The build owner verifies the pinned input tree before calling it."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def extension_files():
    sources = {
        'apps/api/src/personal-import-sync/service.ts': HERE / 'service.ts',
        'apps/api/src/personal-import-sync/routes.ts': HERE / 'routes.ts',
        'apps/api/src/migrations/279_personal_import_sync.sql': HERE / '279_personal_import_sync.sql',
    }
    # Keep shared-module relative imports intact in the isolated API packaging source.
    for name in ['sync', 'backup', 'records', 'validation', 'types']:
        sources[f'apps/api/src/personal-import-sync/imports/{name}.ts'] = ROOT / f'packages/shared/src/imports/{name}.ts'
    for name in ['periods', 'schoolPeriods']:
        sources[f'apps/api/src/personal-import-sync/timetable/{name}.ts'] = ROOT / f'packages/shared/src/timetable/{name}.ts'
    return sources


def patch_app(source):
    anchor = '  const normalizedMethod = method.toUpperCase();'
    marker = '  app.get("/v1/auth/platform/providers",'
    if source.count(anchor) != 1 or source.count(marker) != 1 or 'registerPersonalImportSyncRoutes' in source:
        raise ValueError('Pinned Nuni integration anchors changed; review the personal-import adapter before building')
    source = 'import { registerPersonalImportSyncRoutes, isPersonalImportSyncRoute } from "./personal-import-sync/routes";\n' + source
    source = source.replace(anchor, anchor + '\n  if (process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED === "true" && isPersonalImportSyncRoute(normalizedMethod, pathname)) return true;')
    return source.replace(marker, '  registerPersonalImportSyncRoutes(app, db, platformAccounts);\n\n' + marker)
