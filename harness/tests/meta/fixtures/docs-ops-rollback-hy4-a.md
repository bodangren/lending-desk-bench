## Rollback

Restore the previous release and serve it with `npm run start`. A rollback
restores the previous release only: it **does not delete loan records**. There is
no data migration, truncation, or destructive step in a rollback. The store is
in-process and seeded when a server process starts, so a loan record is never
removed by the act of rolling back the application release.
