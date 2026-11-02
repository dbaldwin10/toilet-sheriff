import * as XLSX from 'https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs';
import {
  parseIncursionRows,
  analysePasses,
  formatClock,
  DEFAULT_LONG_PASS_MINUTES,
  DEFAULT_FREQUENT_PASSES
} from './incursions-analysis.js';


const fileInput = document.getElementById("inc-file");
const longInput = document.getElementById("inc-long-minutes");
const frequentInput = document.getElementById("inc-frequent");
const statusEl = document.getElementById("inc-status");
const results = document.getElementById("inc-results");
const yearFilterEl = document.getElementById("inc-year-filter");
const dateFilterEl = document.getElementById("inc-date-filter");
const dateBlock = document.getElementById("inc-date-block");
const dateCard = document.getElementById("inc-card-date");
const exportBtn = document.getElementById("inc-export");
const searchInput = document.getElementById("inc-student-search");

let allPasses = [];
let fileName = "";
let selectedYear = "all";
let selectedDate = "all";
let analysis = null;

// ---------- helpers ----------

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function formatDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function getOptions() {
  const longPassMinutes = Math.max(1, Number(longInput.value) || DEFAULT_LONG_PASS_MINUTES);
  const frequentPasses = Math.max(2, Number(frequentInput.value) || DEFAULT_FREQUENT_PASSES);
  return { longPassMinutes, frequentPasses };
}

function filteredPasses() {
  return allPasses.filter(p =>
    (selectedYear === "all" || p.year === selectedYear) &&
    (selectedDate === "all" || p.date === selectedDate)
  );
}

function table(headers, rows, emptyText = "Nothing to show.") {
  if (!rows.length) return `<p class="muted-text">${esc(emptyText)}</p>`;
  const head = headers.map(h => `<th>${esc(h)}</th>`).join("");
  const body = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table class="inc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function bars(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return items.map(i => `
    <div class="inc-bar-row">
      <span class="inc-bar-label">${esc(i.label)}</span>
      <span class="inc-bar-track"><span class="inc-bar-fill" style="width:${(i.value / max) * 100}%"></span></span>
      <span class="inc-bar-value">${i.value}</span>
    </div>`).join("");
}

function tile(value, label, note = "") {
  return `<div class="inc-tile"><div class="inc-tile-value">${esc(value)}</div><div class="inc-tile-label">${esc(label)}</div>${note ? `<div class="inc-tile-note">${esc(note)}</div>` : ""}</div>`;
}

// ---------- rendering ----------

function render() {
  const options = getOptions();
  const passes = filteredPasses();
  analysis = analysePasses(passes, options);
  const a = analysis;
  const o = a.overall;

  document.getElementById("inc-tiles").innerHTML = passes.length ? [
    tile(o.passes, "Total passes"),
    tile(o.students, "Different students", `${o.passesPerStudent} passes per student`),
    tile(`${o.avgDuration} min`, "Average length", `Median ${o.medianDuration} min`),
    tile(`${o.maxDuration} min`, "Longest pass"),
    tile(`${o.longPasses} (${o.longPassPercent}%)`, `Over ${a.longPassMinutes} min`),
    tile(a.frequentStudents.length, `Students with ${a.frequentPasses}+ passes`),
    tile(o.noScanOut, "No scan-out recorded", "Time may be unreliable"),
    tile(o.zeroMinutePasses, "Under 1 minute", "Possible scan error"),
    tile(o.peak.count, "Most out at once", o.peak.count ? `${formatClock(o.peak.time)}${o.days > 1 ? `, ${formatDate(o.peak.date)}` : ""}` : "")
  ].join("") : `<p class="muted-text">No passes match the current filters.</p>`;

  document.getElementById("inc-chart-hour").innerHTML = bars(a.byHour.map(h => ({ label: h.label, value: h.passes })));
  document.getElementById("inc-chart-duration").innerHTML = bars(a.durationBuckets.map(b => ({ label: b.label, value: b.count })));

  document.getElementById("inc-table-year").innerHTML = table(
    ["Year", "Passes", "Students", "Passes / student", "Avg min", "Total min"],
    a.byYear.map(y => [esc(`Year ${y.year}`), y.passes, y.students, y.passesPerStudent, y.avgDuration, y.totalMinutes])
  );

  document.getElementById("inc-table-roll").innerHTML = table(
    ["Roll class", "Passes", "Students", "Passes / student", "Avg min", "Total min"],
    [...a.byRoll].sort((x, y) => y.passes - x.passes || x.rollClass.localeCompare(y.rollClass))
      .map(r => [esc(r.rollClass), r.passes, r.students, r.passesPerStudent, r.avgDuration, r.totalMinutes])
  );

  dateCard.style.display = a.byDate.length > 1 ? "" : "none";
  document.getElementById("inc-table-date").innerHTML = table(
    ["Date", "Passes", "Students", "Avg min", "Total min"],
    a.byDate.map(d => [esc(formatDate(d.date)), d.passes, d.students, d.avgDuration, d.totalMinutes])
  );

  document.getElementById("inc-frequent-note").textContent =
    `Students with ${a.frequentPasses} or more passes in the selected period.`;
  document.getElementById("inc-table-frequent").innerHTML = table(
    ["Student", "Roll class", "Passes", "Total min", "Avg min", "Pass times"],
    a.frequentStudents.map(s => [esc(`${s.surname}, ${s.givenName}`), esc(s.rollClass), s.passes, s.totalMinutes, s.avgDuration, esc(s.times)]),
    "No students reached the frequent-user threshold."
  );

  document.getElementById("inc-long-note").textContent =
    `Passes longer than ${a.longPassMinutes} minutes. Rows marked * had no scan-out, so the time is the system's cut-off rather than a real return.`;
  document.getElementById("inc-table-long").innerHTML = table(
    ["Student", "Roll class", "Date", "Out", "Back", "Minutes"],
    a.longPasses.map(p => [
      esc(`${p.surname}, ${p.givenName}`), esc(p.rollClass), esc(formatDate(p.date)),
      formatClock(p.start), p.scannedOut ? formatClock(p.end) : `${formatClock(p.end)} *`, p.duration
    ]),
    "No passes over the threshold."
  );

  renderStudents();
}

function renderStudents() {
  if (!analysis) return;
  const q = searchInput.value.trim().toLowerCase();
  const list = analysis.byStudent.filter(s =>
    !q || `${s.givenName} ${s.surname} ${s.studentId} ${s.rollClass}`.toLowerCase().includes(q)
  );
  document.getElementById("inc-table-students").innerHTML = table(
    ["Student", "ID", "Roll class", "Passes", "Total min", "Avg min", "Longest"],
    list.map(s => [esc(`${s.surname}, ${s.givenName}`), esc(s.studentId), esc(s.rollClass), s.passes, s.totalMinutes, s.avgDuration, s.longest]),
    "No students match your search."
  );
}

function renderFilters(passes) {
  const years = [...new Set(passes.map(p => p.year))].sort((a, b) => Number(a) - Number(b));
  yearFilterEl.innerHTML = ["all", ...years].map(y =>
    `<button type="button" class="year-filter-btn${y === selectedYear ? " active" : ""}" data-year="${esc(y)}">${y === "all" ? "All" : `Year ${esc(y)}`}</button>`
  ).join("");

  const dates = [...new Set(passes.map(p => p.date))].sort();
  dateBlock.style.display = dates.length > 1 ? "" : "none";
  dateFilterEl.innerHTML = `<option value="all">All dates</option>` +
    dates.map(d => `<option value="${esc(d)}"${d === selectedDate ? " selected" : ""}>${esc(formatDate(d))}</option>`).join("");
}

// ---------- events ----------

yearFilterEl.addEventListener("click", e => {
  const btn = e.target.closest("[data-year]");
  if (!btn) return;
  selectedYear = btn.dataset.year;
  renderFilters(allPasses);
  render();
});

dateFilterEl.addEventListener("change", () => {
  selectedDate = dateFilterEl.value;
  render();
});

[longInput, frequentInput].forEach(el => el.addEventListener("change", () => allPasses.length && render()));
searchInput.addEventListener("input", renderStudents);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  statusEl.textContent = "Reading file...";
  results.classList.add("hidden");

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const { passes, skipped } = parseIncursionRows(rows);

    if (!passes.length) {
      statusEl.textContent = "No toilet passes found. Check this is the Incursions export (it needs Student ID and Time columns).";
      return;
    }

    allPasses = passes;
    fileName = file.name;
    selectedYear = "all";
    selectedDate = "all";
    searchInput.value = "";

    statusEl.textContent = `Loaded ${passes.length} passes from ${file.name}.` +
      (skipped.length ? ` ${skipped.length} row(s) could not be read (first: row ${skipped[0].rowNumber} – ${skipped[0].reason}).` : "");

    renderFilters(allPasses);
    results.classList.remove("hidden");
    render();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Could not read that file. Make sure it is the Sentral Incursions .xls/.xlsx export.";
  }
});

exportBtn.addEventListener("click", () => {
  if (!analysis) return;
  const a = analysis;
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name);

  add("Summary", [
    { Measure: "Source file", Value: fileName },
    { Measure: "Year filter", Value: selectedYear === "all" ? "All" : `Year ${selectedYear}` },
    { Measure: "Date filter", Value: selectedDate === "all" ? "All" : selectedDate },
    { Measure: "Total passes", Value: a.overall.passes },
    { Measure: "Different students", Value: a.overall.students },
    { Measure: "Passes per student", Value: a.overall.passesPerStudent },
    { Measure: "Average minutes", Value: a.overall.avgDuration },
    { Measure: "Median minutes", Value: a.overall.medianDuration },
    { Measure: "Longest pass (min)", Value: a.overall.maxDuration },
    { Measure: `Passes over ${a.longPassMinutes} min`, Value: a.overall.longPasses },
    { Measure: "No scan-out recorded", Value: a.overall.noScanOut }
  ]);
  add("By Hour", a.byHour.map(h => ({ Hour: h.label, Passes: h.passes, Students: h.students, "Avg min": h.avgDuration })));
  add("By Year", a.byYear.map(y => ({ Year: y.year, Passes: y.passes, Students: y.students, "Passes per student": y.passesPerStudent, "Avg min": y.avgDuration, "Total min": y.totalMinutes })));
  add("By Roll Class", a.byRoll.map(r => ({ "Roll class": r.rollClass, Passes: r.passes, Students: r.students, "Passes per student": r.passesPerStudent, "Avg min": r.avgDuration, "Total min": r.totalMinutes })));
  add("By Date", a.byDate.map(d => ({ Date: d.date, Passes: d.passes, Students: d.students, "Avg min": d.avgDuration, "Total min": d.totalMinutes })));
  add("Students", a.byStudent.map(s => ({ "Student ID": s.studentId, Surname: s.surname, "Given name": s.givenName, Year: s.year, "Roll class": s.rollClass, Passes: s.passes, "Total min": s.totalMinutes, "Avg min": s.avgDuration, "Longest min": s.longest, [`Passes over ${a.longPassMinutes} min`]: s.longPasses, "Pass times": s.times })));
  add("Long Passes", a.longPasses.map(p => ({ "Student ID": p.studentId, Surname: p.surname, "Given name": p.givenName, "Roll class": p.rollClass, Date: p.date, Out: formatClock(p.start), Back: formatClock(p.end), Minutes: p.duration, "Scanned out": p.scannedOut ? "Yes" : "No" })));

  XLSX.writeFile(wb, `toilet_pass_analysis_${a.overall.firstDate || "report"}.xlsx`);
});
