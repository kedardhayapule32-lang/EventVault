const router = require('express').Router();
const db = require('../utils/database');
const authMiddleware = require('../middleware/auth');

// GET /api/analytics/overview - Dashboard stats
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    // Fetch events and handle filtering in JS to avoid index issues
    let events = await db.find('events', {});
    
    if (req.user.role === 'organizer') {
      events = events.filter(e => e.createdBy === req.user.username);
    }
    
    // Further filter for active events
    const activeEvents = events.filter(e => e.status === 'active');
    const eventIds = activeEvents.map(e => e.eventId);

    // Fetch all registrations and handle filtering in JS
    let regs = await db.find('registrations', {});
    
    if (req.user.role === 'organizer') {
      regs = regs.filter(r => eventIds.includes(r.eventId));
    }
    
    // Filter out cancelled registrations
    const activeRegs = regs.filter(r => r.status !== 'cancelled');

    const totalEvents = activeEvents.length;
    const totalRegs = activeRegs.length;
    
    const now = new Date();
    const upcomingEvents = activeEvents.filter(e => new Date(e.date + 'T' + (e.time || '00:00')) > now).length;
    const pastEvents = activeEvents.filter(e => new Date(e.date + 'T' + (e.time || '00:00')) <= now).length;
    const totalVolunteers = activeRegs.filter(r => r.type === 'volunteer').length;
    const totalParticipants = activeRegs.filter(r => r.type === 'participant').length;
    const checkedIn = activeRegs.filter(r => r.checkedIn).length;
    const noShows = activeRegs.filter(r => r.noShow).length;
    const swapRequests = activeRegs.filter(r => r.swapRequested).length;

    // Volunteer coverage per event
    let totalSlots = 0, filledSlots = 0;
    activeEvents.forEach(ev => {
      (ev.volunteerRoles || []).forEach(role => {
        totalSlots += role.slots;
        const filled = activeRegs.filter(r => r.eventId === ev.eventId && r.roleId === role.id).length;
        filledSlots += Math.min(filled, role.slots);
      });
    });
    const volunteerCoverage = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

    res.json({ totalEvents, upcomingEvents, pastEvents, totalRegs, totalVolunteers, totalParticipants, checkedIn, noShows, swapRequests, volunteerCoverage, filledSlots, totalSlots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/events - Per-event analytics
router.get('/events', authMiddleware, async (req, res) => {
  try {
    // Fetch events and handle filtering in JS
    let events = await db.find('events', { status: { $ne: 'deleted' } });
    
    if (req.user.role === 'organizer') {
      events = events.filter(e => e.createdBy === req.user.username);
    }
    
    // Sort by date descending
    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    const eventIds = events.map(e => e.eventId);

    // Fetch all registrations and handle filtering in JS
    let regs = await db.find('registrations', {});
    
    if (req.user.role === 'organizer') {
      regs = regs.filter(r => eventIds.includes(r.eventId));
    }

    const data = events.map(ev => {
      const evRegs = regs.filter(r => r.eventId === ev.eventId);
      const volunteers = evRegs.filter(r => r.type === 'volunteer' && r.status !== 'cancelled');
      const participants = evRegs.filter(r => r.type === 'participant' && r.status !== 'cancelled');
      const checkedIn = evRegs.filter(r => r.checkedIn).length;
      const noShows = evRegs.filter(r => r.noShow).length;
      const cancelled = evRegs.filter(r => r.status === 'cancelled').length;
      let slots = 0, filled = 0;
      (ev.volunteerRoles || []).forEach(role => {
        slots += role.slots;
        filled += Math.min(volunteers.filter(r => r.roleId === role.id).length, role.slots);
      });
      return {
        eventId: ev.eventId, title: ev.title, date: ev.date, category: ev.category,
        volunteers: volunteers.length, participants: participants.length,
        checkedIn, noShows, cancelled,
        coverage: slots > 0 ? Math.round((filled / slots) * 100) : 0,
        totalSlots: slots, filledSlots: filled
      };
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/top-volunteers - Top volunteers by event count
router.get('/top-volunteers', authMiddleware, async (req, res) => {
  try {
    const regs = await db.find('registrations', { type: 'volunteer', status: { $ne: 'cancelled' } });
    const map = {};
    regs.forEach(r => {
      if (!map[r.email]) map[r.email] = { name: r.name, email: r.email, events: 0 };
      map[r.email].events++;
    });
    const sorted = Object.values(map).sort((a, b) => b.events - a.events).slice(0, 10);
    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
