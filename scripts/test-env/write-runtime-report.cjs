'use strict';

const fs = require('node:fs');
const path = require('node:path');

function refuseReport() {
  throw new Error('Refusing a symbolic link or unusable report file.');
}

function writeRuntimeReport(runtimeDir, name, value) {
  const reportPath = path.join(runtimeDir, name);
  try {
    const existing = fs.lstatSync(reportPath);
    if (!existing.isFile() || existing.nlink !== 1 || existing.uid !== process.getuid()) refuseReport();
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(reportPath, flags, 0o600);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) refuseReport();
    const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, payload);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { writeRuntimeReport };
