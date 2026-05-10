'use strict';

const cases = require('./cases.json');
const { detectCampusAssistantIntent } = require('../lib/assistantFormat');

function classifyIntent(text) {
  const name = detectCampusAssistantIntent(text);
  const table = cases.intentConfidence || {};
  const confidence = typeof table[name] === 'number' ? table[name] : 0.75;
  return { name, confidence };
}

module.exports = { classifyIntent };
