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
const reserveSeat = require('./reserveSeat');
const borrowBook = require('./borrowBook');
const returnBook = require('./returnBook');
const renewBook = require('./renewBook');
const createDormRepairRequest = require('./createDormRepairRequest');
const listMyDormRepairs = require('./listMyDormRepairs');
const getDormRepairStatus = require('./getDormRepairStatus');
const reserveWashingMachine = require('./reserveWashingMachine');
const createOrder = require('./createOrder');
const cancelOrder = require('./cancelOrder');

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
  reserveSeat,
  borrowBook,
  returnBook,
  renewBook,
  createDormRepairRequest,
  listMyDormRepairs,
  getDormRepairStatus,
  reserveWashingMachine,
  createOrder,
  cancelOrder,
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
