## Rollback

To roll back, redeploy or restart the previous release (`npm run build` followed by `npm run start` on the prior artifact) and keep the current environment (`BENCH_NOW`, `BENCH_LATENCY_MS`) unchanged.

Rollback restores the previous release and does not delete loan records. Loan history in the store is preserved; rolling back only changes the running code, never the stored loans.
