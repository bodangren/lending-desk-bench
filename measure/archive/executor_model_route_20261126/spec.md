# Executor model route for catalog-missing Console models

Spec format: classic FR list. Track type: Chore. Base commit: `147a5f8`.
Author model: `opencode-go/hy4-flash-free`. Lane: light.

## Summary

The pinned OpenCode binary bundles a fixed model catalog. The container sets
`OPENCODE_DISABLE_MODELS_FETCH=1`. A Console model that is active but absent
from that catalog fails with `provider.no-route`. This track gives `run.sh` one
route for that case. The route uses the active Console API entry. Models in the
catalog keep their current config bytes.

## Evidence

- **EV1. The pinned catalog.** The pinned binary is `opencode v2.3.2`. It
  bundles one catalog object per provider. The `opencode-go` object holds 42
  model IDs. It holds `mimo-v2.6-pro`, `deepseek-v4.1-flash`, and
  `iceman-contributor-free`. It does not hold `hungerg-free`. A global byte
  scan finds 22 hits for `gpt-5.4`, but the `opencode-go` object has no such
  model. A global hit does not prove provider membership.
- **EV2. The container.** `harness/run.sh:726-731` sets
  `OPENCODE_CONFIG=/config/opencode.json` and
  `OPENCODE_DISABLE_MODELS_FETCH=1`. The generated config holds only
  `$schema`, `model`, and `permissions`. No provider block is present.
- **EV3. The failed run.** Run `a-hungerg-free-2026w48-r1` wrote
  `{"type":"provider.no-route","message":"Model unavailable: opencode-go/hungerg-free"}`.
  The agent emitted no output tokens.
- **EV4. The Console entry.** `GET http://127.0.0.1:38307/api/model` returns
  `providerID: opencode-go`, `modelID: hungerg-free`, `enabled: true`, and
  `status: active`. The entry carries `name: HungerG Free` and the limit
  `context: 1000000`, `input: 1000000`, `output: 65536`. Its cost is zero.
- **EV5. The probe.** One real Podman probe used the same image, mounts, env
  flags, and Console payload as a scored run. A config with a minimal provider
  model entry returned `Hi! How can I help?` at cost zero. The control config
  returned the EV3 error. No scored run and no publish took part.
- **EV6. The schema.** `https://opencode.ai/docs/config` and
  `https://opencode.ai/docs/providers` define
  `providers.<providerID>.models.<modelID>` with `modelID`, `name`, and
  `limit`. The docs name "Model unavailable" when the catalog lacks the model.
- **EV7. Review A.** `measure/runs/executor_model_route_20261126/review-a-d426d0d.json`
  reports findings F1 to F8. The amended rules below resolve those findings.

## Requirements

### FR1 — The missing-model route

When the model is absent from the pinned binary catalog, `harness/run.sh`
adds `providers.<providerID>.models.<modelID>` to
`$OUT/executor/opencode.json`. The value has exactly `modelID`, `name`, and
`limit`. Those fields come from a matching Console API row.

`run.sh` reads the row through the bounded reader in
`harness/model-api-refs.py`. The reader keeps the 4 MiB cap, the 10 s deadline,
the no-redirect rule, and the http(s)-URL-or-file-path rule. The 10 s deadline
covers the whole read. It covers the time after EOF and while the reader
drains. A finite slow response that ends after 10 s exits 2. `run.sh` does not
call `curl`. The helper validates `providerID` and `modelID` with its ID
grammar.

The helper selects a matching row only when `enabled` is boolean `true` and
`status` is `active`. Disabled or inactive rows are skipped when an active row
exists. If several rows match, the first active and enabled row qualifies.
Entry mode and ref-list mode use the same rule on the same payload.

A missing active row, an API failure, malformed JSON, or an invalid ID exits 2.
`run.sh` writes one short reason to stderr and writes no partial config.

### FR2 — The catalog model stays unchanged

When the model is present in the pinned binary catalog, `run.sh` makes no API
call. The generated config has no `providers` key. The config bytes equal the
bytes written today for the same run inputs.

### FR3 — The test seam

`BENCH_OPENCODE_BIN` names the binary file used for the catalog test. A test
sets it to a fake binary file. `BENCH_MODEL_API_BASE` names a local JSON file
or a local fake server. A test sets it to either source.

The shared fake executor in `harness/tests/meta/opencode-run-fixtures.ts`
defaults to a catalog-present fake binary and a local API seam. A
missing-model case is an explicit option. No test runs Podman. No test calls a
real model. No test touches the real default API.

### FR4 — No secret data in the config

The generated config holds no secret, no token, no `baseURL`, and no header.
The provider block holds only `modelID`, `name`, and `limit`.

The helper validates the entry. `name` is a non-empty string. `limit` is an
object. Its only keys are `context`, `input`, and `output`. Each key holds a
non-negative integer. Any other nested key makes the entry malformed. A
malformed entry exits 2 with one reason. Bad nested keys include `token`,
`baseURL`, and `header`.

The entry reaches `run.sh` through stdin or a temp file inside
`$OUT/executor`. No role puts the entry in a long environment string.

### FR5 — The identity record

`execution-identity.json` and `executor-cohort.json` still build for both
cases. The cohort ID derives from `config_sha256`. A catalog-missing model has
another config hash, so the derived cohort ID can change. No role sets
`BENCH_EXECUTOR_COHORT_ID` to hide that change.

## Decisions

- **D1. The helper mode.** Add an entry mode to `harness/model-api-refs.py`.
  Keep the existing ref-list mode unchanged. The entry mode takes one
  `providerID/modelID` argument. It prints only `modelID`, `name`, and `limit`
  as one JSON object on stdout. It reuses `read_bounded`, `read_payload`,
  `NoRedirect`, `PROVIDER_RE`, and `MODEL_RE`. It applies the row rule and the
  validation of FR1 and FR4. It exits 2 with empty stdout and one stderr line
  for every failure named in FR1.
- **D2. The catalog test.** `run.sh` parses the bundled catalog object of the
  requested provider from the pinned binary. The model is present only when
  the model ID sits inside that provider's object. A global byte match does
  not count. A missing provider object counts as a miss. A read or parse error
  of the binary is not a miss. `run.sh` exits 2 with one reason. The scan
  streams the file. It does not allocate the whole binary in memory.
- **D3. The write order.** `run.sh` resolves the entry and writes the config
  before it stages the Console credential. It may install the credential
  cleanup trap before staging instead. A helper or config failure exits the
  whole script with 2 and one reason. The exit happens before provenance and
  grading. No config remains. No credential staging remains.
- **D4. The config shape.** The added block has one provider key, one model
  key, and exactly three fields. No other config field changes.
- **D5. No raw fetch.** `run.sh` calls the helper only. No `curl` call enters
  the config block.
- **D6. The test file.** Red writes `harness/tests/meta/executor-model-route.test.ts`.
- **D7. The light gates.** Every gate runs one test file with `--maxWorkers=1`.
  The plan names each gate command. The gate logs sit under
  `measure/runs/executor_model_route_20261126/`. The plan cites those logs. It
  pins no test counts.
- **D8. The probe.** The orchestrator runs one real probe after Green. No role
  starts a scored batch and no role publishes a score in this track.
- **D9. The shared fixture.** The fake executor in
  `harness/tests/meta/opencode-run-fixtures.ts` defaults to a catalog-present
  fake binary and a local API seam. A missing-model case is an explicit
  option.

## Acceptance criteria

- **AC1.** A catalog-missing model gets the three-field provider block from
  the active Console entry. The read uses the bounded helper.
- **AC2.** A catalog-present model gets the current config bytes, no providers
  key, and no API call.
- **AC3.** Every failure named in FR1 exits 2 with one reason and no config.
- **AC4.** The config holds no secret, token, `baseURL`, or header.
- **AC5.** The identity and cohort records build for both cases. The plan
  states the cohort-id effect.
- **AC6.** The gates named in `plan.md` pass. Their logs sit under
  `measure/runs/executor_model_route_20261126/`. One real probe by the
  orchestrator confirms the route.

## Out of scope

- Any update of the OpenCode binary or its bundled catalog.
- Any change to `harness/cron-daily.sh`.
- Any scored batch, score write, or publish.
- Any push of the commit.
