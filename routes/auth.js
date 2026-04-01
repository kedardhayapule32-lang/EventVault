const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const emailUtil = require('../utils/email');
const QRCode = require('qrcode');

const JWT_SECRET = process.env.JWT_SECRET || 'eventvault_secret_2024';
const ORGANIZER_SECRET_CODE = process.env.ORGANIZER_SECRET_CODE || 'ORG2024';
const ADMIN_EMAIL = 'bgmitcs034@gmail.com';

const otpUtil = require('../utils/otp');

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const result = await otpUtil.generateOTP(email);
    if (result.success) res.json({ success: true, message: 'OTP sent successfully' });
    else res.status(500).json({ error: result.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    console.log(`[OTP Verify] Attempt for ${email} with OTP: ${otp}`);
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
    const result = await otpUtil.verifyOTP(email, otp);
    if (result.success) {
      console.log(`[OTP Verify] Success for ${email}`);
      res.json({ success: true });
    } else {
      console.warn(`[OTP Verify] Failed for ${email}: ${result.error}`);
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    console.error(`[OTP Verify] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/user-profile
router.get('/user-profile', async (req, res) => {
  try {
    const { email, usn } = req.query;
    if (!email || !usn) return res.status(400).json({ error: 'Email and USN required' });
    const user = await db.findOne('registered_users', { email: email.toLowerCase(), usn: usn.toUpperCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/user-signup
router.post('/user-signup', async (req, res) => {
  try {
    const { name, email, usn, phone, type } = req.body;
    if (!name || !email || !usn || !type) return res.status(400).json({ error: 'Name, Email, USN, and Type are required' });

    // Check if this USN+Email already exists in our registered users
    const existing = await db.findOne('registered_users', { email: email.toLowerCase(), usn: usn.toUpperCase() });
    if (existing) return res.status(400).json({ error: 'An account with this Email and USN already exists' });

    const newUser = {
      name,
      email: email.toLowerCase(),
      usn: usn.toUpperCase(),
      phone: phone || '',
      type, // 'volunteer' or 'participant'
      createdAt: new Date()
    };

    await db.insert('registered_users', newUser);
    res.status(201).json({ success: true, message: 'User account created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, secretCode } = req.body;
    if (!email || !password || !name || !secretCode) return res.status(400).json({ error: 'All fields are required' });

    // Strong Password Validation: min 8 chars, mixed alphabets, numbers, and special characters
    const passRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    if (!passRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include a mix of alphabets, numbers, and special characters (symbols)' });
    }

    if (secretCode !== ORGANIZER_SECRET_CODE) {
      return res.status(400).json({ error: 'Invalid secret code' });
    }

    const existingUser = await db.findOne('users', { username: email.toLowerCase() });
    if (existingUser) return res.status(400).json({ error: 'User with this email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const newUser = {
      username: email.toLowerCase(),
      password: hash,
      role: 'organizer',
      name,
      email: email.toLowerCase(),
      approved: false,
      approve: false,
      createdAt: new Date()
    };

    const inserted = await db.insert('users', newUser);
    
    // Send email to admin (non-blocking)
    emailUtil.sendEmail(
      ADMIN_EMAIL,
      'New Organizer Registered',
      `A new organizer has registered and is pending approval.\n\nName: ${name}\nEmail: ${email}\n\nPlease review their details in the database.`
    ).catch(err => console.error('[Signup Admin Notification Error]', err.message));

    // Send confirmation email to the organizer (non-blocking)
    const appName = process.env.EMAIL_FROM_NAME || 'EventVault';
    emailUtil.sendEmail(
      email.toLowerCase(),
      `Registration Received - ${appName}`,
      `Hello ${name},\n\nThank you for registering as an organizer on EventVault.\n\nYour account is currently pending approval by our administrator. We will notify you via email once your account has been activated.\n\nBest regards,\nThe EventVault Team`
    ).catch(err => console.error('[Signup Organizer Notification Error]', err.message));

    res.status(201).json({ success: true, message: 'Registration successful. Your account is pending approval by the admin.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    // Send notification to admin on login attempt (non-blocking)
    emailUtil.sendEmail(
      ADMIN_EMAIL,
      'Organizer Login Attempt',
      `An organizer is attempting to log in.\n\nUsername/Email: ${username}\nTime: ${new Date().toLocaleString()}`
    ).catch(err => console.error('[Login Notification Error]', err.message));

    // Check for admin login
    const ADMIN_USERNAME = 'admin@eventvault.org';
    const ADMIN_PASSWORD = 'EventVaultAdmin2024!';
    const isAdminLogin = username.toLowerCase() === ADMIN_USERNAME && password === ADMIN_PASSWORD;

    let user;
    if (isAdminLogin) {
      // For admin login, find or create the central admin account
      user = await db.findOne('users', { username: ADMIN_USERNAME, role: 'admin' });
      if (!user) {
        // Create the central admin account
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        const newUser = {
          username: ADMIN_USERNAME,
          password: hash,
          role: 'admin',
          name: 'System Administrator',
          email: ADMIN_USERNAME,
          approved: true,
          createdAt: new Date()
        };
        const inserted = await db.insert('users', newUser);
        user = { ...newUser, _id: inserted._id };
        console.log(`✅ Central admin created: ${ADMIN_USERNAME}`);
      }
    } else {
      user = await db.findOne('users', { username: new RegExp(`^${username}$`, 'i') });
      if (!user) return res.status(401).json({ error: 'Email is invalid' });

      // If it's the master organizer password, it works for any organizer
      const MASTER_ORGANIZER_PASSWORD = 'EventVault2024!';
      const isMasterPassword = password === MASTER_ORGANIZER_PASSWORD;

      if (!isMasterPassword) {
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Enter valid password' });
      }
    }
    // Check approval status for organizers
    const isApproved = user.approved !== false && user.approve !== false;
    if (user.role === 'organizer' && !isApproved) {
      const token = jwt.sign({ id: user._id, username: user.username, name: user.name, role: user.role, approved: false }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, user: { id: user._id, username: user.username, name: user.name, role: user.role, approved: false }, pending: true });
    }

    const token = jwt.sign({ id: user._id, username: user.username, name: user.name, role: user.role, approved: isApproved }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user._id, username: user.username, name: user.name, role: user.role, approved: isApproved } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/verify
router.get('/verify', require('../middleware/auth'), (req, res) => {
  res.json({ valid: true, user: req.user });
});

// GET /api/auth/organizers - List all organizers (Admin Only)
router.get('/organizers', require('../middleware/auth'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const organizers = await db.find('users', { role: 'organizer' });
    res.json(organizers.map(o => ({ 
      username: o.username, 
      name: o.name, 
      email: o.email, 
      approved: o.approved !== false && o.approve !== false 
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/organizers/:username/approve - Approve an organizer (Admin Only)
router.post('/organizers/:username/approve', require('../middleware/auth'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  try {
    const user = await db.findOne('users', { username: req.params.username });
    if (!user) return res.status(404).json({ error: 'Organizer not found' });

    await db.update('users', { username: req.params.username }, { $set: { approved: true, approve: true } });

    // Send approval email to the organizer
    const appName = process.env.EMAIL_FROM_NAME || 'EventVault';
    const loginUrl = `${process.env.APP_URL || 'http://localhost:3000'}/admin`;
    
    const subject = `Account Approved: Welcome to ${appName}`;
    const text = `Hello ${user.name},\n\nGreat news! Your organizer account for EventVault has been approved by the administrator.\n\nYou can now log in to your dashboard to create and manage events.\n\nLogin here: ${loginUrl}\n\nBest regards,\nThe EventVault Team`;
    
    emailUtil.sendEmail(user.email, subject, text).catch(err => 
      console.error(`[Approval Email Error] Failed to notify ${user.email}:`, err.message)
    );

    res.json({ success: true, message: 'Organizer approved and notification email sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'All fields are required' });

    // Strong Password Validation: min 8 chars, mixed alphabets, numbers, and special characters
    const passRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    if (!passRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include a mix of alphabets, numbers, and special characters (symbols)' });
    }

    // 1. Verify OTP
    const otpResult = await otpUtil.verifyOTP(email, otp);
    if (!otpResult.success) return res.status(400).json({ error: otpResult.error });

    // 2. Update password in DB
    const hash = await bcrypt.hash(newPassword, 10);
    const updated = await db.update('users', { username: email.toLowerCase() }, { $set: { password: hash } });
    
    if (updated === 0) return res.status(404).json({ error: 'User not found' });

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
