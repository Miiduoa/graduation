'use strict';

const fs = require('node:fs');

function refuseReport() {
  throw new Error('Refusing a symbolic link or unusable report file.');
}

function writeRuntimeReport(runtimeFd, name, value) {
  if (!Number.isSafeInteger(runtimeFd) || runtimeFd < 3 ||
      typeof name !== 'string' || !name || name.includes('/') || name === '.' || name === '..') {
    refuseReport();
  }
  const directory = fs.fstatSync(runtimeFd);
  if (!directory.isDirectory() || directory.uid !== process.getuid()) refuseReport();
  // Node has no openat API. Linux procfs resolves this prefix to the held
  // directory, even if its original pathname now points somewhere else.
  const reportPath = `/proc/self/fd/${runtimeFd}/${name}`;
  try {
    const existing = fs.lstatSync(reportPath);
    if (!existing.isFile() || existing.nlink !== 1 || existing.uid !== process.getuid()) refuseReport();
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  const fd = fs.openSync(reportPath, flags, 0o600);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) refuseReport();
    const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, payload);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { writeRuntimeReport };
