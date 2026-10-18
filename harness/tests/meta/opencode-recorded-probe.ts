import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attestCurrentExecutor } from "../../executor-attestation";
import { assessScoreFreshness } from "../../score-freshness";

const artifacts = process.argv[2];
const record = JSON.parse(readFileSync(resolve(artifacts,"provenance.json"),"utf8"));
console.log(JSON.stringify({
  attestation:attestCurrentExecutor({record,frozen_cohort:record.executor_cohort,artifacts}),
  freshness:assessScoreFreshness(resolve(artifacts,"score.json")),
}));
