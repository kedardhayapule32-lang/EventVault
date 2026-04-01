const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { stringify } = require('csv-stringify');
const db = require('../utils/database');
const authMiddleware = require('../middleware/auth');

// GET /api/events - List events (filtered for organizers)
router.get('/', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'eventvault_secret_2024';
    const auth = req.headers.authorization;
    let user = null;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        const token = auth.split(' ')[1];
        user = jwt.verify(token, JWT_SECRET);
      } catch (e) { /* ignore */ }
    }

    // Fetch all non-deleted events and handle filtering/sorting in JS to avoid index issues
    let events = await db.find('events', { status: { $ne: 'deleted' } });
    
    // Filter by results status if requested
    if (req.query.hasResults === 'true') {
      events = events.filter(e => e.results && Object.keys(e.results).length > 0);
    }
    
    if (user && user.role === 'organizer') {
      events = events.filter(e => e.createdBy === user.username);
    }
    // Admin sees all events including creator info (already in `createdBy` field)

    // Sort by date ascending
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Attach slot info
    const enriched = await Promise.all(events.map(async ev => {
      const regs = await db.find('registrations', { eventId: ev.eventId, status: { $ne: 'cancelled' } });
      const volunteerRegs = regs.filter(r => r.type === 'volunteer');
      const participantRegs = regs.filter(r => r.type === 'participant');
      const roles = (ev.volunteerRoles || []).map(role => {
        const filled = volunteerRegs.filter(r => r.roleId === role.id).length;
        return { ...role, filled, remaining: Math.max(0, role.slots - filled) };
      });
      return { ...ev, roles, participantCount: participantRegs.length, volunteerCount: volunteerRegs.length };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:eventId/results - Declare event results (Admin/Organizer Only)
router.put('/:eventId/results', authMiddleware, async (req, res) => {
  try {
    let event = await db.findOne('events', { eventId: req.params.eventId });
    if (!event) event = await db.findOne('events', { _id: req.params.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer' && event.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { results } = req.body;
    const targetId = event.eventId || req.params.eventId;
    await db.update('events', { eventId: targetId }, { $set: { results, updatedAt: new Date() } });
    res.json({ success: true, message: 'Results declared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:eventId - Single event
router.get('/:eventId', async (req, res) => {
  try {
    const event = await db.findOne('events', { eventId: req.params.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    
    // Optional: Check if organizer owns this event
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'eventvault_secret_2024';
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        const token = auth.split(' ')[1];
        const user = jwt.verify(token, JWT_SECRET);
        if (user.role === 'organizer' && event.createdBy !== user.username) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } catch (e) { /* ignore */ }
    }

    const regs = await db.find('registrations', { eventId: event.eventId, status: { $ne: 'cancelled' } });
    const volunteerRegs = regs.filter(r => r.type === 'volunteer');
    const participantRegs = regs.filter(r => r.type === 'participant');
    const roles = (event.volunteerRoles || []).map((role, index) => {
      const roleId = role.id || `role-${index}`;
      const filled = volunteerRegs.filter(r => r.roleId === roleId).length;
      return { ...role, id: roleId, filled, remaining: Math.max(0, role.slots - filled) };
    });
    res.json({ ...event, roles, participantCount: participantRegs.length, volunteerCount: volunteerRegs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events - Admin: create event
router.post('/', authMiddleware, async (req, res) => {
  try {
    // Check approval
    if (req.user.role === 'organizer' && req.user.approved === false) {
      return res.status(403).json({ error: 'Your account is pending approval. You cannot create events yet.' });
    }

    const { title, date, time, endTime, location, description, participantLimit, volunteerRoles, category, teamSize, teamMode, scope } = req.body;
    if (!title || !date || !time || !location) return res.status(400).json({ error: 'Title, date, time, location are required' });

    const eventId = uuidv4();
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const signupUrl = `${baseUrl}/signup/${eventId}`;
    const qrCode = await QRCode.toDataURL(signupUrl, { width: 300, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } });

    const roles = (volunteerRoles || []).map(r => ({ ...r, id: r.id || uuidv4() }));

    const event = await db.insert('events', {
      eventId, title, date, time, endTime: endTime || '', location, description: description || '',
      participantLimit: parseInt(participantLimit) || 100,
      volunteerRoles: roles, category: category || 'General',
      scope: scope || 'inhouse',
      teamMode: teamMode || 'individual',
      teamSize: teamMode === 'team' ? (parseInt(teamSize) || 0) : 0,
      signupUrl, qrCode, status: 'active',
      createdAt: new Date(), createdBy: req.user.username,
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:eventId - Admin: update event
router.put('/:eventId', authMiddleware, async (req, res) => {
  try {
    let event = await db.findOne('events', { eventId: req.params.eventId });
    if (!event) event = await db.findOne('events', { _id: req.params.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer') {
      if (req.user.approved === false) return res.status(403).json({ error: 'Account pending approval' });
      if (event.createdBy !== req.user.username) return res.status(403).json({ error: 'Access denied' });
    }

    const { title, date, time, endTime, location, description, participantLimit, volunteerRoles, category, teamSize, teamMode, scope, status } = req.body;
    const roles = (volunteerRoles || []).map(r => ({ ...r, id: r.id || uuidv4() }));
    const targetId = event.eventId || req.params.eventId;
    await db.update('events', { eventId: targetId }, { $set: { 
      title, 
      date, 
      time, 
      endTime: endTime || '', 
      location, 
      description: description || '', 
      participantLimit: parseInt(participantLimit), 
      volunteerRoles: roles, 
      category, 
      scope: scope || 'inhouse', 
      teamMode: teamMode || 'individual', 
      teamSize: teamMode === 'team' ? (parseInt(teamSize) || 0) : 0, 
      status: status || 'active', 
      updatedAt: new Date() 
    } });
    const updated = await db.findOne('events', { eventId: targetId });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:eventId - Admin: soft delete
router.delete('/:eventId', authMiddleware, async (req, res) => {
  try {
    const event = await db.findOne('events', { eventId: req.params.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer' && event.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.update('events', { eventId: req.params.eventId }, { $set: { status: 'deleted' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:eventId/registrations - Admin: get all registrations for an event
router.get('/:eventId/registrations', authMiddleware, async (req, res) => {
  try {
    const event = await db.findOne('events', { eventId: req.params.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer' && event.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const regs = await db.find('registrations', { eventId: req.params.eventId });
    const enriched = regs.map(r => ({ ...r, eventTitle: event?.title }))
      .sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:eventId/registrations/csv - Admin: export CSV
router.get('/:eventId/registrations/csv', authMiddleware, async (req, res) => {
  try {
    const event = await db.findOne('events', { eventId: req.params.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer' && event.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { teamName, type } = req.query;
    const query = { eventId: req.params.eventId, status: { $ne: 'cancelled' } };
    const regs = await db.find('registrations', query, { registeredAt: 1 });
    const rows = [['Name', 'Email', 'USN', 'Phone', 'Type', 'Role / Event', 'Team Name', 'Status', 'Registered At', 'Check-in']];
    regs.forEach(r => {
      const roleOrEvent = r.type === 'volunteer' ? (r.roleName || '') : (event?.title || '');
      rows.push([r.name, r.email, r.usn || '', r.phone || '', r.type, roleOrEvent, r.teamName || '', r.status, new Date(r.registeredAt).toLocaleString(), r.checkedIn ? 'Yes' : 'No']);
    });
    stringify(rows, (err, output) => {
      let filename = `${event?.title || 'event'}-registrations`;
      if (type) filename += `-${type}s`;
      if (teamName) filename += `-${teamName}`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(output);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
