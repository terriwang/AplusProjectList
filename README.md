# HDA Intelligence Database

A browser-based database for reviewing, searching, filtering and comparing Housing Delivery
Authority (HDA) projects, built from one or more official HDA Excel workbooks (a main database
export, plus any addendum exports). The Excel files are the only source of project data —
nothing has been added, guessed, corrected or enriched.

## Project structure

```
hda-database/
├── index.html                     Page markup
├── styles.css                     All styling
├── app.js                         Search, filter, sort, drawer and URL-state logic
├── data/
│   └── hda-projects.json          Generated project data (do not hand-edit)
├── scripts/
│   └── convert-excel-to-json.py   Excel → JSON converter
└── README.md
```

## Running locally

The site is static HTML/CSS/JS with no build step. Because it loads `data/hda-projects.json`
with `fetch()`, opening `index.html` directly with a `file://` URL will be blocked by the
browser in some setups — use a simple local server instead:

```bash
cd hda-database
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Updating the database

When a new, revised, or addendum Excel workbook is available:

1. Keep the workbook file(s) wherever convenient (they don't need to live inside this folder).
2. Regenerate the JSON, passing **one or more** workbook paths:

   ```bash
   cd hda-database

   # Replace the entire dataset with a single (new "final version") workbook:
   python3 scripts/convert-excel-to-json.py path/to/HDA_Database.xlsx

   # Merge a main database export with one or more addendum exports —
   # every row from every file listed is included, nothing is de-duplicated
   # automatically:
   python3 scripts/convert-excel-to-json.py path/to/HDA_Database.xlsx path/to/Addendum.xlsx
   ```

3. The script overwrites `data/hda-projects.json` with the combined result. Refresh the page
   (or restart the local server) to see the update. For each file it prints the worksheet used,
   the number of projects exported, and any header or status warnings. At the end it also warns
   (without dropping anything) if the same EOI Reference Number turns up in more than one file,
   so you can check by eye whether that's an expected addendum correction or an accidental
   duplicate. It finishes with a combined status breakdown so you can sanity-check the total
   against the source file(s).

Whether to run it with one file or several depends on what you were given: if a new workbook is
described as the complete, final dataset, run it alone (it fully replaces the previous JSON). If
it's explicitly an addendum/supplement to an existing export, run it together with the earlier
file(s) so both are merged into one combined dataset.

## Which Excel columns are used

The converter looks for these columns by name (case-insensitive) in each workbook it's given,
and carries them into the JSON:

`Date`, `Internal Reference Number`, `Report Item No.`, `EOI Reference Number`, `Status`,
`Address`, `Suburb`, `LGA`, `Developer`, `Planning Consultant`, `Architect`,
`Applicant (Raw)`, `Project Type`, `Storeys`, `No. of Dwellings`, `Concurrent Rezoning`,
`Affordable Housing %`, `Affordable Housing Tenure`, `Reason (Full)`, `Notes`.

Two fields have known alternate names across different HDA workbook exports, and the converter
recognises both automatically:

- The HDA objectives/criteria field is recognised as either `Criteria` or `Rules`.
- The advice/reasoning field is recognised as either `Script` or `Minister / Applicant Advice`.

The converter also resolves genuinely duplicated headers within one workbook by keeping the
last occurrence and printing a warning.

`Concurrent Rezoning` has been written with two different vocabularies across workbook versions
(`Concurrent Rezoning` / `None`, and `Yes` / `No` / `Unknown`) — the converter normalises both
into the same `yes` / `no` / `unknown` values, and the site displays "Concurrent Rezoning",
"No Concurrent Rezoning", or "Concurrent Rezoning Unknown" accordingly, without guessing when
a workbook says "Unknown".

`Applicant (Raw)` and `Reason (Full)` are never shown in the main results table — they only
appear inside the project detail panel, where `Applicant (Raw)` is labelled as source/reference
information and `Reason (Full)` sits inside the collapsed "Official HDA record" section,
reproduced in full and unedited.

## Filter logic

- Selecting values **within** one filter category (e.g. two suburbs) is combined with **OR**.
- Selections **across** different filter categories (e.g. a suburb and a project type) are
  combined with **AND**.
- The keyword search is combined with all active filters using **AND**.
- Filter option counts update live to show how many currently-matching projects have each
  remaining option (counts are computed with that option's own category temporarily excluded,
  so you can see how many results adding it would leave you with).
- Blank, null or "None" values are never offered as selectable filter options.

## How blank fields are treated

The converter never invents a value for a blank cell — it stores `null` and leaves it out of
JSON in a way the interface can detect. In the UI:

- Blank fields are hidden entirely in the project detail panel (no empty label is shown).
- Blank fields show a muted dash (—) in the results table where a value would otherwise
  appear, so the table stays readable.
- A project's `Affordable Housing %` / `Affordable Housing Tenure` fields explicitly recorded
  as the text "None" in the workbook are shown as **None** rather than being hidden, since that
  reflects information actually stated in the source record — as opposed to the cell being
  empty, which the interface treats as unknown.
- Storeys ranges (e.g. `4-25`) and blanks are sorted using the first number found, so
  blank Storeys values always sort last regardless of sort direction.

## Deploying to GitHub Pages

1. Push the `hda-database` folder to a GitHub repository (as the repo root, or a subfolder).
2. In the repository settings, open **Pages**, and set the source to the branch/folder
   containing `index.html` (e.g. `main` / `/ (root)`, or `main` / `/hda-database` if it's a
   subfolder).
3. GitHub Pages serves static files directly, including `data/hda-projects.json`, so no
   further configuration is required — the site will work exactly as it does locally.

## Data-quality notes from the source workbooks

The current `data/hda-projects.json` was generated from two workbooks together:
`HDA_Record_of_Briefing_2026-07-23_Database.xlsx` (the main database, 51 rows) and
`27_HDA_Intelligence_Database_2025_Addendum_2026-06-23.xlsx` (an addendum, 138 rows) — 189
project rows in total, with no overlapping EOI Reference Numbers between the two files.

- Status breakdown across the combined dataset: **Recommended** 50, **Not Recommended** 109,
  **Deferred** 29, and 1 row with no status at all (see below).
- One row in the addendum workbook (EOI `250170`) is itself an addendum correction note rather
  than a normal project record — its own `Notes` field states that "the original recommendation
  and remaining project details are not contained in the attached addendum." It has been kept
  exactly as given (not merged into or matched against any other row, since nothing in the data
  says which project it corrects), so it appears in the database with most fields blank and its
  status shown as a neutral grey "Unknown" badge; its `Notes` and `Reason (Full)` content is
  still fully visible in its detail panel.
- `Developer`, `Planning Consultant` and `Architect` are frequently blank across both workbooks
  — this is preserved as-is; the detail panel simply omits those fields rather than showing
  them empty.
- `Storeys` is sometimes blank and sometimes a range (e.g. `4-25`, `15-40`) rather than a single
  number — both are preserved verbatim and sorted using the first number in the value.
- `Affordable Housing %` and `Affordable Housing Tenure` occasionally contain more than one
  value separated by a semicolon (e.g. `3.3%; 10%`, `Perpetuity; 15 years`) where a project has
  more than one affordable housing component. These are shown together in the results table and
  split into individual selectable options in the filter panel.
- `Concurrent Rezoning` uses "Concurrent Rezoning" / "None" wording in the main workbook and
  "Yes" / "No" / "Unknown" wording in the addendum — both are normalised into the same three
  states in the interface (see the columns section above), so filtering behaves consistently
  across data from either workbook.
- The `HDA Criteria` section is built from the workbook's `Criteria`/`Rules` column, which is
  only present in the main workbook — addendum rows have no criteria field, so their detail
  panel shows the standard "no specific criteria recorded" message rather than anything
  invented.
- The advice/reasoning column (`Script` in the main workbook, `Minister / Applicant Advice` in
  the addendum) is reproduced exactly as written and shown in the detail panel directly below
  the "HDA criteria" section, under the heading "HDA advice" — it only appears when the
  workbook has content in that field. In the main workbook this is populated only for
  `Not Recommended` projects; in the addendum it's populated for `Not Recommended` and
  `Deferred` projects, and never for `Recommended` ones.
