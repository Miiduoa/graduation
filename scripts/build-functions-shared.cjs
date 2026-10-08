const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const shared = path.join(root, 'packages/shared');
const output = path.join(root, 'backend/functions/generated/shared');
const sharedRequire = createRequire(path.join(shared, 'package.json'));
const compiler = sharedRequire.resolve('typescript/bin/tsc');

// Rebuild from the shared sources so removed modules cannot survive a previous build.
fs.rmSync(output, { recursive: true, force: true });
try {
  execFileSync(
    process.execPath,
    [
      compiler,
      '--project',
      path.join(shared, 'tsconfig.cjs.json'),
      '--outDir',
      output,
      '--declaration',
      'false',
      '--noEmitOnError',
      'true',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  fs.writeFileSync(
    path.join(output, 'package.json'),
    `${JSON.stringify({ private: true, type: 'commonjs' }, null, 2)}\n`,
  );
  console.log('Built shared runtime modules inside backend/functions/generated/shared.');
} catch (error) {
  fs.rmSync(output, { recursive: true, force: true });
  throw error;
}
