# Orthos Systems Firestore Seeder

This package seeds 20 historical days for:

`jiteeghaghadropship@gmail.com`

It matches the current input fields in `orthos_dashboard_v2.html`:

- Exercises: `ex1` through `ex5`
- Supplements: `supp1_Morning`, `supp2_Evening`, `supp3_Morning`
- Daily reflection: `reflectionText`
- Day state: `practiceComplete`, `moduleRead`, `dayFullyComplete`,
  `exercisesComplete`, `supplementsComplete`, `missed`
- Drift log: `temporal`, `content`, `constraint`, `valence`, `custom`
- Stored AI response: `aiResponse`
- Profile state: `programStartDate`, `programDay`, and three streak counters

The seeder also deletes the legacy `posture_scores` subcollection during reset.
It does not create posture-score records.

## 1. Create/download a Firebase service account

In Firebase Console:

Project settings → Service accounts → Generate new private key.

Do not commit that JSON key to GitHub.

## 2. Install

```bash
npm install
```

## 3. Point Firebase Admin to the key

macOS/Linux:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
```

Windows PowerShell:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\absolute\path\service-account.json"
```

## 4. Validate without changing Firestore

```bash
npm run validate
```

The dry run still connects to Firebase Authentication and Firestore to locate
the account and count documents, but it does not delete or write anything.

## 5. Seed

First clear the user's data as planned, or allow the script to do it. Then run:

```bash
npm run seed
```

The `--reset` requirement is intentional. The script refuses to merge the seed
with existing history.

## Seed outcome

- User profile set to Day 21
- 20 daily-completion documents
- 20 exercise documents
- 20 supplement documents
- At least one drift entry for every day
- Explicit historical Firestore timestamps
- No posture-score records

## Review note

The dashboard source still contains an obsolete read of
`users/{uid}/posture_scores/{TODAY}` and legacy state fields. The seeder removes
that collection, but the obsolete read should also be removed from
`orthos_dashboard_v2.html` in a separate code change.
