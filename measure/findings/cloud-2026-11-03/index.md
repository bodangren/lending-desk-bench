# Cloud pilot reports: 2026-11-03

PM 2026-11-03: light lane

Date: 2026-11-03  
Sender: Cloud pilot tasks through the PM orchestrator.

## Sources

| File | Branch | Commit | Base commit | Blob | SHA-256 |
|---|---|---|---|---|---|
| `lending-tests.md` | `origin/pilot/cloud-lending-tests` | `fb4020d246d7dc88ed746428ee5c2c6ad3c26c5f` | `c613bc8` | `560adb0f762833a1071aa31c311c93bddbf8d55b` | `5d3155c5fd3ed20943cae31e7c5ea38a86a3231a537dacd4e03f08da47018044` |
| `lending-shellcheck.md` | `origin/pilot/cloud-lending-shellcheck` | `f6044b3f8028c51d7f122ee1e80ff4ecb6d29278` | `c613bc8` | `86431f7b2e5302460a2ed1f98f5ffb497b56708b` | `4c98593248c4dcede75698860ade71bfcfc0fc4440d7917b312a8bac53c07ef8` |
| `lending-docs-drift.md` | `origin/pilot/cloud-lending-docs-drift` | `159fa4965cbe8f8df5cd21500f8c35ff95a7d095` | `c613bc8` | `f8493e223183523fbc1de67eb40ed6b7b1617077` | `96f31108c497eb5d01ebad114ca580b98a290736d80de80ec6322fc45cbd8827` |

## Orchestrator triage

- **Shellcheck:** Take SC2318 at `harness/run.sh:106` and `cd ... || exit 1` in `harness/cron-daily.sh` and `harness/grade.sh`. Any edit to `harness/run.sh` or `harness/grade.sh` changes `runner_sha256` (`harness/provenance.ts:51-96`) and makes every trusted score stale. The fix needs its own track. Wait for Daniel's removal decision on the four old rerun scripts with fixed home paths: `harness/arm-a-reruns.sh`, `harness/rerun-hy3-retries.sh`, `harness/rerun-missing.sh`, and `harness/rerun-suite2-finalize.sh`.
- **Docs drift:** Take M1 to M6, M8 to M11, and U9. Take no action on M7 or the other U items. The pages under `docs/` are public, so send the text to the PM before a change.
- **Tests:** Take the `runs/` test-order dependency (`harness/tests/meta/executor-attestation.test.ts:336` and `:374`) and check the 14 `npm audit` findings. The other 42 failures need host state that Git does not hold, so they need no code fix.
- **Status:** Recorded; no fix started. A Measure track will receive these items later.
