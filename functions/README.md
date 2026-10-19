# PickSlip NFL odds importer

The `importNflOdds` Firebase HTTPS function retrieves upcoming NFL event player props from The Odds API and writes them into the Firestore collection `oddsApiNflProps`.

## Safety
- Secret: `ODDS_API_KEY` in Firebase Secret Manager.
- Requests must be POST with a Firebase Auth ID token bearing the trusted custom claim `oddsImporter: true`. No browser user can grant this claim.
- No automatic schedule yet, to avoid unexpected API usage.
- Limited to eight upcoming NFL events per invocation.
- This is a staging data feed; it does **not** alter the existing PickSlip +5 yard import behavior.
- Event props API coverage depends on subscription, event timing, and sportsbook availability.
- Firestore rules must deny client writes to `oddsApiNflProps`; only server Admin SDK writes are intended.

## Deploy
Run in a checked-out copy of this branch:
```sh
cd functions && npm install && cd ..
firebase deploy --only functions:importNflOdds --project pickslip-4e265
```

Before triggering an import, a trusted project administrator must assign the `oddsImporter` custom claim to the appropriate Firebase Auth user via Admin SDK, and refresh that user's ID token. Do not put a service-account credential or API key in the browser. The frontend connection and claim setup are intentionally not deployed yet.
