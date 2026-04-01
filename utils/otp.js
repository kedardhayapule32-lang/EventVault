const db = require('./database');
const emailUtil = require('./email');

const OTP_COLLECTION = 'otps';
const OTP_EXPIRY_MINUTES = 10;

module.exports = {
  async generateOTP(email) {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

    // Save to Firestore
    // Remove any existing OTP for this email first
    await db.remove(OTP_COLLECTION, { email: email.toLowerCase() }, { multi: true });
    
    await db.insert(OTP_COLLECTION, {
      email: email.toLowerCase(),
      otp,
      expiresAt,
      createdAt: new Date()
    });

    // Send via email
    const subject = 'Your EventVault Verification Code';
    const text = `Your verification code is: ${otp}\n\nThis code will expire in ${OTP_EXPIRY_MINUTES} minutes.`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 500px;">
        <h2 style="color: #2d5be3; margin-top: 0;">EventVault Verification</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1a2040; margin: 20px 0;">${otp}</div>
        <p style="color: #64748b; font-size: 14px;">This code will expire in ${OTP_EXPIRY_MINUTES} minutes. If you didn't request this, please ignore this email.</p>
      </div>
    `;

    return await emailUtil.sendEmail(email, subject, text, html);
  },

  async verifyOTP(email, otp) {
    const record = await db.findOne(OTP_COLLECTION, { 
      email: email.toLowerCase(), 
      otp: otp.toString() 
    });

    if (!record) return { success: false, error: 'Invalid verification code' };

    const now = new Date();
    const expiry = new Date(record.expiresAt);
    
    if (now > expiry) {
      await db.remove(OTP_COLLECTION, { _id: record._id });
      return { success: false, error: 'Verification code has expired' };
    }

    // Success - remove the OTP so it can't be used again
    await db.remove(OTP_COLLECTION, { _id: record._id });
    return { success: true };
  }
};
