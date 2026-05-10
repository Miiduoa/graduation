'use strict';

const getTodaySchedule = require('./getTodaySchedule');
const getAssignments = require('./getAssignments');
const getAnnouncements = require('./getAnnouncements');
const searchCampusDocs = require('./searchCampusDocs');
const getPrioritySummary = require('./getPrioritySummary');
const getLibraryLoans = require('./getLibraryLoans');
const submitLeaveRequest = require('./submitLeaveRequest');
const getLeaveRequestStatus = require('./getLeaveRequestStatus');
const reflectOnGap = require('./reflectOnGap');

const tools = [
  getTodaySchedule,
  getAssignments,
  getAnnouncements,
  searchCampusDocs,
  getPrioritySummary,
  getLibraryLoans,
  getLeaveRequestStatus,
  reflectOnGap,
  submitLeaveRequest,
];

const byName = new Map(tools.map((t) => [t.name, t]));

async function runTool(name, ctx, input) {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(ctx, input);
}

function toolRequiresConfirmation(name) {
  const tool = byName.get(name);
  return tool && tool.requiresConfirmation === true;
}

module.exports = { tools, runTool, byName, toolRequiresConfirmation };
