# toilet-sheriff

A static, browser-only tool for analysing the Sentral **Incursions** export (toilet passes). No sign-in, backend or database: the spreadsheet is read in your browser and never uploaded.

Open `index.html` (or host the folder on GitHub Pages), choose the `.xls`/`.xlsx` file, and you get:

- summary (passes, students, average/median/longest, long passes, peak number out at once)
- passes by time of day and by length
- tables by year group, roll class and day
- frequent users, long passes and a searchable student list
- Excel export of the analysis

Thresholds for a "long pass" (default 10 min) and a "frequent user" (default 3 passes) can be changed on the page.

## Files

- `incursions-analysis.js`: pure parsing and statistics functions (no DOM, testable in Node)
- `incursions.js`: page logic, filters, tables, charts and export
- `index.html`, `style.css`: the page

## Expected columns

`Student ID`, `Surname`, `Given Name(s)`, `School Year`, `Roll Class`, `Date`, `Time` (e.g. `12:58pm - 01:02pm (0 hrs 03 mins)`), `Comments`. A pass with no "Scanned out" in `Comments` is flagged as having no scan-out, since its length is then the system cut-off rather than a real return.
