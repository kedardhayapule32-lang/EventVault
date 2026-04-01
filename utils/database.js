const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase
if (!admin.apps.length) {
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');
      serviceAccount = require(serviceAccountPath);
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
  }
}

const db_firestore = admin.firestore();

const db = {
  async findOne(collection, query) {
    const docs = await this.find(collection, query);
    return docs.length > 0 ? docs[0] : null;
  },

  async find(collection, query = {}, sort = {}) {
    let ref = db_firestore.collection(collection);
    const regexFilters = [];
    const jsFilters = [];

    // Apply filters and track which ones need JS-side filtering
    for (const [key, value] of Object.entries(query)) {
      const field = key === '_id' ? admin.firestore.FieldPath.documentId() : key;
      
      if (value instanceof RegExp) {
        regexFilters.push({ key, value });
      } else if (typeof value === 'object' && value !== null) {
        if (value.$ne !== undefined) {
          // Firestore != requires an index when combined with other filters/sorts.
          // We'll filter this in JS to be safe.
          jsFilters.push(doc => doc[key] !== value.$ne);
        } else if (value.$in !== undefined) {
          ref = ref.where(field, 'in', value.$in);
        } else if (value.$gt !== undefined) {
          ref = ref.where(field, '>', value.$gt);
        } else if (value.$lt !== undefined) {
          ref = ref.where(field, '<', value.$lt);
        } else if (value.$gte !== undefined) {
          ref = ref.where(field, '>=', value.$gte);
        } else if (value.$lte !== undefined) {
          ref = ref.where(field, '<=', value.$lte);
        }
      } else {
        ref = ref.where(field, '==', value);
      }
    }

    try {
      // We perform sorting in JS to avoid Firestore composite index requirements
      const snapshot = await ref.get();
      let results = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));

      // Apply regex filters manually
      for (const { key, value } of regexFilters) {
        results = results.filter(doc => value.test(doc[key]));
      }

      // Apply JS filters (like $ne)
      for (const filterFn of jsFilters) {
        results = results.filter(filterFn);
      }

      // Apply sorting manually in JS
      const sortEntries = Object.entries(sort);
      if (sortEntries.length > 0) {
        results.sort((a, b) => {
          for (const [key, direction] of sortEntries) {
            const valA = a[key];
            const valB = b[key];
            if (valA < valB) return direction === -1 ? 1 : -1;
            if (valA > valB) return direction === -1 ? -1 : 1;
          }
          return 0;
        });
      }

      return results;
    } catch (error) {
      console.error(`❌ Firestore query error on collection ${collection}:`, error.message);
      if (error.message.includes('index')) {
        console.warn('⚠️ Missing Firestore index. Attempting to fallback to client-side filtering...');
        // If the query failed because of missing composite indexes, 
        // we can try fetching all documents and filtering them in JS as a last resort.
        try {
          const snapshot = await db_firestore.collection(collection).get();
          let results = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
          
          // Apply ALL filters in JS
          for (const [key, value] of Object.entries(query)) {
            if (value instanceof RegExp) {
              results = results.filter(doc => value.test(doc[key]));
            } else if (typeof value === 'object' && value !== null) {
              if (value.$ne !== undefined) results = results.filter(doc => doc[key] !== value.$ne);
              if (value.$in !== undefined) results = results.filter(doc => value.$in.includes(doc[key]));
              if (value.$gt !== undefined) results = results.filter(doc => doc[key] > value.$gt);
              if (value.$lt !== undefined) results = results.filter(doc => doc[key] < value.$lt);
              if (value.$gte !== undefined) results = results.filter(doc => doc[key] >= value.$gte);
              if (value.$lte !== undefined) results = results.filter(doc => doc[key] <= value.$lte);
            } else {
              results = results.filter(doc => doc[key] === value);
            }
          }

          // Apply sorting manually in JS
          const sortEntries = Object.entries(sort);
          if (sortEntries.length > 0) {
            results.sort((a, b) => {
              for (const [key, direction] of sortEntries) {
                const valA = a[key];
                const valB = b[key];
                if (valA < valB) return direction === -1 ? 1 : -1;
                if (valA > valB) return direction === -1 ? -1 : 1;
              }
              return 0;
            });
          }
          return results;
        } catch (innerError) {
          console.error(`❌ Fatal Firestore fallback error:`, innerError.message);
          return [];
        }
      }
      return [];
    }
  },

  async insert(collection, doc) {
    const res = await db_firestore.collection(collection).add(doc);
    return { _id: res.id, ...doc };
  },

  async update(collection, query, update, options = {}) {
    if (query._id) {
      const docRef = db_firestore.collection(collection).doc(query._id);
      let updateData = update.$set || update;
      
      if (update.$push) {
        for (const [key, val] of Object.entries(update.$push)) {
          updateData[key] = admin.firestore.FieldValue.arrayUnion(val);
        }
      }
      await docRef.update(updateData);
      return 1;
    }

    const docs = await this.find(collection, query);
    let count = 0;
    for (const doc of docs) {
      await db_firestore.collection(collection).doc(doc._id).update(update.$set || update);
      count++;
      if (!options.multi) break;
    }
    return count;
  },

  async remove(collection, query, options = {}) {
    const docs = await this.find(collection, query);
    let count = 0;
    for (const doc of docs) {
      await db_firestore.collection(collection).doc(doc._id).delete();
      count++;
      if (!options.multi) break;
    }
    return count;
  },

  async count(collection, query) {
    const docs = await this.find(collection, query);
    return docs.length;
  }
};

module.exports = db;
