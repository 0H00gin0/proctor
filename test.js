/* Headless smoke test for index.html (the built page).
   Runs every inlined script under a minimal DOM stub, then exercises
   import, sampling, grading, results and history rendering.
   Run:  node test.js                                                    */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const HERE = __dirname;
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.ok(scripts.length >= 6, 'expected the app scripts to be inlined, found ' + scripts.length);

/* ---- minimal DOM ---- */
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.innerHTML = ''; this.textContent = ''; this.value = ''; this.className = '';
    this.style = {}; this.firstChild = null; this.files = []; this.checked = false;
    this.open = false; this.attrs = {};
    this.classList = { add() {}, remove() {}, contains() { return false; }, toggle() {} };
  }
  addEventListener() {} removeEventListener() {}
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  appendChild() {} removeChild() {} click() {} select() {} focus() {} scrollIntoView() {}
  closest() { return null; }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
}
const store = new Map();
/* one stable node per selector, so innerHTML written by the app is readable back */
const nodes = new Map();
const nodeFor = sel => { if (!nodes.has(sel)) nodes.set(sel, new El()); return nodes.get(sel); };
const ctx = {
  console,
  document: {
    body: new El('body'),
    querySelector: sel => nodeFor(sel),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: t => new El(t),
    execCommand: () => true
  },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  navigator: {},
  FileReader: class { readAsText() {} },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  requestAnimationFrame: f => f(),
  scrollY: 0, innerWidth: 1280, innerHeight: 900, scrollTo: () => {}, addEventListener: () => {},
  Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
scripts.forEach((s, i) => {
  try { vm.runInContext(s, ctx, { filename: 'script-' + i + '.js' }); }
  catch (e) { console.error('script ' + i + ' failed:', e.message); throw e; }
});

const A = ctx.APP;
let pass = 0;
/* values built inside the vm live in another realm, so their Array prototype
   differs; compare by shape rather than by identity */
function eq(a, b, msg) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg); }
const SRC = path.join(HERE, '..', 'research-ralph-output', 'CCAO-F');
const hasSrc = fs.existsSync(SRC);
let skipped = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

/* these two read the original CCAO-F exports, which a standalone clone will not have */
function tSrc(name, fn) {
  if (!hasSrc) { skipped++; console.log('  skip ' + name + ' (CCAO-F sources not in this checkout)'); return; }
  t(name, fn);
}

console.log('\nProctor smoke test\n');

t('two datasets bundle and boot', () => {
  assert.strictEqual(A.packs.length, 2);
  assert.strictEqual(A.packs[0].items.length, 210);
  assert.strictEqual(A.packs[1].items.length, 67);
  assert.strictEqual(A.view, 'library');
});

t('every bundled item is well formed', () => {
  A.packs.forEach(p => p.items.forEach(it => {
    assert.ok(it.stem && it.stem.length > 5, it.id + ' has no stem');
    assert.ok(it.options.length >= 2, it.id + ' has < 2 options');
    assert.ok(it.correct.length >= 1, it.id + ' has no key');
    const keys = it.options.map(o => o.key);
    it.correct.forEach(k => assert.ok(keys.includes(k), it.id + ' keys ' + k + ' which is not an option'));
    assert.ok(['single', 'multi'].includes(it.type), it.id + ' bad type');
    assert.ok(['easy', 'medium', 'hard'].includes(it.difficulty), it.id + ' bad difficulty');
  }));
});

t('multiple-response items are typed as multi', () => {
  const multi = A.packs[0].items.filter(i => i.type === 'multi');
  assert.strictEqual(multi.length, 42);
  assert.ok(multi.every(i => i.correct.length > 1));
});

t('scaled score is anchored on the cut mark', () => {
  const sc = A.packs[0].config;
  assert.strictEqual(ctx.scaledScore(72, sc), 720);
  assert.strictEqual(ctx.scaledScore(100, sc), 1000);
  assert.strictEqual(ctx.scaledScore(0, sc), 100);
  assert.ok(ctx.scaledScore(71, sc) < 720 && ctx.scaledScore(73, sc) > 720);
  // a pack with no scaling falls back to plain percent
  assert.strictEqual(ctx.scaledScore(64, { scaleMin: 0, scaleMax: 100, scalePass: 70, passPercent: 70 }), 64);
});

t('blueprint-weighted draw tracks the published weights', () => {
  const c = ctx.setupCfg();
  c.count = 60; c.weighted = true; c.source = 'all';
  const drawn = ctx.sampleItems(ctx.pool(c), 60, true);
  assert.strictEqual(drawn.length, 60);
  const by = {};
  drawn.forEach(i => by[i.domain] = (by[i.domain] || 0) + 1);
  // D2 carries 21% of the blueprint, D7 10%
  assert.ok(by.D2 >= 11 && by.D2 <= 14, 'D2 got ' + by.D2);
  assert.ok(by.D7 >= 5 && by.D7 <= 7, 'D7 got ' + by.D7);
  assert.strictEqual(Object.keys(by).length, 7);
});

t('option shuffling keeps the key attached to its text', () => {
  const src = A.packs[0].items.find(i => i.type === 'multi' && Object.keys(i.rationales || {}).length);
  for (let n = 0; n < 40; n++) {
    const m = ctx.materialise(src, true);
    const keyTexts = m.correct.map(k => m.options.find(o => o.key === k).text).sort();
    const origTexts = src.correct.map(k => src.options.find(o => o.key === k).text).sort();
    eq(keyTexts, origTexts);
    // rationales travel with their option
    Object.keys(m.rationales).forEach(k => {
      const text = m.options.find(o => o.key === k).text;
      const origKey = src.options.find(o => o.text === text).key;
      assert.strictEqual(m.rationales[k], src.rationales[origKey]);
    });
    // and the reverse map restores the original letters
    eq(ctx.toOrig(m, m.correct), src.correct.slice().sort());
  }
});

t('a full sitting grades and files a result', () => {
  const c = ctx.setupCfg();
  c.mode = 'exam'; c.count = 20; c.timed = true; c.minutes = 40;
  ctx.startExam();
  const s = A.session;
  assert.strictEqual(s.items.length, 20);
  // answer the first 15 right, get 3 wrong, leave 2 blank
  s.items.forEach((it, i) => {
    if (i < 15) s.answers[i] = it.correct.slice();
    else if (i < 18) {
      const wrong = it.options.map(o => o.key).filter(k => !it.correct.includes(k));
      s.answers[i] = [wrong[0]];
    }
    s.times[i] = 30000;
  });
  s.flags[3] = true;
  s.elapsed = 20 * 30000;
  ctx.finishExam();

  const r = A.result.record;
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.correct, 15);
  assert.strictEqual(r.pct, 75);
  assert.strictEqual(r.scaled, ctx.scaledScore(75, r.scoring));
  assert.ok(r.scaled > 720, 'expected a pass, got ' + r.scaled);
  assert.strictEqual(A.session, null, 'session should be cleared');
  assert.strictEqual(A.history.length, 1);
  assert.strictEqual(A.view, 'results');
  assert.strictEqual(r.results.filter(x => !x.c.length).length, 2, 'two blanks');
});

t('the stored answer letters point back at the original options', () => {
  A.result.record.results.forEach(res => {
    const it = ctx.findItem(res.i);
    assert.ok(it, res.i + ' not found in the library');
    eq(res.k, it.correct.slice().sort(), res.i + ' key drifted');
    res.c.forEach(k => assert.ok(it.options.some(o => o.key === k), res.i + ' chose a letter that does not exist'));
  });
});

t('the page declares a mobile viewport', () => {
  const head = html.slice(0, 800);
  assert.ok(/<meta name="viewport"[^>]*width=device-width/.test(head), 'no width=device-width');
  assert.ok(/initial-scale=1/.test(head), 'no initial-scale');
  assert.ok(/viewport-fit=cover/.test(head), 'no viewport-fit=cover for notched screens');
  assert.ok(html.includes('env(safe-area-inset-bottom'), 'thumb bar ignores the home indicator');
});

let savedResult = null;
t('the runner renders both a rail and a touch shell', () => {
  savedResult = A.result;
  const c = ctx.setupCfg();
  c.mode = 'exam'; c.count = 12; c.timed = true; c.minutes = 30;
  ctx.startExam();
  const out = ctx.viewExam();
  assert.ok(out.includes('class="mobilebar"'), 'no mobile status strip');
  assert.ok(out.includes('class="mobilebottom"'), 'no thumb bar');
  assert.ok(out.includes('class="wrap examwrap"'), 'exam wrap needs the extra bottom padding');
  assert.ok(out.includes('data-act="open-sheet"'), 'no way to reach the answer sheet');
  assert.ok(out.includes('class="rail"'), 'desktop rail should still render');
  // the clock is duplicated, so it must be addressed by attribute, never by id
  assert.strictEqual((out.match(/data-clockval/g) || []).length, 2);
  assert.strictEqual((out.match(/data-prog(?![a-z])/g) || []).length, 2);
  assert.ok(!out.includes('id="clock"'), 'id-based clock would only update one of the two');
});

t('the thumb bar shows one correct forward action per state', () => {
  const s = A.session;
  // exam mode, mid-paper
  s.cur = 0;
  assert.ok(ctx.mobileBar(s, false, false, []).includes('>Next<'));
  // exam mode, last question
  s.cur = s.items.length - 1;
  assert.ok(ctx.mobileBar(s, false, false, []).includes('Submit paper'));
  // practice, nothing picked yet -> check is offered but disabled
  s.cur = 0;
  const unanswered = ctx.mobileBar(s, true, false, []);
  assert.ok(unanswered.includes('Check answer') && unanswered.includes('disabled'));
  // practice, an option picked
  const picked = ctx.mobileBar(s, true, false, ['A']);
  assert.ok(picked.includes('Check answer') && !picked.includes('disabled>Check'));
  // practice, already marked -> move on
  assert.ok(ctx.mobileBar(s, true, true, ['A']).includes('>Next<'));
});

t('the answer sheet drawer carries the whole rail', () => {
  const s = A.session;
  ctx.openSheet();
  const drawer = ctx.$('#modal-host').innerHTML;
  assert.ok(drawer.includes('Answer sheet'));
  assert.strictEqual((drawer.match(/data-act="jump"/g) || []).length, s.items.length);
  assert.ok(drawer.includes('data-act="finish"'), 'must be able to submit from the drawer');
  assert.ok(drawer.includes('data-act="abandon"'));
  assert.ok(drawer.includes('class="legend"'));
  ctx.closeModal();
  // jumping from the drawer closes it
  ctx.openSheet();
  ctx.gotoQ(3);
  assert.strictEqual(ctx.$('#modal-host').innerHTML, '');
  assert.strictEqual(A.session.cur, 3);
  A.session = null;
  A.result = savedResult;          /* hand the graded paper back to the results tests */
});

t('results and history render without throwing', () => {
  const out = ctx.viewResults();
  assert.ok(out.includes('Pass') || out.includes('Below pass'));
  assert.ok(out.includes('By domain') && out.includes('Question review'));
  assert.ok(out.includes('dialfill'), 'score dial missing');
  A.reviewFilter = 'all';
  assert.ok(ctx.viewResults().length > 5000);
  assert.ok(ctx.viewHistory().includes('Cumulative mastery'));
  assert.ok(ctx.viewSetup().includes('Blueprint-weighted'));
  assert.ok(ctx.viewLibrary().includes('CCAO-F Core Bank'));
});

t('a historic attempt reopens from stored ids alone', () => {
  const id = A.history[0].id;
  A.result = null;
  ctx.openAttempt(id);
  assert.ok(A.result && A.result.view === null);
  const E = ctx.analysisEntries(A.result.record, null);
  assert.strictEqual(E.length, 20);
  assert.ok(E.every(e => e.item), 'items should resolve from the library');
  assert.ok(ctx.viewResults().includes('Question review'));
});

t('misses feed a practice session', () => {
  const missed = A.history[0].results.filter(r => !r.ok).map(r => r.i);
  assert.strictEqual(missed.length, 5);
  ctx.startPracticeFrom(missed, 'test');
  assert.strictEqual(A.session.items.length, 5);
  assert.strictEqual(A.session.mode, 'practice');
  assert.strictEqual(A.session.timed, false);
  A.session = null;
});

t('practice feedback renders explanation, rationales and sources', () => {
  const it = A.packs[0].items.find(i => i.sources.length && Object.keys(i.rationales).length);
  const wrong = it.options.map(o => o.key).find(k => !it.correct.includes(k));
  const fb = ctx.feedbackBlock(it, [wrong]);
  assert.ok(fb.includes('Not the key'));
  assert.ok(fb.includes(ctx.esc(it.explanation.slice(0, 40))));
  assert.ok(fb.includes(ctx.esc(it.sources[0].url)));
  assert.ok(ctx.feedbackBlock(it, it.correct.slice()).includes('Correct'));
  assert.ok(ctx.feedbackBlock(it, []).includes('Left blank'));
});

tSrc('CSV import works on the raw CCAO-F export', () => {
  const csv = fs.readFileSync(path.join(SRC, 'ccao-f-question-bank.csv'), 'utf8');
  const p = ctx.packFromRaw(ctx.parseText(csv, 'ccao-f-question-bank.csv'), 'ccao-f-question-bank.csv');
  assert.strictEqual(p.items.length, 210);
  assert.strictEqual(p.items[0].correct[0], 'C');
  assert.strictEqual(p.items.filter(i => i.type === 'multi').length, 42);
  assert.strictEqual(p.domains.length, 7);
});

tSrc('JSONL import works on the full corpus', () => {
  const jsonl = fs.readFileSync(path.join(SRC, 'ccao-f-full-corpus.jsonl'), 'utf8');
  const p = ctx.packFromRaw(ctx.parseText(jsonl, 'corpus.jsonl'), 'ccao-f-full-corpus.jsonl');
  assert.strictEqual(p.items.length, 277);
  assert.strictEqual(p.name, 'ccao f full corpus');
});

t('loose shapes import: bare array, letter columns, index keys', () => {
  const a = ctx.packFromRaw([
    { question: 'What is 2+2?', option_a: 'three', option_b: 'four', answer: 'B', explanation: 'Arithmetic.' },
    { question: 'Pick two', A: 'x', B: 'y', C: 'z', correct: 'A,C', type: 'multiple_response' },
    { prompt: 'Index keyed', choices: ['no', 'yes'], answer: 1 }
  ], 'mixed.json');
  assert.strictEqual(a.items.length, 3);
  eq(a.items[0].correct, ['B']);
  assert.strictEqual(a.items[0].type, 'single');
  eq(a.items[1].correct, ['A', 'C']);
  assert.strictEqual(a.items[1].type, 'multi');
  eq(a.items[2].correct, ['B']);
  assert.strictEqual(a.items[2].options[1].text, 'yes');
  assert.strictEqual(a.config.passPercent, 70, 'unknown packs get a plain 70% mark');
});

t('unusable rows are skipped, not crashed on', () => {
  const p = ctx.packFromRaw([
    { question: 'ok?', option_a: 'a', option_b: 'b', answer: 'A' },
    { question: 'no options' },
    { option_a: 'a', option_b: 'b', answer: 'A' },
    null
  ], 'partial.json');
  assert.strictEqual(p.items.length, 1);
  assert.strictEqual(p._skipped, 3);
  assert.throws(() => ctx.packFromRaw([{ question: 'nothing usable' }], 'x.json'), /No usable questions/);
  assert.throws(() => ctx.packFromRaw({ nope: 1 }, 'x.json'), /No question list/);
});

t('multiple-response grading needs the exact set', () => {
  const it = { correct: ['A', 'C'] };
  assert.ok(ctx.sameSet(['C', 'A'], it.correct));
  assert.ok(!ctx.sameSet(['A'], it.correct));
  assert.ok(!ctx.sameSet(['A', 'B', 'C'], it.correct));
});

t('filters narrow the pool', () => {
  const c = ctx.setupCfg();
  c.source = 'all'; c.diffs = { easy: false, medium: false, hard: true };
  ctx.allDomains().forEach(d => c.domains[d.id] = d.id === 'D2');
  const p = ctx.pool(c);
  assert.ok(p.length > 0 && p.length < 30);
  assert.ok(p.every(i => i.difficulty === 'hard' && i.domain === 'D2'));
  c.diffs = { easy: true, medium: true, hard: true };
  ctx.allDomains().forEach(d => c.domains[d.id] = true);
});

t('turning a dataset off removes it from the pool', () => {
  A.prefs.disabled['ccao-f-community'] = true;
  assert.strictEqual(ctx.enabledPacks().length, 1);
  const c = ctx.setupCfg();
  c.source = 'all';
  assert.strictEqual(ctx.pool(c).length, 210);
  delete A.prefs.disabled['ccao-f-community'];
  assert.strictEqual(ctx.pool(c).length, 277);
});

console.log('\n' + pass + ' checks passed' + (skipped ? ', ' + skipped + ' skipped' : '') +
  (process.exitCode ? ', with failures above' : '') + '\n');
