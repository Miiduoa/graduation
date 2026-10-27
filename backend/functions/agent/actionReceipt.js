'use strict';

// A successful callable response must carry evidence for the specific operation.
// Fail closed for missing/malformed responses and newly introduced write tools.
const hasId = (v) => typeof v === 'string' && v.trim().length > 0;
const hasTime = (v) => hasId(v) && Number.isFinite(Date.parse(v));

function confirmedAgentWrite(toolName, result, input = {}, scope = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  if (Object.prototype.hasOwnProperty.call(result, 'success') && result.success !== true) return false;
  switch (toolName) {
    case 'submitLeaveRequest':
      return hasId(result.requestId) && result.status === 'pending';
    case 'reserveSeat':
      return hasId(result.reservationId) && hasId(result.seatId) &&
        result.seatId === input.seatId && hasId(result.date) && result.date === input.date;
    case 'borrowBook':
      return hasId(result.loanId) && hasTime(result.dueAt);
    case 'returnBook':
      return result.success === true && hasId(result.bookTitle);
    case 'renewBook':
      return result.success === true && hasTime(result.newDueAt) &&
        Number.isInteger(result.renewCount) && result.renewCount > 0;
    case 'createDormRepairRequest':
      return result.success === true && hasId(result.repairId) &&
        result.requestId === result.repairId && result.status === 'pending' &&
        result.room === input.room && result.dormitory === input.dormitory;
    case 'reserveWashingMachine':
      return hasId(result.reservationId) && hasId(result.machineId) &&
        result.machineId === input.machineId && hasTime(result.reservedUntil);
    case 'createOrder':
      return result.success === true && hasId(result.orderId) &&
        result.userId === scope.uid && result.schoolId === scope.schoolId &&
        Number.isFinite(result.total) && result.total >= 0 &&
        Array.isArray(result.items) && result.items.length > 0;
    case 'cancelOrder':
      return result.success === true && hasId(result.orderId) &&
        result.orderId === input.orderId;
    case 'submitQuizAttempt':
      return result.success === true && result.attempt !== null &&
        typeof result.attempt === 'object' && !Array.isArray(result.attempt) &&
        hasTime(result.attempt.submittedAt);
    case 'verifyAttendanceClaim':
      return result.success === true && hasId(result.status) && Array.isArray(result.flags);
    default:
      return false;
  }
}

module.exports = { confirmedAgentWrite };
