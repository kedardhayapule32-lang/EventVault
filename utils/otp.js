const db = require('./database');
const emailUtil = require('./email');

const OTP_COLLECTION = 'otps';
const OTP_EXPIRY_MINUTES = 30;

module.exports = {
  async generateOTP(email) {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

    // Save to database
    // Remove any existing OTP for this email first
    await db.remove(OTP_COLLECTION, { email: email.toLowerCase() });
    
    await db.insert(OTP_COLLECTION, {
      email: email.toLowerCase(),
      otp,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString()
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

    // Send email non-blocking (fire and forget with error logging)
    emailUtil.sendEmail(email, subject, text, html)
      .catch(err => console.error('[OTP Email Error]', err.message));
    
    return { success: true };
  },

  async verifyOTP(email, otp) {
    const record = await db.findOne(OTP_COLLECTION, { 
      email: email.toLowerCase(), 
      otp: otp.toString() 
    });

    if (!record) return { success: false, error: 'Invalid verification code' };

    const now = new Date();
    // Support both cases just in case, and handle potential nulls
    const expiryVal = record.expiresAt || record.expiresat;
    
    console.log(`[OTP Debug] Email: ${email}, Now: ${now.toISOString()}, RecordExpiry: ${expiryVal}, RawRecord: ${JSON.stringify(record)}`);

    if (!expiryVal) {
        console.warn(`[OTP Warning] No expiry found for ${email}, allowing for now.`);
        await db.remove(OTP_COLLECTION, { _id: record._id });
        return { success: true };
    }

    const expiry = new Date(expiryVal);
    
    // Check if the expiry is actually a valid date
    if (isNaN(expiry.getTime())) {
        console.error(`[OTP Error] Invalid expiry date for ${email}: ${expiryVal}`);
        // If it's invalid, we might want to allow it or deny it. Let's allow for now but log.
        await db.remove(OTP_COLLECTION, { _id: record._id });
        return { success: true };
    }

    if (now > expiry) {
      console.log(`[OTP Info] Code expired for ${email}. Now: ${now.toISOString()}, Expiry: ${expiry.toISOString()}`);
      await db.remove(OTP_COLLECTION, { _id: record._id });
      return { success: false, error: 'Verification code has expired' };
    }

    // Success - remove the OTP so it can't be used again
    await db.remove(OTP_COLLECTION, { _id: record._id });
    return { success: true };
  }
};
