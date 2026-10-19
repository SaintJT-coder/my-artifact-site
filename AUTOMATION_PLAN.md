# PickSlip automatic props — implementation branch

## Current app audit
- `index.html` is a single-page app using Firebase Authentication and Firestore.
- It already has an admin-only **Import NFL props** editor, but it accepts manually typed CSV-like lines.
- Existing NFL import logic adjusts rushing and receiving yard lines by **+5**. Do not silently apply that adjustment to imported sportsbook lines; it must be explicitly reviewed.
- The current app is a pick-slip game with admin-managed picks, not a standard sportsbook ticket tracker. Existing scoring/payout rules must be preserved.

## Implemented
- `odds-adapter.js` normalizes The Odds API event-odds payloads into player, market, line, over/under prices, bookmaker and game metadata.
- Invalid/incomplete markets are skipped. Bookmaker filtering is supported.
- No secret is placed in client code. No existing screens or production behavior are changed.

## Next integration steps
1. Set up an API account and securely configure `ODDS_API_KEY` in a server environment (Firebase Functions or equivalent). Never commit the key.
2. Create a server endpoint that fetches NFL events and event-specific player prop markets from The Odds API; cache results to limit request charges.
3. Add a preview/review interface to PickSlip admin tools, calling the server endpoint, mapping player/team/stat/line and selecting bookmaker. Import only after review.
4. Decide whether imported lines use raw sportsbook thresholds or the app's existing +5 yard adjustment.
5. Integrate an authorized player-stat feed; store stable event/player IDs, handle game finality, stat corrections, pushes and canceled games. Never settle on partial live scores.
6. Test in Firebase emulator or staging before enabling for real users.

## Security
- Do not expose API secrets in `index.html`, `firebase-config.js`, or GitHub.
- Restrict write operations to authenticated administrators via Firestore rules and server-side checks.
- Account syncing of *bets actually placed* requires separate authorization and a provider-supported integration; odds feeds alone cannot infer placed bets.
