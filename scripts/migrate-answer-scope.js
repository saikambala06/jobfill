/**
 * One-off migration: answers are now identified by question *and* scope.
 *
 * Saved answers used to be unique on { userId, normalized }, which meant "Job
 * Title" could only ever hold one value per user — so Work Experience 2 overwrote
 * Work Experience 1, and whichever was saved last came back for both. The new key
 * is { userId, normalized, scope }.
 *
 * Run once against each environment:
 *   node scripts/migrate-answer-scope.js
 *
 * Safe to run more than once; every step checks its own state first.
 */
import mongoose from 'mongoose';
import 'dotenv/config';

const URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/jobfill';
const OLD_INDEX = 'userId_1_normalized_1';
const NEW_INDEX = 'userId_1_normalized_1_scope_1';

async function main() {
  await mongoose.connect(URI);
  const answers = mongoose.connection.db.collection('answers');
  console.log(`connected to ${mongoose.connection.name}`);

  // 1. Every existing row predates scoping, so it is unscoped by definition.
  const backfill = await answers.updateMany(
    { scope: { $exists: false } },
    { $set: { scope: '', skipped: false } },
  );
  console.log(`  backfilled scope on ${backfill.modifiedCount} answers`);

  // 2. Drop the old unique index. Mongo will not build the new one alongside it.
  const existing = await answers.indexes();
  if (existing.some((i) => i.name === OLD_INDEX)) {
    await answers.dropIndex(OLD_INDEX);
    console.log(`  dropped ${OLD_INDEX}`);
  } else {
    console.log(`  ${OLD_INDEX} already gone`);
  }

  // 3. Build the scoped one.
  if (!existing.some((i) => i.name === NEW_INDEX)) {
    await answers.createIndex({ userId: 1, normalized: 1, scope: 1 }, { unique: true, name: NEW_INDEX });
    console.log(`  created ${NEW_INDEX}`);
  } else {
    console.log(`  ${NEW_INDEX} already present`);
  }

  await mongoose.disconnect();
  console.log('done');
}

main().catch(async (err) => {
  console.error('migration failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
