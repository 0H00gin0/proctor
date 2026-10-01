#!/usr/bin/env python3
"""Build the Proctor exam platform.

Reads whichever question banks are present under research-ralph-output/, emits
portable `exam-pack` JSON files into packs/, then inlines them into
template.html to produce the self-contained index.html (the page you open, and
the GitHub Pages entry point).

Each bank declares its own source directory, blueprint and normaliser, so a bank
whose sources are not vendored simply falls back to the pack already in packs/.

Run:  python build.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.abspath(os.path.join(HERE, '..', 'research-ralph-output'))
PACKS = os.path.join(HERE, 'packs')

# Every exam runs a 120-minute clock and the same scaled-score geometry, 720 on a
# 100-1000 scale (72%). Item counts differ: 60 for the Foundations exams, 63 for
# CCAR-P, which overrides examLength in its bank entry.
CONFIG = {
    "examLength": 60,
    "timeLimitMinutes": 120,
    "passPercent": 72,
    "scaleMin": 100,
    "scaleMax": 1000,
    "scalePass": 720,
}

CCAO_DOMAINS = [
    {"id": "D1", "name": "Prompting & Task Execution", "weight": 14},
    {"id": "D2", "name": "Output Evaluation & Validation", "weight": 21},
    {"id": "D3", "name": "Product & Model Selection", "weight": 12},
    {"id": "D4", "name": "Workflow Integration & Solution Design", "weight": 16},
    {"id": "D5", "name": "Configuration & Knowledge Management", "weight": 12},
    {"id": "D6", "name": "Governance, Risk & Responsible Use", "weight": 15},
    {"id": "D7", "name": "Troubleshooting & Optimization", "weight": 10},
]

# Proctor pools items from every enabled dataset and groups them by domain id, so
# domain and item ids have to be unique ACROSS exams, not just within one. Both
# blueprints number their domains D1..Dn and both banks start at D1-001, so CCAR-F
# is namespaced. CCAO-F keeps its bare ids: they are already in users' saved
# history, and renaming them would orphan it.
CCAR_PREFIX = "CCAR-"

CCAR_DOMAINS = [
    {"id": CCAR_PREFIX + "D1", "name": "Agentic Architecture & Orchestration", "weight": 27},
    {"id": CCAR_PREFIX + "D2", "name": "Tool Design & MCP Integration", "weight": 18},
    {"id": CCAR_PREFIX + "D3", "name": "Claude Code Configuration & Workflows", "weight": 20},
    {"id": CCAR_PREFIX + "D4", "name": "Prompt Engineering & Structured Output", "weight": 20},
    {"id": CCAR_PREFIX + "D5", "name": "Context Management & Reliability", "weight": 15},
]

CCAR_SCENARIOS = {
    1: "Customer Support Resolution Agent",
    2: "Code Generation with Claude Code",
    3: "Multi-Agent Research System",
    4: "Developer Productivity with Claude",
    5: "Claude Code for Continuous Integration",
    6: "Structured Data Extraction",
}


def _base(raw, objective, scenario):
    typ = "multi" if raw.get("type") == "multiple_response" else "single"
    return {
        "id": raw["id"],
        "domain": raw.get("domain_id", ""),
        "objective": objective,
        "type": typ,
        "difficulty": raw.get("difficulty", "medium"),
        "scenario": scenario,
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
        "tags": list(raw.get("tags", []) or []),
    }


def norm_ccao(raw):
    """CCAO-F bank item -> exam-pack item."""
    item = _base(raw, raw.get("objective", ""), bool(raw.get("scenario_based", False)))
    notes = {}
    if raw.get("known_issue"):
        notes["caveat"] = raw["known_issue"]
    if raw.get("community_signal"):
        notes["signal"] = raw["community_signal"]
    if notes:
        item["notes"] = notes
    return item


def norm_ccar(raw):
    """CCAR-F bank item -> exam-pack item.

    The objective is the guide's task statement, so Proctor's per-objective
    breakdown maps straight onto the published blueprint. Every CCAR-F item is
    framed in one of the six exam scenarios; that dimension rides along as a tag
    so it shows up in weak-topic analysis.
    """
    objective = ("%s %s" % (raw.get("task_statement_id", ""), raw.get("task_statement", ""))).strip()
    item = _base(raw, objective, True)
    item["id"] = CCAR_PREFIX + item["id"]
    item["domain"] = CCAR_PREFIX + item["domain"]
    sid = raw.get("scenario_id")
    if sid in CCAR_SCENARIOS:
        item["tags"] = ["scenario: " + CCAR_SCENARIOS[sid]] + item["tags"]
    return item


# CCAR-P gets its own prefix: its domains D1..D7 would otherwise collide with both
# CCAO-F's bare ids and, under a shared "CCAR-" prefix, with CCAR-F's D1..D5.
CCARP_PREFIX = "CCARP-"

CCARP_DOMAINS = [
    {"id": CCARP_PREFIX + "D1", "name": "Solution Design & Architecture", "weight": 17},
    {"id": CCARP_PREFIX + "D2", "name": "Claude Models, Prompting & Context Engineering", "weight": 13},
    {"id": CCARP_PREFIX + "D3", "name": "Integration", "weight": 19},
    {"id": CCARP_PREFIX + "D4", "name": "Evaluation, Testing & Optimization", "weight": 16},
    {"id": CCARP_PREFIX + "D5", "name": "Governance, Safety & Risk Management", "weight": 14},
    {"id": CCARP_PREFIX + "D6", "name": "Stakeholder Communication & Lifecycle Management", "weight": 14},
    {"id": CCARP_PREFIX + "D7", "name": "Developer Productivity & Operational Enablement", "weight": 7},
]


def norm_ccarp(raw):
    """CCAR-P bank item -> exam-pack item.

    The guide has no scenario bank; each item is set in one of the six industries
    the guide names instead, and that rides along as a tag like CCAR-F's scenario.
    """
    objective = ("%s %s" % (raw.get("task_statement_id", ""), raw.get("task_statement", ""))).strip()
    item = _base(raw, objective, True)
    item["id"] = CCARP_PREFIX + item["id"]
    item["domain"] = CCARP_PREFIX + item["domain"]
    if raw.get("industry"):
        item["tags"] = ["industry: " + raw["industry"]] + item["tags"]
    return item


BANKS = [
    {
        "id": "ccar-p-core",
        "name": "CCAR-P Core Bank",
        "exam_code": "CCAR-P",
        "src": os.path.join(OUTPUT, "CCAR-P"),
        "bank_file": "ccar-p-question-bank.json",
        "domains": CCARP_DOMAINS,
        "norm": norm_ccarp,
        "weighted": True,
        "config": {"examLength": 63},
        "description": (
            "210 blueprint-weighted items for Claude Certified Architect - Professional, written "
            "against the official Exam Guide v1.0, the Partner Academy prep-course objectives and "
            "current Anthropic documentation. Every item is tagged to a verbatim guide objective and "
            "set in one of the six industries the guide names."
        ),
    },
    {
        "id": "ccar-f-core",
        "name": "CCAR-F Core Bank",
        "exam_code": "CCAR-F",
        "src": os.path.join(OUTPUT, "CCAR-F"),
        "bank_file": "ccar-f-question-bank.json",
        "domains": CCAR_DOMAINS,
        "norm": norm_ccar,
        "weighted": True,
        "description": (
            "210 blueprint-weighted items for Claude Certified Architect - Foundations, written "
            "against the official Exam Guide v1.0 and current Anthropic documentation. Every item is "
            "framed in one of the six published exam scenarios and tagged to a verbatim task statement."
        ),
    },
    {
        "id": "ccao-f-core",
        "name": "CCAO-F Core Bank",
        "exam_code": "CCAO-F",
        "src": os.path.join(OUTPUT, "CCAO-F"),
        "bank_file": "ccao-f-question-bank.json",
        "domains": CCAO_DOMAINS,
        "norm": norm_ccao,
        "weighted": True,
        "description": (
            "210 blueprint-weighted items written against the published CCAO-F exam guide and public "
            "Anthropic documentation. Item counts match the blueprint weights to within 0.2 points; "
            "all 30 objectives covered."
        ),
    },
    {
        "id": "ccao-f-community",
        "name": "CCAO-F Community Signal",
        "exam_code": "CCAO-F",
        "src": os.path.join(OUTPUT, "CCAO-F"),
        "bank_file": "ccao-f-community-bank.json",
        "domains": CCAO_DOMAINS,
        "norm": norm_ccao,
        "weighted": False,
        "description": (
            "67 supplementary items targeting the topics the unofficial ecosystem stresses. Keyed "
            "answers are still grounded in official Anthropic documentation. Deliberately not "
            "blueprint-proportional — weighted towards D4 and D6 where the core bank was thinnest."
        ),
        "caution": (
            "Supplementary bank. 28 items carry a caveat noting a minor unresolved defect, shown with "
            "the answer. Use the core bank as the primary study asset."
        ),
    },
]


def build_pack(spec, items):
    p = {
        "format": "exam-pack",
        "version": 1,
        "id": spec["id"],
        "name": spec["name"],
        "vendor": "Anthropic",
        "examCode": spec["exam_code"],
        "description": spec["description"],
        "config": dict(CONFIG, blueprintWeighted=spec["weighted"], **spec.get("config", {})),
        "domains": spec["domains"],
        "items": items,
    }
    if spec.get("caution"):
        p["caution"] = spec["caution"]
    return p


def main():
    os.makedirs(PACKS, exist_ok=True)
    bundled, rebuilt, reused, missing = [], [], [], []

    for spec in BANKS:
        path = os.path.join(spec["src"], spec["bank_file"])
        pack_path = os.path.join(PACKS, spec["id"] + ".json")
        if os.path.exists(path):
            bank = json.load(open(path, encoding='utf-8'))
            pack = build_pack(spec, [spec["norm"](i) for i in bank["items"]])
            with open(pack_path, 'w', encoding='utf-8') as f:
                json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
            rebuilt.append(spec["id"])
        elif os.path.exists(pack_path):
            pack = json.load(open(pack_path, encoding='utf-8'))
            reused.append(spec["id"])
        else:
            missing.append(spec["id"])
            continue
        print("pack  %-22s %4d items  %6.0f KB" % (
            pack["id"], len(pack["items"]), os.path.getsize(pack_path) / 1024))
        bundled.append(pack)

    if not bundled:
        sys.exit("No bank sources and no packs in %s - nothing to build." % PACKS)
    if reused:
        print("      rebuilt from source: %s" % (', '.join(rebuilt) or 'none'))
        print("      reused existing pack (sources not vendored): %s" % ', '.join(reused))
    if missing:
        print("      skipped, no source and no pack: %s" % ', '.join(missing))

    bundled.sort(key=lambda p: (p["examCode"], -len(p["items"])))

    tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
    blob = json.dumps(bundled, ensure_ascii=False, separators=(',', ':')).replace('</', r'<\/')
    if '__BUNDLED_PACKS__' not in tpl:
        sys.exit("template.html is missing the __BUNDLED_PACKS__ placeholder")
    out = tpl.replace('__BUNDLED_PACKS__', blob)
    dest = os.path.join(HERE, 'index.html')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    print("built %s  (%.0f KB, %d items across %d packs)" % (
        os.path.basename(dest), os.path.getsize(dest) / 1024,
        sum(len(p["items"]) for p in bundled), len(bundled)))


if __name__ == '__main__':
    main()
