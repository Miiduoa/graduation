'use strict';

const getTodaySchedule = require('./getTodaySchedule');
const getAssignments = require('./getAssignments');
const getAnnouncements = require('./getAnnouncements');
const searchCampusDocs = require('./searchCampusDocs');
const getPrioritySummary = require('./getPrioritySummary');

const tools = [
  getTodaySchedule,
  getAssignments,
  getAnnouncements,
  searchCampusDocs,
  getPrioritySummary,
];

const byName = new Map(tools.map((t) => [t.name, t]));

async function runTool(name, ctx, input) {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(ctx, input);
}

module.exports = { tools, runTool, byName };
