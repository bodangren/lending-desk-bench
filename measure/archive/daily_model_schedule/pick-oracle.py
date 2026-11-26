# PICK_ORACLE: an independent copy of the selection rule of spec.md.
# It reads the same inputs as harness/daily-pick.ts and prints one labeled line.
# The orchestrator compares this line with the DAILY_PICK line (PICK_MATCH).
#
#   python3 -I pick-oracle.py <catalog.json> <served.txt> <go-pricing.json> <runs> <day-dir> <YYYY-MM-DD> [<benchmark.json>] [<exclude.csv>]
#
# The 7th argument is the board file of spec D23. With it, the line ends with
# the group fields. The 8th argument is the exclude list of spec D26: a
# comma-separated list of ids that stay out of the pick and the order array.
#
# Exit 0 with a pick, exit 3 with no eligible model, exit 1 on a bad input.
import datetime as dt, glob, json, os, re, sys

cat_p, served_p, pricing_p, runs, days, date = sys.argv[1:7]
board_p = sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] else None
excluded = set(sys.argv[8].split(",")) if len(sys.argv) > 8 and sys.argv[8] else set()
cat = json.load(open(cat_p))
live = cat.get("live")
assert isinstance(live, list) and live and all(isinstance(x, str) for x in live), "PICK_ORACLE=fail empty or malformed live list"
pricing = json.load(open(pricing_p))
models, aliases, prov = pricing["models"], pricing["aliases"], pricing["provider"]
# The pick list minimum of spec D26. The pinned table holds it; the default
# is the value of the spec when the field is absent.
pick_min = pricing.get("pick_min_requests_per_month", 10000)
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


# The pick list of spec D26. A model is on the list when `requests_unlimited`
# is true or `requests_per_month` is more than `pick_min_requests_per_month`,
# and the model holds no `superseded_by`. The rule 5 exclusions of PLAN.md do
# not apply to the pick.
def on_list(model_id):
    spec = models.get(model_id)
    if not isinstance(spec, dict):
        return False
    if spec.get("superseded_by"):
        return False
    if spec.get("requests_unlimited") is True:
        return True
    rpm = spec.get("requests_per_month")
    return isinstance(rpm, (int, float)) and not isinstance(rpm, bool) and rpm > pick_min


def page_order(model_id):
    value = models[model_id].get("page_order")
    return value if isinstance(value, int) else None


def list_key(model_id):
    # Unlimited models first, in page_order. Then the counts highest first;
    # equal counts keep the page_order. A model without page_order comes
    # after every model with a page_order. The id in byte order is the last
    # tie-break.
    spec = models[model_id]
    unlimited = 0 if spec.get("requests_unlimited") is True else 1
    rpm = spec.get("requests_per_month")
    rpm = rpm if isinstance(rpm, (int, float)) and not isinstance(rpm, bool) else 0
    order = page_order(model_id)
    return (unlimited, -rpm if unlimited else 0, order is None, order if order is not None else 0, model_id)


def high_use(model_id):
    # The board filter of spec D26 (PM 2026-11-16): the pick candidate set is
    # the OpenCode Go high-use list, the same filter as `batch_models` in
    # harness/export-site-data.py. A missing flag counts as set, so the
    # synthetic tables of the older cases keep their candidates.
    spec = models.get(model_id) or {}
    return spec.get("high_usage") is not False and spec.get("batch") is not False


cands = [m for m in dict.fromkeys(live) if m in models and f"{prov}/{m}" in served and on_list(m) and high_use(m)]
# New of spec D26: not in models[].id of the board. History models count as
# new. The exclude list of D26 stays out of the pick and the order array.
new = cands if board_p is None else [m for m in cands if m not in ranked_ids]
new = [m for m in new if m not in excluded]
elig = [m for m in new if week not in weeks.get(m, set())]
elig.sort(key=list_key)
unt = [m for m in elig if m not in last]

if not elig:
    print(f"PICK_ORACLE date={date} model=none reason=none last_test=none candidates={len(cands)} eligible=0 untested=0")
    sys.exit(3)

m = elig[0]
reason = "untested" if m not in last else "stalest"
if board_p is None:
    print(f"PICK_ORACLE date={date} model={m} reason={reason} last_test={last.get(m, 'none')} candidates={len(cands)} eligible={len(elig)} untested={len(unt)}")
    sys.exit(0)
group = group_of(m)
print(f"PICK_ORACLE date={date} model={m} reason={reason} last_test={last.get(m, 'none')} candidates={len(cands)} eligible={len(elig)} untested={len(unt)} group={group} new={'yes' if group in (1, 2) else 'no'}")
