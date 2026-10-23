# NFL/NBA timing and results

## What runs independently

The public board uses `functions/lifecycle.js` to hide NFL/NBA player and team picks when the clock reaches `commenceTime - 10 minutes`. The deadline is exclusive: a pick is rejected at the exact cutoff. Selected but unsubmitted picks are rechecked on clicks, copying, snapshots, timer boundaries, visibility changes, and submission. Existing slip records are retained. Slips display LIVE with a pulsing red dot at the scheduled start, or when the provider confirms live status. Reduced-motion preferences disable the animation. Confirmed postponements/suspensions suppress LIVE; final games awaiting complete stats show “Awaiting final stats.” Browser rendering depends on the device clock and timer scheduling; the database's `request.time` enforces admission independently of both.

Firestore checks the server-owned numeric `lockAtMs` and current pick status, line, and team multiplier. Public users can only append one validated slip, not replace history to insert late picks. The existing trusted administrator can restore their own slip backup. Other collection permissions are copied from the production rules retrieved October 23, 2026. This change does not redesign the application's existing client-calculated play-money wallet or payout rules.

`syncSportsSchedules` polls The Odds API's NFL and NBA events every 15 minutes using the existing `ODDS_API_KEY`. It updates only exact matching provider event IDs. It preserves lines, scores, final picks, and result-mapped schedules. Provider errors and absent events never trigger grading or voids. This schedule refresh has an ongoing API/request cost; actual admission always uses the most recently stored schedule.

Both NFL and NBA importers now write `lockAtMs`. The NBA importer source was recovered from its deployed October 20 function because it was missing from main. Only those importers and the new schedule function are targeted in the timing deployment; unrelated push, reminder, CFB, and winning-slip functions must not be deleted.

## Unknown schedules

NFL/NBA picks without an explicit, valid UTC start time are unavailable. Never infer their games from names, opponents, week numbers, or dates. The admin player/team editors have a verified ISO start field. Save a timestamp including `Z` or an explicit UTC offset to set both the start and deadline. Blank schedules remain unavailable.

`scripts/backfill-locks.cjs` derives deadlines only from existing explicit schedules, with update-time preconditions to protect concurrent edits. It defaults to a dry run. It accepts `FIREBASE_ACCESS_TOKEN` (short-lived Google OAuth, never committed) and optional `GCLOUD_PROJECT`. Run with `--apply` only after inspecting the preview. The October 23 migration updated 445 scheduled picks; 843 NFL/NBA picks lacked times and were left unchanged. No slips or results were changed.

## Results worker: separate, disabled until configured

`functions-results/` is an isolated Firebase codebase deployed using `firebase.results.json`. It is not part of the timing function deployment, so missing result credentials cannot block the existing importers.

The worker uses SportsDataIO NBA/NFL box scores. It requires exact administrator-verified IDs, matching home/away teams, `Final`/`F/OT` status, `IsClosed === true`, two identical observations at least two minutes apart, numeric non-null data, and confirmed participation (`Games === 1` for NBA, `Played === 1` for NFL). Missing stats, missing/duplicate players, unknown markets/statuses, API errors, and changed game IDs all hold for review. Neither missing rows nor DNPs become zero or automatic refunds. Do not use trial/scrambled/replay feeds for settlement.

Supported player stats are listed explicitly in `functions-results/settlement.js`; unsupported names hold. Team mappings explicitly specify moneyline, spread or total and the A-side orientation. Spread/total exact ties use the existing `result: "void"` push/refund contract. Player exact ties are handled by the unchanged slip payout evaluator. Lines and multipliers are never rewritten.

### Credentials and activation

1. Obtain a production, unscrambled SportsDataIO subscription covering NBA and NFL live/final box scores and verify representative responses against the adapter. No results key was configured during this change; only `ODDS_API_KEY` existed.
2. Store the key with `firebase functions:secrets:set SPORTSDATAIO_KEY --project pickslip-4e265`. Never put it in the browser, repository, GitHub Pages, or a chat message.
3. Configure these booleans in the ignored `functions-results/.env.pickslip-4e265` file: `SPORTS_RESULTS_ENABLED=true` and `SPORTS_RESULTS_REAL_DATA=true`. Keep disabled until mappings and feed entitlement are verified.
4. Install the results dependencies with `npm ci --prefix functions-results` and deploy only this codebase: `firebase deploy --config firebase.results.json --only functions:sports-results --project pickslip-4e265`.
5. Create verified game mappings and link picks as below; inspect initial holds/audit decisions before broad activation. Both boolean gates must be true for polling. Polling occurs every minute only within each mapping's window.

### Mapping schema

An administrator creates `sportsGames/<gameKey>`:

```json
{
  "provider": "sportsdataio",
  "verified": true,
  "enabled": true,
  "league": "NBA",
  "providerGameId": 12345,
  "homeTeam": "BOS",
  "awayTeam": "NY",
  "pollFrom": 1793556000000,
  "monitorUntil": 1794247200000
}
```

These example IDs/times are illustrative, not production mappings. NBA uses the provider's `GameID`; the NFL BoxScore endpoint uses `ScoreID`. An Odds API `eventId` and an ESPN `espnId` are different namespaces and must never be reused as SportsDataIO IDs. Verify the matchup, season, scheduled UTC date, player ID/team, and accepted market/line before linking. A provider change to a new game ID requires explicit remapping; no name matching is performed.

Each `players/<pickId>` links with:

```json
{
  "sportsMapping": {
    "provider": "sportsdataio",
    "gameKey": "<gameKey>",
    "gameId": 12345,
    "playerId": 99,
    "team": "BOS"
  }
}
```

For team picks omit `playerId`/`team` and set `market` to `moneyline`, `spread`, or `total`. Moneyline/spread also require `aTeam` matching the actual accepted A-side team; spread requires numeric `line` representing the A-side handicap. Total requires `aSide: "over"` and numeric `line`. Confirm it matches the pick's existing A/B labels; never infer it or alter the accepted bet to make a mapping fit.

Use bounded polling windows spanning the game and at least seven days afterward. The worker extends monitoring when the same game is rescheduled, and to at least seven days after the first observed final. Review `lastError`, `reviewReason`, and `sportsSettlementAudit`. Games with more than 200 linked picks hold rather than exceed one atomic transaction's write limit.

### Corrections and voids

Initial confirmed results are applied transactionally with an idempotent fingerprint and audit record. A repeated result does nothing. Because existing balances are computed from shared pick records, changing a paid result can debit winnings users already spent. A changed final therefore writes `proposedSettlement`, `proposedFingerprint`, and `reviewReason`, leaving the paid result intact. Review and apply through the existing admin final-stat/result controls only after assessing affected slips/balances. Manual finals and manual voids are not overwritten.

Canceled, postponed, suspended, DNP and incomplete-data cases remain pending for administrator review; no cancellation-delay or DNP refund policy is invented. Use the existing Void controls when the existing house rules authorize a refund. Restore a mistakenly deleted pick or review it explicitly: a missing pick now stays pending instead of silently refunding.

## Validation and deployments

- `npm test`: app startup/rendering with mocked Firebase, payout regressions, exact cutoff boundaries, strict feed validation, NFL/NBA stats, market pushes, worker stability/retries, provider outages, rescheduling, and correction audit behavior.
- `npm run check`: parse every JavaScript file and HTML inline script, including existing preview and trade-lab modules.
- `node scripts/test-rules.cjs`: 23 non-mutating Firebase Rules API scenarios using mocked document lookups. Supply `FIREBASE_RULES_ACCESS_TOKEN`; there are no Firestore writes in this test suite.
- GitHub Actions runs syntax and unit tests on pushes/PRs. Rules API tests require an authorized temporary token and are not silently skipped as passing in CI.
- Timing deployment: `firebase deploy --only firestore:rules,functions:importNflOdds,functions:importNbaOdds,functions:syncSportsSchedules --project pickslip-4e265`.
- GitHub Pages serves the root frontend. The release marker and script query version are bumped so the existing app update prompt can detect the release.

Never deploy all default-codebase functions indiscriminately from this repository: production contains reminder/push/CFB functions whose source remains outside this checkout. Always use the exact named targets above. Keep a copy of the previous ruleset and Git commit for rollback; roll back frontend/functions and rules together if reversing the lock feature.

Provider references: [NBA API](https://sportsdata.io/developers/api-documentation/nba), [NFL API](https://sportsdata.io/developers/api-documentation/nfl), [NBA schema](https://sportsdata.io/developers/data-dictionary/nba), [NFL schema](https://sportsdata.io/developers/data-dictionary/nfl), [game status process](https://sportsdata.io/help/process-guide-game-status). Live provider integration remains unverified until the production key is available; fixture tests do not replace that verification.
