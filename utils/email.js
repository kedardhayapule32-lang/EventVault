const nodemailer = require('nodemailer');

// Configure SMTP transport
// These should ideally be in your .env file
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

module.exports = {
  async sendEmail(to, subject, text, html, attachments = []) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('[Email ERROR] SMTP credentials not configured in .env');
      return { error: 'SMTP not configured' };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'EventVault'}" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html: html || text.replace(/\n/g, '<br>'),
        attachments
      });
      console.log(`[Email SENT] To: ${to}, MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[Email ERROR] Details: ${err.stack || err.message}`);
      return { error: err.message };
    }
  },

  async sendBroadcast(emails, subject, message) {
    const results = { success: 0, failure: 0 };
    for (const email of emails) {
      const res = await this.sendEmail(email, subject, message);
      if (res.success) results.success++;
      else results.failure++;
      
      // Small delay to prevent spam flagging
      await new Promise(r => setTimeout(r, 500));
    }
    return results;
  }
};
