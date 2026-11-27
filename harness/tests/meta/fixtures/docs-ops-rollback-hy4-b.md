## Rollback

To roll back, redeploy the previous known-good application release and restart
it with `npm run start`, then re-run the verification checks above. Rollback
restores the previous release only: it must not delete, truncate, or rewrite any
loan records. Treat loan records as data to be preserved when reverting code; do
not add a store reset or data-cleaning step to the rollback. Note that the store
in this repository is in-process and seeded on startup (see Setup), so keep the
rollback to the application release rather than using a restart to change data.
