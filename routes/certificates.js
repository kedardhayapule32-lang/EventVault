const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/database');
const authMiddleware = require('../middleware/auth');
const certUtil = require('../utils/certificate');
const emailUtil = require('../utils/email');

// Restriction: Most of these routes should be admin-only
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// GET /api/certificates - Get all manual certificates
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const certs = await db.find('manual_certificates', {}, { createdAt: -1 });
    res.json(certs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates - Add new certificate entry
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, semester, branch, category, place, achievement, academicYear } = req.body;
    if (!name || !email || !category || !academicYear) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const cert = await db.insert('manual_certificates', {
      certId: uuidv4(),
      name,
      email: email.toLowerCase().trim(),
      semester,
      branch,
      category, // e.g., "Academics – Toppers"
      place,    // e.g., "1st", "2nd", "3rd"
      achievement, // e.g., "Topper in CSE"
      academicYear,
      status: 'pending', // 'pending' or 'sent'
      createdAt: new Date()
    });

    res.status(201).json(cert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/certificates/:id - Update entry
router.patch('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { _id, ...updateData } = req.body;
    await db.update('manual_certificates', { _id: req.params.id }, { $set: updateData });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/certificates/:id - Delete entry
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.remove('manual_certificates', { _id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/send - Send certificates to all pending or selected entries
router.post('/send', authMiddleware, adminOnly, async (req, res) => {
  const { ids } = req.body; // Optional: array of _id to send
  
  try {
    let query = { status: 'pending' };
    if (ids && Array.isArray(ids) && ids.length > 0) {
      query._id = { $in: ids };
    }

    const certs = await db.find('manual_certificates', query);
    if (certs.length === 0) return res.status(404).json({ error: 'No pending certificates found to send' });

    res.status(202).json({ success: true, message: `Sending ${certs.length} certificates in background` });

    // Background process
    (async () => {
      console.log(`[Manual Cert Broadcast] Background process started for ${certs.length} users.`);
      let successCount = 0;
      let failCount = 0;

      for (const cert of certs) {
        try {
          // Prepare data for PDF generator
          const pdfData = {
            name: cert.name,
            eventTitle: `${cert.achievement || cert.category}${cert.place ? ` (${cert.place} Place)` : ''}`,
            eventDate: cert.academicYear,
            type: 'achievement',
            category: cert.category,
            semester: cert.semester,
            branch: cert.branch,
            place: cert.place,
            achievement: cert.achievement,
            academicYear: cert.academicYear,
            photo: cert.photo // In case manual certs also have photos
          };

          console.log(`[Manual Cert] Generating PDF for ${cert.name} (${cert.email})...`);
          const certBuffer = await certUtil.generateCertificatePDF(pdfData);

          if (!certBuffer || certBuffer.length === 0) {
            throw new Error('Generated certificate buffer is empty');
          }
          console.log(`[Manual Cert] PDF generated (${certBuffer.length} bytes)`);

          const filename = `Certificate_${cert.name.replace(/\s+/g, '_')}.pdf`;

          console.log(`[Manual Cert] Attempting to send email to ${cert.email}...`);
          const emailRes = await emailUtil.sendEmail(
            cert.email,
            `Academic/Event Certificate - ${cert.category}`,
            `Dear ${cert.name},\n\nPlease find attached your certificate for "${cert.category}" (${cert.academicYear}).\n\nCongratulations on your achievement!\n\nBest regards,\nBGMIT EventVault Team`,
            null,
            [{ filename, content: certBuffer }]
          );

          if (emailRes && emailRes.success) {
            // Update status only if email sent successfully
            await db.update('manual_certificates', { _id: cert._id }, { $set: { status: 'sent', sentAt: new Date() } });
            console.log(`[Manual Cert] Successfully sent and updated status for ${cert.name}`);
            successCount++;
          } else {
            console.error(`[Manual Cert ERROR] Failed to send email to ${cert.email}: ${emailRes.error || 'Unknown error'}`);
            failCount++;
          }

          // Delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (innerErr) {
          console.error(`[Manual Cert ERROR] Unexpected error for ${cert.email || 'unknown'}:`, innerErr.stack || innerErr.message);
          failCount++;
        }
      }
      console.log(`[Manual Cert Broadcast] Completed. Success: ${successCount}, Failures: ${failCount}`);
    })();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
