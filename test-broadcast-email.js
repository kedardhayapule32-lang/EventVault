require('dotenv').config();
const db = require('./utils/database');
const emailUtil = require('./utils/email');

async function test() {
  console.log('Testing general broadcast email...');
  
  // Create a dummy registration for testing if none exists
  const testEmail = process.env.EMAIL_USER;
  const testReg = {
    registrationId: 'test-reg-123',
    name: 'Test Recipient',
    email: testEmail,
    status: 'confirmed',
    eventId: 'any-event'
  };

  try {
    // In actual code it finds from DB. Here we just use the list.
    const registrations = [testReg];
    const targetMethods = ['email'];
    const message = 'Test broadcast message from EventVault.';
    
    if (targetMethods.includes('email')) {
      const emails = [...new Set(registrations.map(r => r.email).filter(e => !!e))];
      console.log(`[Broadcast Task] Email sending to ${emails.length} unique addresses...`);
      const subject = 'Broadcast Message - BGMIT';
      const results = await emailUtil.sendBroadcast(emails, subject, message);
      console.log(`[Broadcast Task] Email completed. Success: ${results.success}, Failure: ${results.failure}`);
    }
  } catch (err) {
    console.error('Test failed:', err);
  }
}

test().catch(console.error);
