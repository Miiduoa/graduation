'use strict';

const fs = require('fs');
const path = require('path');

const cache = {};

function loadPrompt(name) {
  if (cache[name]) return cache[name];
  const filePath = path.join(__dirname, 'prompts', `${name}.md`);
  cache[name] = fs.readFileSync(filePath, 'utf8');
  return cache[name];
}

module.exports = { loadPrompt };
