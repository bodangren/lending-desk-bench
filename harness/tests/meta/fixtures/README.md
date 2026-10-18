# OpenCode fixtures

The session export uses the shape of `measure/tracks/opencode_executor/evidence/offline-session-export.redacted.json`.
Its synthetic totals differ from the stream totals. Each token field has a distinct, positive value.
The messages contain canaries for the credential tests. The gzip file contains the same JSON bytes.

The stream copies `measure/tracks/opencode_executor/evidence/live2-event-stream.redacted.json`.
The source already redacts the nested subagent session ID. The stream lacks the final `step_finish` event.
The stream provides a cross-check only. The export provides the usage totals.
