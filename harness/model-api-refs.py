#!/usr/bin/env python3
"""Print providerID/modelID refs from the OpenChamber model API.

BENCH_MODEL_API_BASE names the source. An existing regular file supplies the
JSON payload; an http(s) value is a base URL and the helper reads
${base%/}/api/model. An unset or empty value uses http://127.0.0.1:38307.

The helper prints one ref per line in ref-list mode. With one providerID/modelID
argument, it prints one JSON object with modelID, name, and limit. It exits 2
with one short reason on stderr when the source, read, parse, or payload check
fails. It never starts an opencode process, follows a redirect, or prints a
ref before the whole payload is validated.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:38307"
MAX_BYTES = 4 * 1024 * 1024
FETCH_TIMEOUT = 4
FETCH_DEADLINE = 10
PROVIDER_RE = re.compile(r"^[A-Za-z0-9._:@+-]+$")
MODEL_RE = re.compile(r"^[A-Za-z0-9._:@+/~\[\]-]+$")


def fail(reason):
    """Write one stderr line and exit 2 with an empty stdout."""
    text = " ".join(str(reason).split())
    sys.stderr.write(text.encode("utf-8", "backslashreplace").decode("utf-8") + "\n")
    raise SystemExit(2)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Reject a 3xx instead of following it to another payload."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fail("model API redirected the request")


def read_bounded(handle, deadline):
    """Read at most MAX_BYTES bytes before the total deadline.

    A buffered socket read fills the requested size and can block on a slow
    drip, so HTTP responses use read1, which returns after one raw read.
    """
    chunks = []
    total = 0
    reader = getattr(handle, "read1", None) or handle.read
    while True:
        if time.monotonic() >= deadline:
            fail("model API fetch exceeded the time limit")
        chunk = reader(65536)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            fail("model API payload exceeds the size limit")
        chunks.append(chunk)
    return b"".join(chunks)


def decode(raw):
    """Decode payload bytes as UTF-8 or fail closed."""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        fail("model API payload is not valid UTF-8: %s" % exc)


def read_payload(base):
    """Return the JSON payload text from a regular file or an http(s) base."""
    deadline = time.monotonic() + FETCH_DEADLINE
    if os.path.isfile(base):
        try:
            with open(base, "rb") as handle:
                raw = read_bounded(handle, deadline)
        except OSError as exc:
            fail("cannot read model API payload file: %s" % exc)
        return decode(raw)
    try:
        scheme = urllib.parse.urlsplit(base).scheme.lower()
        if scheme not in ("http", "https"):
            fail("model API base must be a file path or an http(s) URL")
        url = base.rstrip("/") + "/api/model"
        opener = urllib.request.build_opener(NoRedirect())
    except SystemExit:
        raise
    except Exception as exc:
        fail("cannot parse model API base %s: %s" % (base, exc))
    try:
        response = opener.open(url, timeout=FETCH_TIMEOUT)
    except Exception as exc:
        fail("cannot read model API at %s: %s" % (url, exc))
    with response:
        try:
            raw = read_bounded(response, deadline)
        except OSError as exc:
            fail("cannot read model API at %s: %s" % (url, exc))
    return decode(raw)


def collect_refs(payload):
    """Validate the whole payload and return the printable refs."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        fail("model API payload has no data list")
    refs = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        provider = entry.get("providerID")
        model = entry.get("modelID")
        if not isinstance(provider, str) or not isinstance(model, str):
            continue
        if entry.get("enabled") is not True or entry.get("status") != "active":
            continue
        for value in (provider, model):
            try:
                value.encode("utf-8")
            except UnicodeEncodeError as exc:
                fail("model API id cannot be printed: %s" % exc)
        if not PROVIDER_RE.fullmatch(provider) or not MODEL_RE.fullmatch(model):
            continue
        refs.append(provider + "/" + model)
    return refs


def parse_entry_ref(ref):
    """Validate one providerID/modelID argument with the existing ID grammar."""
    provider, separator, model = ref.partition("/")
    if not separator or not PROVIDER_RE.fullmatch(provider) or not MODEL_RE.fullmatch(model):
        fail("providerID/modelID argument is invalid")
    return provider, model


def collect_entry(payload, provider, model):
    """Return the three config fields from the matching active API entry."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        fail("model API payload has no data list")
    ref = provider + "/" + model
    for entry in data:
        if not isinstance(entry, dict):
            continue
        if entry.get("providerID") != provider or entry.get("modelID") != model:
            continue
        if entry.get("enabled") is not True:
            fail("model API entry is disabled for " + ref)
        if entry.get("status") != "active":
            fail("model API entry is inactive for " + ref)
        try:
            result = {
                "modelID": entry["modelID"],
                "name": entry["name"],
                "limit": entry["limit"],
            }
            return json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
        except KeyError:
            fail("model API entry is incomplete for " + ref)
        except (TypeError, ValueError, RecursionError) as exc:
            fail("model API entry cannot be printed: %s" % exc)
    fail("no active model API entry for " + ref)


def main():
    if len(sys.argv) > 2:
        fail("expected at most one providerID/modelID argument")
    entry_ref = parse_entry_ref(sys.argv[1]) if len(sys.argv) == 2 else None
    base = os.environ.get("BENCH_MODEL_API_BASE") or DEFAULT_BASE
    raw = read_payload(base)
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        fail("cannot parse model API payload: %s" % exc)
    if entry_ref is not None:
        print(collect_entry(payload, *entry_ref))
        raise SystemExit(0)
    refs = collect_refs(payload)
    try:
        for ref in refs:
            print(ref)
    except UnicodeEncodeError as exc:
        fail("model API ref cannot be printed: %s" % exc)
    raise SystemExit(0)


if __name__ == "__main__":
    main()
