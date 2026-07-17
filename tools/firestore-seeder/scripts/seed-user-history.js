#!/usr/bin/env node
"use strict";

/**
 * Orthos Systems Firestore seeder
 *
 * Usage:
 *   npm install firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
 *   node scripts/seed-user-history.js \
 *     --email jiteeghaghadropship@gmail.com \
 *     --file seed-data/jiteeghaghadropship-20-days.json \
 *     --reset
 *
 * Dry run:
 *   node scripts/seed-user-history.js --email ... --file ... --dry-run
 */

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const args = { reset: false, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--reset") args.reset = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--email") args.email = argv[++i];
    else if (token === "--file") args.file = argv[++i];
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  console.log(`
Orthos Systems Firestore Seeder

Required:
  --email <address>   Firebase Authentication email
  --file <json>       Seed-data JSON file

Options:
  --reset             Delete current Orthos subcollection data first
  --dry-run           Validate and print operations without writing
  --help              Show this message
`);
}

function requireBooleanMap(value, requiredKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const key of requiredKeys) {
    if (typeof value[key] !== "boolean") {
      throw new Error(`${label}.${key} must be boolean.`);
    }
  }
}

function validateSeed(seed, requestedEmail) {
  if (seed.targetEmail !== requestedEmail) {
    throw new Error(
      `Safety check failed: JSON targetEmail (${seed.targetEmail}) does not match --email (${requestedEmail}).`
    );
  }
  if (!Array.isArray(seed.days) || seed.days.length !== 20) {
    throw new Error("Seed must contain exactly 20 days.");
  }

  const exerciseKeys = ["ex1", "ex2", "ex3", "ex4", "ex5"];
  const supplementKeys = [
    "supp1_Morning",
    "supp2_Evening",
    "supp3_Morning",
  ];
  const temporal = new Set(["Past", "Future", "Looping present"]);
  const content = new Set(["Planning", "Worrying", "Fantasizing", "Judging", "Remembering"]);
  const constraint = new Set(["Obsessive", "Recurring", "Scattered", "Focused but absent"]);
  const valence = new Set(["Anxious", "Calm", "Excited", "Sad", "Neutral"]);

  seed.days.forEach((day, index) => {
    const expectedDay = index + 1;
    if (day.programDay !== expectedDay) {
      throw new Error(`Expected programDay ${expectedDay}, found ${day.programDay}.`);
    }
    requireBooleanMap(day.exercises, exerciseKeys, `Day ${expectedDay} exercises`);
    requireBooleanMap(day.supplements, supplementKeys, `Day ${expectedDay} supplements`);

    const dc = day.dailyCompletion;
    if (!dc || typeof dc.reflectionText !== "string" || !dc.reflectionText.trim()) {
      throw new Error(`Day ${expectedDay} requires reflectionText.`);
    }
    for (const key of [
      "practiceComplete",
      "moduleRead",
      "dayFullyComplete",
      "exercisesComplete",
      "supplementsComplete",
      "missed",
    ]) {
      if (typeof dc[key] !== "boolean") {
        throw new Error(`Day ${expectedDay} dailyCompletion.${key} must be boolean.`);
      }
    }

    if (!Array.isArray(day.drifts) || day.drifts.length < 1) {
      throw new Error(`Day ${expectedDay} requires at least one drift.`);
    }
    day.drifts.forEach((drift, driftIndex) => {
      if (!temporal.has(drift.temporal)) throw new Error(`Invalid temporal on Day ${expectedDay}, drift ${driftIndex + 1}.`);
      if (!content.has(drift.content)) throw new Error(`Invalid content on Day ${expectedDay}, drift ${driftIndex + 1}.`);
      if (!constraint.has(drift.constraint)) throw new Error(`Invalid constraint on Day ${expectedDay}, drift ${driftIndex + 1}.`);
      if (!valence.has(drift.valence)) throw new Error(`Invalid valence on Day ${expectedDay}, drift ${driftIndex + 1}.`);
      if (typeof drift.custom !== "string") throw new Error(`custom must be a string on Day ${expectedDay}.`);
      if (typeof drift.aiResponse !== "string") throw new Error(`aiResponse must be a string on Day ${expectedDay}.`);
    });
  });
}

function timestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
  return admin.firestore.Timestamp.fromDate(date);
}

async function deleteCollection(db, collectionRef, batchSize = 400) {
  let total = 0;
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) return total;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snap.size;
  }
}

async function resetUserData(db, uid, dryRun) {
  const userRef = db.collection("users").doc(uid);
  const names = [
    "daily_completions",
    "exercises",
    "supplements",
    "drift_logs",
    // Legacy collection intentionally removed so old posture-score data cannot
    // affect dashboard state while the obsolete read remains in the HTML.
    "posture_scores",
  ];

  const deleted = {};
  for (const name of names) {
    if (dryRun) {
      const snap = await userRef.collection(name).get();
      deleted[name] = snap.size;
    } else {
      deleted[name] = await deleteCollection(db, userRef.collection(name));
    }
  }
  return deleted;
}

async function commitOperations(db, operations, dryRun) {
  if (dryRun) return;

  // Firestore batches support up to 500 writes. Use a smaller margin.
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch();
    for (const op of operations.slice(i, i + 400)) {
      batch.set(op.ref, op.data, op.options || {});
    }
    await batch.commit();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }
  if (!args.email || !args.file) {
    usage();
    throw new Error("--email and --file are required.");
  }
  if (!args.reset) {
    throw new Error(
      "Safety check: this seeder requires --reset so it cannot silently merge with existing user history."
    );
  }

  const filePath = path.resolve(args.file);
  const seed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validateSeed(seed, args.email);

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const auth = admin.auth();
  const db = admin.firestore();
  const user = await auth.getUserByEmail(args.email);
  const uid = user.uid;
  const userRef = db.collection("users").doc(uid);

  console.log(`Target: ${args.email}`);
  console.log(`UID: ${uid}`);
  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"}`);

  const deleted = await resetUserData(db, uid, args.dryRun);

  const operations = [];
  const profileNow = admin.firestore.Timestamp.now();
  operations.push({
    ref: userRef,
    data: {
      uid,
      email: user.email || args.email,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      programStartDate: seed.profile.programStartDate,
      programDay: seed.profile.programDay,
      practiceStreak: seed.profile.practiceStreak,
      exStreak: seed.profile.exStreak,
      suppStreak: seed.profile.suppStreak,
      updatedAt: profileNow,
      seededAt: profileNow,
      seedSchemaVersion: seed.schemaVersion,
    },
    options: { merge: true },
  });

  let driftTotal = 0;
  for (const day of seed.days) {
    const dayKey = String(day.programDay);

    operations.push({
      ref: userRef.collection("exercises").doc(dayKey),
      data: {
        completions: day.exercises,
        updatedAt: timestamp(day.dailyCompletion.updatedAt),
      },
    });

    operations.push({
      ref: userRef.collection("supplements").doc(dayKey),
      data: {
        completions: day.supplements,
        updatedAt: timestamp(day.dailyCompletion.updatedAt),
      },
    });

    operations.push({
      ref: userRef.collection("daily_completions").doc(dayKey),
      data: {
        ...day.dailyCompletion,
        completedAt: timestamp(day.dailyCompletion.completedAt),
        updatedAt: timestamp(day.dailyCompletion.updatedAt),
      },
    });

    day.drifts.forEach((drift, index) => {
      driftTotal += 1;
      const stableId = `seed-day-${String(day.programDay).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
      operations.push({
        ref: userRef.collection("drift_logs").doc(stableId),
        data: {
          programDay: day.programDay,
          timestamp: timestamp(drift.timestamp),
          temporal: drift.temporal,
          content: drift.content,
          constraint: drift.constraint,
          valence: drift.valence,
          custom: drift.custom,
          aiResponse: drift.aiResponse,
          seeded: true,
        },
      });
    });
  }

  await commitOperations(db, operations, args.dryRun);

  console.log("\nDeleted:");
  Object.entries(deleted).forEach(([name, count]) => console.log(`  ${name}: ${count}`));
  console.log("\nPrepared:");
  console.log(`  Profile documents: 1`);
  console.log(`  Daily completion documents: ${seed.days.length}`);
  console.log(`  Exercise documents: ${seed.days.length}`);
  console.log(`  Supplement documents: ${seed.days.length}`);
  console.log(`  Drift-log documents: ${driftTotal}`);
  console.log(`  Total writes: ${operations.length}`);
  console.log(`\nProgram state: Day ${seed.profile.programDay}`);
  console.log(args.dryRun ? "\nDry run complete; nothing was written." : "\nSeed complete.");
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exitCode = 1;
});
