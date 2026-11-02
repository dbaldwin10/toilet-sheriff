// incursions-analysis.js
// Pure functions (no DOM) for analysing the Sentral "Incursions"
// export of toilet passes. Kept separate so it can be tested in Node.
//
// Expected columns:
//   Student ID | Surname | Given Name(s) | School Year | Roll Class | Date | Time | Comments
// where Time looks like "12:58pm - 01:02pm (0 hrs 03 mins)".

export const DEFAULT_LONG_PASS_MINUTES = 10;
export const DEFAULT_FREQUENT_PASSES = 3;

const TIME_RE = /^\s*(\d{1,2}):(\d{2})\s*([ap]m)\s*-\s*(\d{1,2}):(\d{2})\s*([ap]m)\s*(?:\(\s*(\d+)\s*hrs?\s*(\d+)\s*mins?\s*\))?/i;

function toMinutes(h, m, ampm) {
  let hour = Number(h) % 12;
  if (ampm.toLowerCase() === "pm") hour += 12;
  return hour * 60 + Number(m);
}

export function formatClock(minutes) {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function normaliseDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return text;
}

// Look a column up case/space-insensitively so small header changes don't break us.
function pick(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const target = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, "") === target);
    if (key !== undefined) return row[key];
  }
  return undefined;
}

/**
 * Turn raw sheet rows into clean pass records.
 * Returns { passes, skipped } where skipped lists rows that could not be read.
 */
export function parseIncursionRows(rows) {
  const passes = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const studentId = String(pick(row, ["Student ID"]) ?? "").trim();
    const timeText = String(pick(row, ["Time"]) ?? "");
    const match = timeText.match(TIME_RE);

    if (!studentId || !match) {
      // Fully blank rows are ignored silently; anything else is reported.
      if (studentId || timeText.trim()) skipped.push({ rowNumber: index + 2, reason: !studentId ? "Missing student ID" : `Unreadable time: "${timeText}"` });
      return;
    }

    const start = toMinutes(match[1], match[2], match[3]);
    const end = toMinutes(match[4], match[5], match[6]);
    const reported = match[7] !== undefined ? Number(match[7]) * 60 + Number(match[8]) : null;
    const duration = reported !== null ? reported : Math.max(0, end - start);

    const comments = String(pick(row, ["Comments", "Comment"]) ?? "");
    const scannedOut = /scanned out/i.test(comments);

    const surname = String(pick(row, ["Surname"]) ?? "").trim();
    const given = String(pick(row, ["Given Name(s)", "Given Names", "Given Name"]) ?? "").trim();

    passes.push({
      studentId,
      surname,
      givenName: given,
      name: `${given} ${surname}`.trim(),
      year: String(pick(row, ["School Year", "Year"]) ?? "").trim(),
      rollClass: String(pick(row, ["Roll Class"]) ?? "").trim(),
      date: normaliseDate(pick(row, ["Date"])),
      start,
      end,
      duration,
      scannedOut,
      comments
    });
  });

  return { passes, skipped };
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = n => Math.round(n * 10) / 10;

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function summarise(group) {
  const students = new Set(group.map(p => p.studentId));
  const total = group.reduce((s, p) => s + p.duration, 0);
  return {
    passes: group.length,
    students: students.size,
    totalMinutes: total,
    avgDuration: group.length ? round1(total / group.length) : 0,
    passesPerStudent: students.size ? round1(group.length / students.size) : 0
  };
}

const DURATION_BUCKETS = [
  { label: "0–2 min", min: 0, max: 2 },
  { label: "3–5 min", min: 3, max: 5 },
  { label: "6–10 min", min: 6, max: 10 },
  { label: "11–15 min", min: 11, max: 15 },
  { label: "16–20 min", min: 16, max: 20 },
  { label: "21+ min", min: 21, max: Infinity }
];

/**
 * Compute all statistics for a list of passes.
 * options: { longPassMinutes, frequentPasses }
 */
export function analysePasses(passes, options = {}) {
  const longPassMinutes = options.longPassMinutes ?? DEFAULT_LONG_PASS_MINUTES;
  const frequentPasses = options.frequentPasses ?? DEFAULT_FREQUENT_PASSES;

  const overall = summarise(passes);
  const durations = passes.map(p => p.duration).sort((a, b) => a - b);
  const dates = [...new Set(passes.map(p => p.date))].sort();

  const longPasses = passes
    .filter(p => p.duration > longPassMinutes)
    .sort((a, b) => b.duration - a.duration);

  const noScanOut = passes.filter(p => !p.scannedOut);

  // Passes by start hour (8am, 9am, ...).
  const byHourMap = groupBy(passes, p => Math.floor(p.start / 60));
  const hours = [...byHourMap.keys()];
  const byHour = [];
  if (hours.length) {
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
      const group = byHourMap.get(h) || [];
      byHour.push({ hour: h, label: formatClock(h * 60).replace(":00", ""), ...summarise(group) });
    }
  }

  const byYear = [...groupBy(passes, p => p.year)]
    .map(([year, group]) => ({ year, ...summarise(group) }))
    .sort((a, b) => Number(a.year) - Number(b.year));

  const byRoll = [...groupBy(passes, p => p.rollClass)]
    .map(([rollClass, group]) => ({ rollClass, year: group[0].year, ...summarise(group) }))
    .sort((a, b) => a.rollClass.localeCompare(b.rollClass));

  const byDate = [...groupBy(passes, p => p.date)]
    .map(([date, group]) => ({ date, ...summarise(group) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const durationBuckets = DURATION_BUCKETS.map(b => ({
    label: b.label,
    count: passes.filter(p => p.duration >= b.min && p.duration <= b.max).length
  }));

  const byStudent = [...groupBy(passes, p => p.studentId)]
    .map(([studentId, group]) => {
      const sortedGroup = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
      const total = group.reduce((s, p) => s + p.duration, 0);
      return {
        studentId,
        name: group[0].name,
        surname: group[0].surname,
        givenName: group[0].givenName,
        year: group[0].year,
        rollClass: group[0].rollClass,
        passes: group.length,
        totalMinutes: total,
        avgDuration: round1(total / group.length),
        longest: Math.max(...group.map(p => p.duration)),
        longPasses: group.filter(p => p.duration > longPassMinutes).length,
        times: sortedGroup.map(p => `${formatClock(p.start)} (${p.duration}m)`).join(", ")
      };
    })
    .sort((a, b) => b.passes - a.passes || b.totalMinutes - a.totalMinutes || a.surname.localeCompare(b.surname));

  const frequentStudents = byStudent.filter(s => s.passes >= frequentPasses);

  // Distribution of passes-per-student (1 pass, 2 passes, ...).
  const perStudentCounts = new Map();
  byStudent.forEach(s => perStudentCounts.set(s.passes, (perStudentCounts.get(s.passes) || 0) + 1));
  const passesPerStudentDistribution = [...perStudentCounts]
    .map(([passesCount, students]) => ({ passes: passesCount, students }))
    .sort((a, b) => a.passes - b.passes);

  // Students out of class at the same time (peak overlap) – useful for spotting
  // pile-ups. Computed per date with a simple sweep over start/end events.
  let peak = { count: 0, date: "", time: 0 };
  for (const [date, group] of groupBy(passes, p => p.date)) {
    const events = [];
    group.forEach(p => {
      events.push([p.start, 1]);
      events.push([Math.max(p.end, p.start) + 1, -1]); // end is inclusive minute
    });
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let current = 0;
    for (const [time, delta] of events) {
      current += delta;
      if (current > peak.count) peak = { count: current, date, time };
    }
  }

  return {
    overall: {
      ...overall,
      medianDuration: median(durations),
      maxDuration: durations.length ? durations[durations.length - 1] : 0,
      zeroMinutePasses: passes.filter(p => p.duration === 0).length,
      longPasses: longPasses.length,
      longPassPercent: passes.length ? round1((longPasses.length / passes.length) * 100) : 0,
      noScanOut: noScanOut.length,
      days: dates.length,
      firstDate: dates[0] || "",
      lastDate: dates[dates.length - 1] || "",
      peak
    },
    byHour,
    byYear,
    byRoll,
    byDate,
    durationBuckets,
    byStudent,
    frequentStudents,
    passesPerStudentDistribution,
    longPasses,
    noScanOut,
    longPassMinutes,
    frequentPasses
  };
}
