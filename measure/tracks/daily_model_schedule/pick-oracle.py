# PICK_ORACLE: an independent copy of the selection rule of spec.md.
# It reads the same inputs as harness/daily-pick.ts and prints one labeled line.
# The orchestrator compares this line with the DAILY_PICK line (PICK_MATCH).
#
#   python3 -I pick-oracle.py <catalog.json> <served.txt> <go-pricing.json> <runs> <day-dir> <YYYY-MM-DD>
#
# Exit 0 with a pick, exit 3 with no eligible model, exit 1 on a bad input.
import datetime as dt, glob, json, os, re, sys

cat_p, served_p, pricing_p, runs, days, date = sys.argv[1:7]
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

cands = [m for m in dict.fromkeys(live) if m in models and f"{prov}/{m}" in served]
elig = [m for m in cands if week not in weeks.get(m, set())]
unt = [m for m in elig if m not in last]


def rpm(m):
    return -models[m]["requests_per_month"]


if unt:
    m, reason = min(unt, key=lambda m: (rpm(m), m)), "untested"
elif elig:
    m, reason = min(elig, key=lambda m: (last[m], rpm(m), m)), "stalest"
else:
    print(f"PICK_ORACLE date={date} model=none reason=none last_test=none candidates={len(cands)} eligible=0 untested=0")
    sys.exit(3)
print(f"PICK_ORACLE date={date} model={m} reason={reason} last_test={last.get(m, 'none')} candidates={len(cands)} eligible={len(elig)} untested={len(unt)}")
