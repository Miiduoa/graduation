'use strict';

const path = require('node:path');

const functionsRoot =
  process.env.FUNCTIONS_ROOT || path.resolve(__dirname, '../../backend/functions');
process.chdir(functionsRoot);

require(path.join(functionsRoot, 'flyRuntime.js'))
  .start()
  .catch((error) => {
    console.error('[functions-server] failed to start', error);
    process.exit(1);
  });
