# OMR Evaluator

A browser app for The Logic Room / Ganitasastram to print our own OMR answer sheets and check
them from phone photos or scans. Modelled on the WBCHSE Semester I / III sheet: 40 questions
(theory subjects) or 35 (subjects with practicals), four options, 1 mark each.

## Use

Open the site and sign in. (Opening `public/index.html` straight from the disk also works: no
sign-in, and all data stays in that browser.)

1. **Exams** – every exam is a card. Create one, give it a name, subject, date and topics, enter the
   answer key (tap, type, or photograph a filled key sheet; one key per set if sets A–D are used).
   Inside the exam: **Scan sheets** (one photo or many; tilted, upside-down and slightly bowed sheets
   are fine), check anything flagged, then read the results: overview, topper, charts, marks table
   (each row unfolds to show the scanned sheet and correct its answers), question-wise analysis.
   **Download Excel file** gives a formatted workbook with charts. An exam is private until its owner
   presses **Share with other teachers**; the others can then look at it but not change it.
2. **Performance** – the class average of every exam in a subject, in date order.
3. **Print sheet** – pick the exam (its name and topics become the heading), logo, 35/40 questions,
   roll digits, question sets, print colour; print on A4.
4. **Account** – change password, sign out; the administrator adds teachers and resets passwords.

Photos of scanned sheets stay on the device that scanned them; everything else follows the account.

## How reading works

The corner square with the row of small squares beside it is found first (those squares also say
which sheet variant it is), then the other three corners; a ring-template check on the first answer
block rejects look-alike background patterns, the page is flattened, each bubble block is nudged onto
its printed circles, and ink is measured in the red channel (so the pink print disappears while
blue and black pen stay dark). Geometry lives in `public/js/layout.js` and is shared by the sheet
maker and the reader.

## Tests

Needs Node with Playwright.

    node tests/synthetic.js 60   # fake phone photos (tilt, rotation, curl, shadow, blur) read back
    node tests/ui.js             # walks through the app end to end
    node tests/sync.js           # sign-in, sync and sharing; needs the local server (see below)

## Hosting on Cloudflare

The repo is a Cloudflare Worker: `public/` is the site, `src/` answers `/api/*` (accounts in
`auth.js`, syncing and sharing in `sync.js`), and `wrangler.jsonc` ties them to a D1 database
(created automatically on the first deploy).

1. Cloudflare dashboard → Workers & Pages → Create → import this GitHub repo. Keep the default
   deploy command (`npx wrangler deploy`). The Worker must be named `omr-evaluator`, or change
   `name` in `wrangler.jsonc` to match.
2. In the Worker → Settings → Variables and Secrets → Add: type Secret, name `APP_PASSWORD`,
   value = a code of your choice. It is asked for once, as the "setup code".
3. Open the site. The first visit creates the administrator account (setup code, name, email,
   password). Exams saved by the earlier passcode-only version move to that account.
4. Account tab → add the other teachers. There is no password-reset email; the administrator sets
   a new password for a teacher who forgot theirs.

Optional "Sign in with Google" button: create an OAuth client ID (type "Web application", with the
site address as an authorised JavaScript origin) in Google Cloud Console and add it to the Worker as
a variable named `GOOGLE_CLIENT_ID`. Only emails the administrator has added can sign in.

Local test: `echo 'APP_PASSWORD=test123' > .dev.vars`, then
`rm -rf .wrangler && npx wrangler dev --port 8799` and `node tests/sync.js`.
