# PickSlip Firebase Functions (development)

Callable function `getNflProps` provides NFL events and event-level player props from The Odds API. The API key is held in Firebase Secret Manager and never returned to the browser.

## Requirements
- Firebase project with Cloud Functions billing enabled (Blaze plan may be required).
- Node.js 20 or 22, Firebase CLI, and authenticated Firebase project access.
- Admin authorization: this initial scaffold checks `admins/{uid}` with `enabled: true`. **Before deployment**, reconcile this with PickSlip's actual admin identity and Firestore rules. Do not grant all signed-in users access.
- The Odds API plan with NFL player props access.

## Setup
From the repository root, after confirming the correct Firebase project:
```bash
npm install -g firebase-tools
firebase login
firebase use --add
cd functions && npm install && cd ..
firebase functions:secrets:set ODDS_API_KEY
firebase deploy --only functions:getNflProps
```
Enter the API key at the CLI prompt; never commit it or paste it into the website source.

## Important
The function is **not deployed** and is **not yet wired into index.html**. It uses callable Firebase Auth plus an additional Firestore admin gate. Event-level odds requests can consume provider credits; caching and quota controls should be added before production. Existing +5 rushing/receiving-yard adjustment is a UI/import mapping concern and should remain unchanged.
