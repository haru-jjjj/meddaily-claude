# MedDaily

Personal, mobile-first medical study app: short evidence-based cards across
specialties, generated with Claude, with history, spaced-repetition review,
specialty-balance tracking and multi-part study series synced through Firebase.

## Environment variables (Vercel → Settings → Environment Variables)

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_APP_ID=...
```

Without the `VITE_FIREBASE_*` values the app still works, but history, review
and series are saved on the current device only.

## Firebase setup (once)

MedDaily can share an existing Firebase project (e.g. MediNote's) or use its own.
It only ever touches its own collections: `meddaily_cards` (every card read,
with its recall question and review progress) and `meddaily_series`.

1. Use the project's Web app config (`apiKey`, `authDomain`, `projectId`,
   `appId`) for the variables above. Keep them in Vercel env vars, not in the repo.
2. Authentication → Sign-in method → **Anonymous** must be enabled
   (already on if MediNote uses the same project).
3. Firestore Database → Rules: **add** these two blocks inside the existing
   `match /databases/{database}/documents { ... }` — do not replace the rules
   other apps rely on:

```
    match /meddaily_cards/{docId} {
      allow read, write: if request.auth != null;
    }
    match /meddaily_series/{docId} {
      allow read, write: if request.auth != null;
    }
```

## Run locally

1. `npm install`
2. Put the variables above in `.env.local`
3. `npm run dev` (the image search endpoint in `api/` runs only with `vercel dev`;
   plain `npm run dev` falls back to Wikimedia Commons)
