# PICK_ORACLE: an independent copy of the selection rule of spec.md.
# It reads the same inputs as harness/daily-pick.ts and prints one labeled line.
# The orchestrator compares this line with the DAILY_PICK line (PICK_MATCH).
#
#   python3 -I pick-oracle.py <catalog.json> <served.txt> <go-pricing.json> <runs> <day-dir> <YYYY-MM-DD> [<benchmark.json>]
#
# The 7th argument is the board file of spec D23. With it, the pick follows
# the groups 1, 2, and 3, and the line ends with the group fields. Without it,
# the output stays byte-for-byte as now.
#
# Exit 0 with a pick, exit 3 with no eligible model, exit 1 on a bad input.
import datetime as dt, glob, json, os, re, sys

cat_p, served_p, pricing_p, runs, days, date = sys.argv[1:7]
board_p = sys.argv[7] if len(sys.argv) > 7 else None
cat = json.load(open(cat_p))
live = cat.get("live")
assert isinstance(live, list) and live and all(isinstance(x, str) for x in live), "PICK_ORACLE=fail empty or malformed live list"
pricing = json.load(open(pricing_p))
models, aliases, prov = pricing["models"], pricing["aliases"], pricing["provider"]
served = {line.strip() for line in open(served_p) if line.strip()}
assert served, "PICK_ORACLE=fail empty served list"
day = dt.date.fromisoformat(date)
iso = day.isocalendar()
week = f"{iso[0]}w{iso[1]:02d}"

# The board file of spec D23: the ranked ids and the history ids.
ranked_ids, history_ids = set(), set()
if board_p is not None:
    board = json.load(open(board_p))
    for entry in board.get("models") or []:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str):
            ranked_ids.add(entry["id"])
    for entry in (board.get("history") or {}).get("models") or []:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str):
            history_ids.add(entry["id"])


def group_of(model_id):
    # A model in both lists is group 3. A model in neither list is group 1.
    if model_id in ranked_ids:
        return 3
    if model_id in history_ids:
        return 2
    return 1


def resolve(m):
    # The same order as resolveGoModelId in harness/go-cost.ts.
    if not isinstance(m, str) or not m:
        return None
    if m in models:
        return m
    if m in aliases:
        return aliases[m]
    if "/" in m:
        t = m.rsplit("/", 1)[1]
        if t in models:
            return t
        if t in aliases:
            return aliases[t]
    return None


rundate, today = {}, None
if os.path.isdir(days):
    for p in sorted(glob.glob(os.path.join(days, "*.json"))):
        rec = json.load(open(p))
        if rec["date"] == date:
            today = rec
        for rid in rec.get("run_ids") or []:
            rundate[rid] = max(rundate.get(rid, ""), rec["date"])
if today is not None:
    print(f"PICK_ORACLE date={date} model={today['model']} reason=resume")
    sys.exit(0)

tok = re.compile(r"-(\d{4})w(\d{2})(?:-r\d+)?$")
last, weeks = {}, {}
for name in sorted(os.listdir(runs)):
    p = os.path.join(runs, name, "artifacts", "provenance.json")
    if not os.path.isfile(p):
        continue
    try:
        pv = json.load(open(p))
    except ValueError:
        continue
    ex = pv.get("executor")
    if not isinstance(ex, dict) or ex.get("kind") != "opencode":
        continue
    m = resolve(pv.get("model"))
    if m is None or pv.get("arm") not in ("a", "b") or pv.get("track") not in ("build", "bugfix", "tests", "change"):
        continue
    t = tok.search(name)
    if name in rundate:
        d = rundate[name]
    elif t:
        d = dt.date.fromisocalendar(int(t.group(1)), int(t.group(2)), 7).isoformat()
    else:
        d = "0000-00-00"
    last[m] = max(last.get(m, ""), d)
    if t:
        weeks.setdefault(m, set()).add(f"{t.group(1)}w{t.group(2)}")

# The high-use set of spec D26. The price table holds the field
# `high_usage`. Rule 5 of PLAN.md skips the Muse Spark training models and
# the Flash Vision Exp model.
def is_high_use(model_id):
    spec = models.get(model_id)
    if not isinstance(spec, dict) or spec.get("high_usage") is not True:
        return False
    if model_id.startswith("muse-spark"):
        return False
    return model_id != "deepseek-v4-flash-vision-exp"


cands = [m for m in dict.fromkeys(live) if m in models and f"{prov}/{m}" in served and is_high_use(m)]
elig = [m for m in cands if week not in weeks.get(m, set())]
unt = [m for m in elig if m not in last]


def rpm(m):
    return -models[m]["requests_per_month"]


def pick_within(pool):
    # Rule 4 first, then rule 5, inside one group.
    pool_unt = [x for x in pool if x not in last]
    if pool_unt:
        return min(pool_unt, key=lambda x: (rpm(x), x)), "untested"
    return min(pool, key=lambda x: (last[x], rpm(x), x)), "stalest"


if board_p is None:
    if unt:
        m, reason = min(unt, key=lambda m: (rpm(m), m)), "untested"
    elif elig:
        m, reason = min(elig, key=lambda m: (last[m], rpm(m), m)), "stalest"
    else:
        print(f"PICK_ORACLE date={date} model=none reason=none last_test=none candidates={len(cands)} eligible=0 untested=0")
        sys.exit(3)
    print(f"PICK_ORACLE date={date} model={m} reason={reason} last_test={last.get(m, 'none')} candidates={len(cands)} eligible={len(elig)} untested={len(unt)}")
    sys.exit(0)

# The board groups of spec D23. The groups go in order 1, 2, 3.
groups = {1: [], 2: [], 3: []}
for x in elig:
    groups[group_of(x)].append(x)
m, reason, group = None, "none", 0
for g in (1, 2, 3):
    if groups[g]:
        m, reason = pick_within(groups[g])
        group = g
        break
if m is None:
    print(f"PICK_ORACLE date={date} model=none reason=none last_test=none candidates={len(cands)} eligible=0 untested=0")
    sys.exit(3)
print(f"PICK_ORACLE date={date} model={m} reason={reason} last_test={last.get(m, 'none')} candidates={len(cands)} eligible={len(elig)} untested={len(unt)} group={group} new={'yes' if group in (1, 2) else 'no'}")
