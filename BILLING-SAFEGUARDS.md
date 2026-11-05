# Restoration gate

Do not restore paid billing merely to deploy this change. The notification
function's deployed source must be recovered and reviewed first.

The results worker now avoids player writes when semantic state is unchanged.
`lastSportsSync` on players therefore means last meaningful update; the game
record's `lastSuccess` remains the poll heartbeat. This reduces downstream
Firestore update trigger fan-out without changing settlement decisions.

Before restoration:

1. Recover `notifyWinningSlips` and identify its exact trigger and retry policy.
   Require an early exit for changes unrelated to settlement, bounded queries,
   no whole-database reads per player update, idempotent notification delivery,
   and explicit concurrency/instance/retry limits. Never deploy a stub in its place.
2. Deploy only `syncFreeSportsResults` from its separate existing codebase after
   reconciling the deployed source. Do not deploy the root functions directory
   wholesale: notification and reminder exports are absent from that source.
3. Verify unchanged polling creates zero player writes; a new result creates
   one semantic update; corrections remain review-only. Review delayed events
   before re-enabling notification delivery.
4. Observe aggregate read/write counts, execution failures and memory errors
   during a bounded canary. Set billing alerts with an owner-chosen budget and
   operational alerts for read spikes and function failures. Budget alerts are
   delayed notifications, not spending caps.
5. Replace full-collection browser listeners with bounded, view-specific queries
   and paginated history/leaderboards in a separate tested change. Preserve old
   slip references and settlement data; do not truncate collections to save cost.

This patch alone does not repair or contain an unknown notification handler,
impose a hard spending cap, or guarantee free operation.
