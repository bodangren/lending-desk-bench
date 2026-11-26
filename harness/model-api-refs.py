#!/usr/bin/env python3
"""Print providerID/modelID refs from the OpenChamber model API.

BENCH_MODEL_API_BASE names the source. An existing regular file supplies the
JSON payload; every other value is a base URL and the helper reads
${base%/}/api/model. An unset or empty value uses http://127.0.0.1:38307.

The helper prints one ref per line and nothing else on stdout. It exits 2 with
one short reason on stderr when the read, the parse, or the payload fails. It
never starts an opencode process.
"""

import json
import os
import sys
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:38307"


def fail(reason):
    """Write one stderr line and exit 2 with an empty stdout."""
    sys.stderr.write(" ".join(str(reason).split()) + "\n")
    raise SystemExit(2)


def read_payload(base):
    """Return the JSON payload text from a local file or the API URL."""
    if os.path.isfile(base):
        try:
            with open(base, "r", encoding="utf-8") as handle:
                return handle.read()
        except OSError as exc:
            fail("cannot read model API payload file: %s" % exc)
    url = base.rstrip("/") + "/api/model"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.read().decode("utf-8")
    except Exception as exc:
        fail("cannot read model API at %s: %s" % (url, exc))


def main():
    base = os.environ.get("BENCH_MODEL_API_BASE") or DEFAULT_BASE
    raw = read_payload(base)
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        fail("cannot parse model API payload: %s" % exc)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        fail("model API payload has no data list")
    for entry in data:
        if not isinstance(entry, dict):
            continue
        provider = entry.get("providerID")
        model = entry.get("modelID")
        if not isinstance(provider, str) or not isinstance(model, str):
            continue
        if entry.get("enabled") is not True or entry.get("status") != "active":
            continue
        print(provider + "/" + model)
    raise SystemExit(0)


if __name__ == "__main__":
    main()
