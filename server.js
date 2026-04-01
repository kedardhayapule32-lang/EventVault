require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./utils/database');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const registrationRoutes = require('./routes/registrations');
const analyticsRoutes = require('./routes/analytics');
const certificateRoutes = require('./routes/certificates');
const chatRoutes = require('./routes/chat');

const reminderService = require('./utils/reminders');
const emailUtil = require('./utils/email');
const { stringify } = require('csv-stringify');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/chat', chatRoutes);

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/choice/:eventId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'choice.html')));
app.get('/signup/:eventId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/user-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user-login.html')));
app.get('/user-signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user-signup.html')));

// Seed admin user on startup
async function seedAdmin() {
  const bcrypt = require('bcryptjs');
  try {
    const doc = await db.findOne('users', { role: 'admin' });
    if (!doc) {
      const hash = await bcrypt.hash('EventVault2024!', 10);
      await db.insert('users', { username: 'admin', password: hash, role: 'admin', name: 'Event Organizer', email: 'admin@events.com', createdAt: new Date() });
      console.log('✅ Admin seeded: username=admin, password=EventVault2024!');
    }
  } catch (err) {
    console.error('❌ Error seeding admin:', err.message);
  }
}

// Cron: Check reminders every 15 minutes
cron.schedule('*/15 * * * *', () => {
  reminderService.sendReminders();
});

// Automated CSV Reports
async function sendDailyCSVReport() {
  console.log('[Scheduled Report] Generating automated CSV export...');
  try {
    const regs = await db.find('registrations', { status: { $ne: 'cancelled' } });
    const rows = [['Event', 'Name', 'Email', 'USN', 'Phone', 'Type', 'Role / Event', 'Team Name', 'Status', 'Registered At', 'Check-in']];
    
    // Enrich with event titles
    const enriched = await Promise.all(regs.map(async r => {
      const event = await db.findOne('events', { eventId: r.eventId });
      const roleOrEvent = r.type === 'volunteer' ? (r.roleName || '') : (event?.title || '');
      return {
        data: [event?.title || 'Unknown', r.name, r.email, r.usn || '', r.phone || '', r.type, roleOrEvent, r.teamName || '', r.status, new Date(r.registeredAt).toLocaleString(), r.checkedIn ? 'Yes' : 'No'],
        registeredAt: r.registeredAt
      };
    }));
    
    // Sort by registration date descending
    enriched.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
    
    enriched.forEach(item => rows.push(item.data));

    stringify(rows, async (err, output) => {
      if (err) return console.error('[Scheduled Report] CSV Error:', err);
      
      const timestamp = new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
      const subject = `EventVault Automated Report - ${timestamp}`;
      const text = `Please find attached the automated registrations report for all events as of ${timestamp}.`;
      const filename = `eventvault-report-${new Date().toISOString().split('T')[0]}.csv`;

      await emailUtil.sendEmail(
        'bgmitcs034@gmail.com', 
        subject, 
        text, 
        null, 
        [{ filename, content: output }]
      );
      console.log('[Scheduled Report] Report emailed successfully to admin.');
    });
  } catch (err) {
    console.error('[Scheduled Report] Fatal Error:', err);
  }
}

// Schedule: 9am, 12pm, 3pm, 6pm, 9pm
cron.schedule('0 9,12,15,18,21 * * *', sendDailyCSVReport);
cron.schedule('41 15 * * *', sendDailyCSVReport);
// Schedule: 11:59pm
cron.schedule('59 23 * * *', sendDailyCSVReport);

app.listen(PORT, () => {
  console.log(`\n🎉 Event App running at: http://localhost:${PORT}\n`);
  seedAdmin();
});
