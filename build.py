#!/usr/bin/env python3
"""Build the Proctor exam platform.

Reads the CCAO-F question banks, emits portable `exam-pack` JSON files into
packs/, then inlines them into template.html to produce the self-contained
exam-platform.html.

Run:  python build.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', 'research-ralph-output', 'CCAO-F'))
PACKS = os.path.join(HERE, 'packs')

DOMAINS = [
    ("D1", "Prompting & Task Execution", 14),
    ("D2", "Output Evaluation & Validation", 21),
    ("D3", "Product & Model Selection", 12),
    ("D4", "Workflow Integration & Solution Design", 16),
    ("D5", "Configuration & Knowledge Management", 12),
    ("D6", "Governance, Risk & Responsible Use", 15),
    ("D7", "Troubleshooting & Optimization", 10),
]
DOMAIN_LIST = [{"id": d, "name": n, "weight": w} for d, n, w in DOMAINS]

CONFIG = {
    "examLength": 60,
    "timeLimitMinutes": 120,
    "passPercent": 72,
    "scaleMin": 100,
    "scaleMax": 1000,
    "scalePass": 720,
}


def norm_item(raw):
    """CCAO-F bank item -> exam-pack item."""
    typ = "multi" if raw.get("type") == "multiple_response" else "single"
    item = {
        "id": raw["id"],
        "domain": raw.get("domain_id", ""),
        "objective": raw.get("objective", ""),
        "type": typ,
        "difficulty": raw.get("difficulty", "medium"),
        "scenario": bool(raw.get("scenario_based", False)),
        "stem": raw["stem"],
        "options": [{"key": o["key"], "text": o["text"]} for o in raw["options"]],
        "correct": list(raw["correct"]),
        "explanation": raw.get("explanation", ""),
        "rationales": raw.get("distractor_rationales", {}) or {},
        "sources": [
            {"title": s.get("title", ""), "url": s.get("url", ""),
             "date": s.get("date", ""), "basis": s.get("date_basis", "")}
            for s in raw.get("sources", [])
        ],
        "tags": raw.get("tags", []) or [],
    }
    notes = {}
    if raw.get("known_issue"):
        notes["caveat"] = raw["known_issue"]
    if raw.get("community_signal"):
        notes["signal"] = raw["community_signal"]
    if notes:
        item["notes"] = notes
    return item


def pack(pid, name, blurb, items, weighted=True, caution=None):
    p = {
        "format": "exam-pack",
        "version": 1,
        "id": pid,
        "name": name,
        "vendor": "Anthropic",
        "examCode": "CCAO-F",
        "description": blurb,
        "config": dict(CONFIG, blueprintWeighted=weighted),
        "domains": DOMAIN_LIST,
        "items": items,
    }
    if caution:
        p["caution"] = caution
    return p


def packs_from_disk():
    """Standalone clone: the CCAO-F sources are not vendored, so rebuild the
    page from the packs already generated into packs/."""
    out = []
    for name in sorted(os.listdir(PACKS)):
        if name.endswith('.json'):
            out.append(json.load(open(os.path.join(PACKS, name), encoding='utf-8')))
    if not out:
        sys.exit("No CCAO-F sources at %s and no packs in %s - nothing to build." % (SRC, PACKS))
    out.sort(key=lambda p: -len(p['items']))
    return out


def packs_from_source():
    bank1 = json.load(open(os.path.join(SRC, 'ccao-f-question-bank.json'), encoding='utf-8'))
    bank2 = json.load(open(os.path.join(SRC, 'ccao-f-community-bank.json'), encoding='utf-8'))

    p1 = pack(
        "ccao-f-core",
        "CCAO-F Core Bank",
        "210 blueprint-weighted items written against the published CCAO-F exam guide "
        "and public Anthropic documentation. Item counts match the blueprint weights to "
        "within 0.2 points; all 30 objectives covered.",
        [norm_item(i) for i in bank1["items"]],
        weighted=True,
    )
    p2 = pack(
        "ccao-f-community",
        "CCAO-F Community Signal",
        "67 supplementary items targeting the topics the unofficial ecosystem stresses. "
        "Keyed answers are still grounded in official Anthropic documentation. Deliberately "
        "not blueprint-proportional \u2014 weighted towards D4 and D6 where the core bank was thinnest.",
        [norm_item(i) for i in bank2["items"]],
        weighted=False,
        caution="Supplementary bank. 28 items carry a caveat noting a minor unresolved defect, "
                "shown with the answer. Use the core bank as the primary study asset.",
    )

    os.makedirs(PACKS, exist_ok=True)
    bundled = []
    for p in (p1, p2):
        path = os.path.join(PACKS, p["id"] + ".json")
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(p, f, ensure_ascii=False, separators=(',', ':'))
        print("pack  %-22s %4d items  %6.0f KB" % (p["id"], len(p["items"]), os.path.getsize(path) / 1024))
        bundled.append(p)
    return bundled


def main():
    if os.path.isdir(SRC):
        bundled = packs_from_source()
    else:
        bundled = packs_from_disk()
        print("CCAO-F sources not present - rebuilt from packs/ (%s)" %
              ', '.join(p['id'] for p in bundled))

    tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
    blob = json.dumps(bundled, ensure_ascii=False, separators=(',', ':')).replace('</', r'<\/')
    if '__BUNDLED_PACKS__' not in tpl:
        sys.exit("template.html is missing the __BUNDLED_PACKS__ placeholder")
    out = tpl.replace('__BUNDLED_PACKS__', blob)
    dest = os.path.join(HERE, 'exam-platform.html')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    print("built %s  (%.0f KB, %d items bundled)" % (
        os.path.basename(dest), os.path.getsize(dest) / 1024,
        sum(len(p["items"]) for p in bundled)))


if __name__ == '__main__':
    main()
