# OMR Evaluator

A browser app for The Logic Room / Ganitasastram to print our own OMR answer sheets and check
them from phone photos or scans. Modelled on the WBCHSE Semester I / III sheet: 40 questions
(theory subjects) or 35 (subjects with practicals), four options, 1 mark each.

## Use

Open `public/index.html` in Chrome or Edge (double-click it, or host the folder anywhere). Nothing to
install; all data stays in that browser.

1. **Print sheets** – pick institute, 35/40 questions, roll digits, set bubbles, colour; upload the logo; print on A4.
2. **Exam & answer key** – name the exam, set marks / negative marks, enter the key (tap, type, or photograph a filled key sheet). One key per set if sets A–D are used.
3. **Scan & check** – choose photos or scans (JPG/PNG). Each sheet shows the marked-up page, class, roll, set and score; anything doubtful is flagged and can be corrected by tapping.
4. **Results** – marks table, grade (WBCHSE bands), question-wise analysis, CSV download for Excel.

## How reading works

The four black corner squares locate the page, the small squares on the top edge tell which
sheet variant it is and which way up, the page is flattened, each bubble block is nudged onto
its printed circles, and ink is measured in the red channel (so the pink print disappears while
blue and black pen stay dark). Geometry lives in `public/js/layout.js` and is shared by the sheet
maker and the reader.

## Tests

Needs Node with Playwright.

    node tests/synthetic.js 60   # fake phone photos (tilt, rotation, curl, shadow, blur) read back
    node tests/ui.js             # walks through the app end to end

## Hosting on Cloudflare (with sync between phone and laptop)

The repo is a Cloudflare Worker: `public/` is the site, `src/worker.js` answers `/api/sync`,
and `wrangler.jsonc` ties them to a D1 database (created automatically on the first deploy).

1. Cloudflare dashboard → Workers & Pages → Create → import this GitHub repo. Keep the default
   deploy command (`npx wrangler deploy`). The Worker must be named `omr-evaluator`, or change
   `name` in `wrangler.jsonc` to match.
2. In the Worker → Settings → Variables and Secrets → Add: type Secret, name `APP_PASSWORD`,
   value = a passcode of your choice.
3. Open the site on each device → **Devices** tab → enter the passcode → Turn on.

Local test of sync: `echo 'APP_PASSWORD=test123' > .dev.vars`, then
`npx wrangler dev --port 8799` and `node tests/sync.js`.
