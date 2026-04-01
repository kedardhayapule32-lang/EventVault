require('dotenv').config();
const db = require('./utils/database');

async function test() {
  console.log('Testing DB query for broadcast...');
  try {
    let query = { status: { $ne: 'cancelled' } };
    console.log('Query:', query);
    
    let registrations = await db.find('registrations', query);
    console.log(`Found ${registrations.length} registrations`);
    
    if (registrations.length > 0) {
      console.log('First 3 registrations:');
      registrations.slice(0, 3).forEach(r => console.log(`- ${r.name} (${r.email}), status: ${r.status}`));
      
      const emails = [...new Set(registrations.map(r => r.email).filter(e => !!e))];
      console.log(`Unique emails found: ${emails.length}`);
    } else {
      console.log('No registrations found in DB matching criteria.');
    }
  } catch (err) {
    console.error('Test failed:', err);
  }
}

test().catch(console.error);
