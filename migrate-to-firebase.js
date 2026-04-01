const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Initialize Firebase
const serviceAccount = require('./firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function migrateCollection(fileName, collectionName) {
  console.log(`\n🚀 Starting migration for: ${fileName} -> Firestore Collection: ${collectionName}`);
  
  const filePath = path.join(__dirname, 'data', fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ File not found: ${filePath}, skipping.`);
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const doc = JSON.parse(line);

      // Skip NeDB index lines
      if (doc.$$indexCreated) continue;

      const id = doc._id;
      delete doc._id;

      // Recursively convert NeDB dates {$date: timestamp} to JS Dates
      const cleanDoc = transformDates(doc);

      // Add default status if missing
      if (!cleanDoc.status) {
        cleanDoc.status = 'active';
      }

      if (id) {
        await db.collection(collectionName).doc(id).set(cleanDoc);
      } else {
        await db.collection(collectionName).add(cleanDoc);
      }
      
      count++;
      if (count % 10 === 0) process.stdout.write('.');
    } catch (err) {
      console.error(`\n❌ Error parsing line in ${fileName}:`, err.message);
    }
  }

  console.log(`\n✅ Finished! Migrated ${count} documents to ${collectionName}.`);
}

function transformDates(obj) {
  if (Array.isArray(obj)) {
    return obj.map(transformDates);
  } else if (obj !== null && typeof obj === 'object') {
    if (obj['$$date']) {
      return new Date(obj['$$date']);
    }
    const newObj = {};
    for (const key in obj) {
      newObj[key] = transformDates(obj[key]);
    }
    return newObj;
  }
  return obj;
}

async function runMigration() {
  try {
    await migrateCollection('users.db', 'users');
    await migrateCollection('events.db', 'events');
    await migrateCollection('registrations.db', 'registrations');
    await migrateCollection('reminders.db', 'reminders');
    
    console.log('\n✨ All migrations complete!');
    process.exit(0);
  } catch (err) {
    console.error('\n💥 Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
