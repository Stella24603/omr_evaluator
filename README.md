# OMR Evaluator

A browser app for The Logic Room / Ganitasastram to print our own OMR answer sheets and check
them from phone photos or scans. Modelled on the WBCHSE Semester I / III sheet: 40 questions
(theory subjects) or 35 (subjects with practicals), four options, 1 mark each.

## Use

Open `index.html` in Chrome or Edge (double-click it, or host the folder anywhere). Nothing to
install; all data stays in that browser.

1. **Print sheets** – pick institute, 35/40 questions, roll digits, set bubbles, colour; upload the logo; print on A4.
2. **Exam & answer key** – name the exam, set marks / negative marks, enter the key (tap, type, or photograph a filled key sheet). One key per set if sets A–D are used.
3. **Scan & check** – choose photos or scans (JPG/PNG). Each sheet shows the marked-up page, class, roll, set and score; anything doubtful is flagged and can be corrected by tapping.
4. **Results** – marks table, grade (WBCHSE bands), question-wise analysis, CSV download for Excel.

## How reading works

The four black corner squares locate the page, the small squares on the top edge tell which
sheet variant it is and which way up, the page is flattened, each bubble block is nudged onto
its printed circles, and ink is measured in the red channel (so the pink print disappears while
blue and black pen stay dark). Geometry lives in `js/layout.js` and is shared by the sheet
maker and the reader.

## Tests

Needs Node with Playwright.

    node tests/synthetic.js 60   # fake phone photos (tilt, rotation, curl, shadow, blur) read back
    node tests/ui.js             # walks through the app end to end
