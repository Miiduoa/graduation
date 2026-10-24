'use strict';
/**
 * Inventory installed package metadata under a standalone /app tree only.
 * Adapted from the root runtime-inventory.cjs; does not walk archived API/mobile trees.
 *
 * Usage (inside container or against an extracted root):
 *   node runtime-inventory-app.cjs /app
 */
const fs = require('node:fs');
const path = require('node:path');

function inventory(root) {
  const todo = [path.join(root, 'node_modules'), path.join(root, 'apps/web/node_modules')];
  const seen = new Set();
  const packages = new Map();
  while (todo.length) {
    const dir = todo.pop();
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (!(real === root || real.startsWith(`${root}/`)) || seen.has(real)) continue;
    seen.add(real);
    if (seen.size > 50000) throw new Error('Package directory traversal limit exceeded');
    let entries;
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(real, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) todo.push(full);
      else if (entry.name === 'package.json') {
        try {
          const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (
            pkg.private
            || typeof pkg.name !== 'string'
            || typeof pkg.version !== 'string'
            || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(pkg.version)
            || pkg.version === '0.0.0'
          ) {
            continue;
          }
          if (!packages.has(pkg.name)) packages.set(pkg.name, new Set());
          packages.get(pkg.name).add(pkg.version);
        } catch {
          // ignore malformed package.json
        }
      }
    }
  }
  return {
    root,
    directories: seen.size,
    packages: Object.fromEntries(
      [...packages.entries()].sort().map(([name, versions]) => [name, [...versions].sort()]),
    ),
  };
}

const target = process.argv[2] || '/app';
const report = inventory(path.resolve(target));
const focus = ['next', 'sharp', 'source-map-js'];
const focused = Object.fromEntries(focus.map((name) => [name, report.packages[name] || []]));
console.log(JSON.stringify({ focused, inventory: report }, null, 2));
