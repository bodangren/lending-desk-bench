## Rollback

To roll back, redeploy or restart the previous release (`npm run build`
followed by `npm run start`, or re-activate the previous deployment).
Rollback restores the previous release and does not delete loan records:
loan rows are only appended or marked returned via the `/api/loans` `POST`
and `PATCH` endpoints — there is no delete path — so rolling back code
leaves existing loan history intact. (The in-process store itself resets to
seed data on restart; preserve/export any runtime state before restarting
if it must survive the rollback.)
