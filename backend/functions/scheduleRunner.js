'use strict';

const WEEKDAY = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    minute: Number(map.minute),
    hour: Number(map.hour),
    day: Number(map.day),
    month: Number(map.month),
    dow: WEEKDAY[map.weekday] ?? 0,
  };
}

function matchField(expr, value) {
  if (expr === '*') return true;
  return Number(expr) === value;
}

function cronMatches(expression, date, timeZone = 'Asia/Taipei') {
  const parts = String(expression || '')
    .trim()
    .split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const zoned = zonedParts(date, timeZone);
  return (
    matchField(minute, zoned.minute) &&
    matchField(hour, zoned.hour) &&
    matchField(dayOfMonth, zoned.day) &&
    matchField(month, zoned.month) &&
    matchField(dayOfWeek, zoned.dow)
  );
}

function intervalMsForSchedule(schedule) {
  const text = String(schedule || '').trim().toLowerCase();
  const every = text.match(/^every\s+(\d+)\s+(minutes?|hours?)$/);
  if (every) {
    const count = Number(every[1]);
    const unit = every[2].startsWith('hour') ? 60 * 60 * 1000 : 60 * 1000;
    return count * unit;
  }
  return null;
}

function startScheduleRunner(schedules, { enabled = true, now = () => new Date(), log = console } = {}) {
  const handles = [];
  if (!enabled) {
    return { stop() {}, handles };
  }

  const running = new Set();

  async function runJob(name, job) {
    if (running.has(name)) return;
    running.add(name);
    try {
      await job.handler({
        jobName: name,
        scheduleTime: now().toISOString(),
      });
    } catch (error) {
      log.error?.(`[schedule] ${name} failed`, error);
    } finally {
      running.delete(name);
    }
  }

  for (const [name, job] of Object.entries(schedules || {})) {
    const intervalMs = intervalMsForSchedule(job.schedule);
    if (intervalMs) {
      const timer = setInterval(() => {
        runJob(name, job);
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      handles.push(timer);
      continue;
    }
    if (String(job.schedule || '').trim().split(/\s+/).length === 5) {
      let lastKey = '';
      const timer = setInterval(() => {
        const date = now();
        const zone = job.timeZone && job.timeZone !== 'RESET_VALUE' ? job.timeZone : 'Asia/Taipei';
        if (!cronMatches(job.schedule, date, zone)) return;
        const key = `${name}:${date.toISOString().slice(0, 16)}`;
        if (key === lastKey) return;
        lastKey = key;
        runJob(name, job);
      }, 20 * 1000);
      if (typeof timer.unref === 'function') timer.unref();
      handles.push(timer);
    } else {
      log.warn?.(`[schedule] ${name} has unsupported schedule "${job.schedule}"`);
    }
  }

  return {
    stop() {
      for (const handle of handles) clearInterval(handle);
    },
    handles,
  };
}

module.exports = {
  cronMatches,
  intervalMsForSchedule,
  startScheduleRunner,
  zonedParts,
};
