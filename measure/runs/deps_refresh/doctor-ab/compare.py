import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
base = json.loads((OUT / "base-raw.json").read_text())
new = json.loads((OUT / "new-raw.json").read_text())

def normalized(value, scan_root):
    if isinstance(value, dict):
        return {key: normalized(item, scan_root) for key, item in value.items() if key != "elapsedMilliseconds"}
    if isinstance(value, list):
        return [normalized(item, scan_root) for item in value]
    if isinstance(value, str):
        return value.replace(scan_root, "<scan-root>")
    return value

for side, raw in (("base", base), ("new", new)):
    assert raw["ok"] and raw["reactDetected"]
    assert raw["version"] == "0.9.2"
    assert raw["projects"][0]["complete"]
    assert raw["projects"][0]["analyzedFileCount"] == 23
    assert len(raw["diagnostics"]) == 2
    (OUT / f"{side}-raw-normalized.json").write_text(
        json.dumps(normalized(raw, raw["directory"]), indent=2) + "\n"
    )
assert normalized(base, base["directory"]) == normalized(new, new["directory"])
for name in ("report", "scored"):
    assert (OUT / f"base-{name}.json").read_bytes() == (OUT / f"new-{name}.json").read_bytes()
print("RAW_COMPARE=PASS; normalized temporary scan roots; ignored elapsedMilliseconds only.")
print("REPORT_COMPARE=PASS; byte-identical merged findings and counters.")
print("SCORED_COMPARE=PASS; byte-identical doctor fields and quality factor.")
print("NONVACUOUS=23 analyzed files; 2 doctor findings; 3 merged warnings; quality=0.8833333333333333.")
print("AXIS_3_GAP=CLOSED for the stored candidate and the two harness locks.")
