# Proctor

A self-contained practice-exam bench. Open `index.html` in a browser — no server, no
install, no network call except the Google Fonts stylesheet.

Ships with the CCAO-F question banks already loaded (277 items across two datasets) and takes
further datasets by drag-and-drop.

---

## What it does

**Sit a paper.** Two modes:

- **Exam** — timed, all feedback withheld until you submit, flag anything you want to revisit.
- **Practice** — mark each question as you answer it and read the reasoning before moving on.

Draw from everything, from **the questions you got wrong last time**, or from **questions you
have not yet seen**. Filter by domain and difficulty. A blueprint-weighted draw allocates
questions across domains by their published exam weight rather than sampling evenly.

**Answer feedback.** Every question carries an explanation, a per-option rationale saying why each
distractor is wrong, the exam objective it maps to, and dated source links. In practice mode this
appears the moment you check an answer; in exam mode it waits for the review pass.

**Analysis after the paper.** A scaled score on a 100–1000 dial with the cut score notched in,
then breakdowns by domain, difficulty and objective, weak topic tags, pacing (where the time went
versus where the marks went), and a question-by-question review filtered to what you missed or
flagged. One button turns those misses into a practice session.

**History.** Every sitting is kept: score trend against the pass mark, cumulative per-domain
mastery across all attempts, and how much of the bank you have covered.

Everything lives in the browser's local storage. An interrupted exam resumes where you left it.

---

## Adding your own questions

Drop a file on the library page, or paste the text. JSON, JSONL and CSV all work, and field names
are sniffed on the way in — `question`/`prompt`/`stem`, `answer`/`correct`, `option_a…option_f`
or an `options` array, keys given as letters, indexes or the answer text itself. Rows that lack a
stem, two options or an answer key are skipped and counted rather than silently dropped.

The native shape, which round-trips exactly:

```json
{
  "name": "My exam",
  "config": { "examLength": 60, "timeLimitMinutes": 120, "passPercent": 72,
              "scaleMin": 100, "scaleMax": 1000, "scalePass": 720 },
  "domains": [{ "id": "D1", "name": "Fundamentals", "weight": 40 }],
  "items": [{
    "id": "D1-001",
    "domain": "D1",
    "objective": "State the golden rule",
    "type": "single",
    "difficulty": "easy",
    "stem": "Which statement is correct?",
    "options": [{ "key": "A", "text": "..." }, { "key": "B", "text": "..." }],
    "correct": ["B"],
    "explanation": "Shown after the answer.",
    "rationales": { "A": "Why A is wrong." },
    "sources": [{ "title": "Docs", "url": "https://...", "date": "2026-08-01" }],
    "tags": ["clarity"]
  }]
}
```

`config` is optional. Without a `scaleMin`/`scaleMax`/`scalePass` triple the score is reported as
a plain percentage; with one, the percentage is mapped onto that scale with `passPercent` anchored
exactly on `scalePass` — so a 72% pass mark lands on 720 out of 1000, the way a real scaled score
is built around its cut score.

**Copy as JSON** on any dataset card exports it in this shape, so a bank imported from a loose CSV
can be re-exported clean.

---

## Bundled datasets

| Dataset | Items | Notes |
|---|---|---|
| CCAO-F Core Bank | 210 | Blueprint-weighted, written against the published exam guide. The primary study asset. |
| CCAO-F Community Signal | 67 | Supplementary. 28 items carry a caveat, shown with the answer. |

Both are generated from the CCAO-F build directory, which is not vendored here; the finished packs
in `packs/` are, so the page rebuilds without it. Neither bank is real exam content — the items are
original practice questions written against the published blueprint and public Anthropic
documentation, and the community bank is explicitly the weaker of the two.

---

## Working on it

```
src/10-head.html     title, fonts, the whole stylesheet
src/20-body.html     shell markup, helpers, storage, dataset import and normalisation
src/30-app.html      app state, routing, chrome, the library view
src/40-setup.html    sampling, blueprint weighting, the exam builder
src/50-exam.html     the clock, the runner, grading
src/60-results.html  analysis, the score dial, review, history
src/70-wire.html     event delegation, keyboard, boot
```

```sh
cat src/*.html > template.html && python build.py   # rebuild index.html
node test.js                                        # 19 checks: import, sampling, grading, rendering
```

`build.py` regenerates `packs/*.json` from the CCAO-F build directory when it is present, and
otherwise rebuilds straight from `packs/`. Either way it inlines them into the template at the
`__BUNDLED_PACKS__` placeholder. Two of the 19 checks read those original exports and skip when
they are absent.

The test harness runs every inlined script under a stub DOM, so it catches syntax errors, broken
render paths and grading regressions without a browser.

---

## Keyboard

| | |
|---|---|
| `A`–`F` or `1`–`6` | select an option (toggles, in multiple-response) |
| `→` / `N` | next question |
| `←` / `P` | previous |
| `F` | flag for review |
| `Enter` | check the answer, then move on |
