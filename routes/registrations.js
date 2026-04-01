const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { stringify } = require('csv-stringify');
const db = require('../utils/database');
const authMiddleware = require('../middleware/auth');
const emailUtil = require('../utils/email');
const certUtil = require('../utils/certificate');

// GET /api/registrations/check-limit - Public: Check if user is over the volunteer limit
router.get('/check-limit', async (req, res) => {
  try {
    const { email, usn } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    // Check active volunteer registrations for both email and USN
    const activeRegs = await db.find('registrations', { 
      type: 'volunteer', 
      status: { $ne: 'cancelled' } 
    });
    
    const volCount = activeRegs.filter(r => 
      r.email.toLowerCase() === email.toLowerCase().trim() || 
      (usn && r.usn && r.usn.toLowerCase() === usn.toLowerCase().trim())
    ).length;
    
    res.json({ volCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/registrations/csv - Admin: export all registrations
router.get('/csv', authMiddleware, async (req, res) => {
  try {
    const { type, teamName, eventId, organizer, category, startDate, endDate } = req.query;
    let query = { status: { $ne: 'cancelled' } };
    
    if (req.user.role === 'organizer') {
      const myEvents = await db.find('events', { createdBy: req.user.username });
      const myEventIds = myEvents.map(e => e.eventId);
      query.eventId = { $in: myEventIds };
    } else if (organizer) {
      const orgEvents = await db.find('events', { createdBy: organizer });
      const orgEventIds = orgEvents.map(e => e.eventId);
      query.eventId = { $in: orgEventIds };
    }

    if (eventId) query.eventId = eventId;
    if (type && type !== 'all') query.type = type;
    if (teamName) query.teamName = teamName;

    let regs = await db.find('registrations', query, { registeredAt: 1 });
    
    const allEventsMap = {};
    const events = await db.find('events', { status: { $ne: 'deleted' } });
    events.forEach(e => allEventsMap[e.eventId] = e);

    // Filter by Category and Date on the results
    if (category || startDate || endDate) {
      regs = regs.filter(r => {
        const ev = allEventsMap[r.eventId];
        if (!ev) return false;
        if (category && ev.category !== category) return false;
        if (startDate && new Date(ev.date) < new Date(startDate)) return false;
        if (endDate && new Date(ev.date) > new Date(endDate)) return false;
        return true;
      });
    }

    const rows = [['Event', 'Organizer', 'Category', 'Name', 'Email', 'USN', 'Phone', 'Type', 'Role / Event', 'Team Name', 'Status', 'Registered At', 'Check-in']];
    
    regs.forEach(r => {
      const event = allEventsMap[r.eventId];
      const roleOrEvent = r.type === 'volunteer' ? (r.roleName || '') : (event?.title || '');
      rows.push([
        event?.title || 'Unknown', 
        event?.createdBy || 'Unknown',
        event?.category || 'General',
        r.name, 
        r.email, 
        r.usn || '', 
        r.phone || '', 
        r.type, 
        roleOrEvent, 
        r.teamName || '', 
        r.status, 
        new Date(r.registeredAt).toLocaleString(), 
        r.checkedIn ? 'Yes' : 'No'
      ]);
    });
    
    stringify(rows, (err, output) => {
      if (err) return res.status(500).json({ error: 'CSV Generation Error' });
      
      let filename = `registrations-export`;
      if (type && type !== 'all') filename += `-${type}s`;
      if (category) filename += `-${category}`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(output);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/registrations/team-check - Check team status
router.get('/team-check', async (req, res) => {
  try {
    const { eventId, teamName, password } = req.query;
    if (!eventId || !teamName) return res.status(400).json({ error: 'Missing params' });
    
    const event = await db.findOne('events', { eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const existing = await db.find('registrations', { eventId, teamName, status: { $ne: 'cancelled' } });
    if (existing.length === 0) {
      return res.json({ exists: false });
    }
    
    // Validate Password if team exists
    if (password && existing[0].password !== password) {
      return res.status(401).json({ error: 'Incorrect team password' });
    }
    
    const members = existing.map(m => ({ name: m.name, email: m.email }));
    res.json({ exists: true, members, isFull: members.length >= event.teamSize, teamSize: event.teamSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/registrations - Sign up as volunteer or participant
router.post('/', async (req, res) => {
  try {
    const { eventId, name, email, phone, usn, password, type, roleId, teamDetails } = req.body;
    if (!eventId || !name || !email || !type) return res.status(400).json({ error: 'eventId, name, email, type are required' });
    if (!['volunteer', 'participant'].includes(type)) return res.status(400).json({ error: 'type must be volunteer or participant' });

    const event = await db.findOne('events', { eventId });
    if (!event || (event.status && event.status !== 'active')) return res.status(404).json({ error: 'Event not found or inactive' });

    // Restrict Inhouse events to USNs starting with "2LB" or "2lb"
    if (event.scope === 'inhouse') {
      if (!usn || !usn.toLowerCase().startsWith('2lb')) {
        return res.status(403).json({ error: `${event.title} is a Inhouse event only for BGMIT Students.` });
      }
    }

    // Check duplicate
    const existing = await db.findOne('registrations', { eventId, email: email.toLowerCase(), status: { $ne: 'cancelled' } });
    if (existing) return res.status(409).json({ error: 'You are already registered for this event' });

    // Validate role for volunteers
    let roleName = '';
    if (type === 'volunteer') {
      // Restriction: A person cannot sign up for more than 2 events as a volunteer
      const activeRegs = await db.find('registrations', { 
        type: 'volunteer', 
        status: { $ne: 'cancelled' } 
      });
      
      const volCount = activeRegs.filter(r => 
        r.email.toLowerCase() === email.toLowerCase().trim() || 
        (usn && r.usn && r.usn.toLowerCase() === usn.toLowerCase().trim())
      ).length;
      
      if (volCount >= 2) {
        return res.status(403).json({ error: 'You are already registered as volunteer for 2 events' });
      }

      if (!roleId) return res.status(400).json({ error: 'roleId required for volunteer signup' });
      const role = (event.volunteerRoles || []).find(r => r.id === roleId);
      if (!role) return res.status(404).json({ error: 'Role not found' });
      roleName = role.name;
      const filled = await db.count('registrations', { eventId, roleId, type: 'volunteer', status: { $ne: 'cancelled' } });
      if (filled >= role.slots) return res.status(409).json({ error: `No slots available for ${role.name}` });
    }

    // Validate Team Details for Sports
    let finalTeamName = '';
    let finalTeamMembers = [];
    if (type === 'participant') {
      if (event.category === 'Sports' && event.teamMode === 'team') {
        if (!teamDetails || !teamDetails.teamName) {
          return res.status(400).json({ error: 'teamName required for team-based Sports event' });
        }
        finalTeamName = teamDetails.teamName.trim();
        
        // Fetch existing members
        const existingMembers = await db.find('registrations', { eventId, teamName: finalTeamName, status: { $ne: 'cancelled' } });
        
        if (existingMembers.length > 0) {
          // Validate Team Password if team already exists
          if (existingMembers[0].password !== password) {
            return res.status(401).json({ error: 'Incorrect team password. Please use the password set by the first team member.' });
          }
          if (existingMembers.length >= event.teamSize) {
            return res.status(400).json({ error: `Team ${finalTeamName} is full (Max ${event.teamSize} members)` });
          }
        }

        finalTeamMembers = [...existingMembers.map(m => ({ name: m.name, email: m.email })), { name: name.trim(), email: email.toLowerCase().trim() }];
        
        // Update all members' teamMembers array to reflect the full, updated list
        if (existingMembers.length > 0) {
          await db.update('registrations', { eventId, teamName: finalTeamName, status: { $ne: 'cancelled' } }, { $set: { teamMembers: finalTeamMembers } }, { multi: true });
        }
      } else {
        // Normal check limit
        const pCount = await db.count('registrations', { eventId, type: 'participant', status: { $ne: 'cancelled' } });
        if (pCount >= event.participantLimit) return res.status(409).json({ error: 'Event participant limit reached' });
      }
    }

    const reg = await db.insert('registrations', {
      registrationId: uuidv4(), eventId, name: name.trim(), email: email.toLowerCase().trim(),
      phone: phone || '', usn: usn || '', password: password || '', type, roleId: roleId || null, roleName,
      teamName: finalTeamName || null, teamMembers: finalTeamMembers || [],
      status: 'pending', checkedIn: false, hoursVolunteered: 0,
      registeredAt: new Date(), swapRequested: false, noShow: false,
      photo: req.body.photo || null
    });

    res.status(201).json({ ...reg, eventTitle: event.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/approve - Admin: approve registration
router.patch('/:id/approve', authMiddleware, async (req, res) => {
  try {
    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    const event = await db.findOne('events', { eventId: reg.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Update status to confirmed (which means approved in our UI)
    await db.update('registrations', { registrationId: req.params.id }, { $set: { status: 'confirmed', approvedAt: new Date() } });

    // Fetch organizer info to get their real name
    const organizer = await db.findOne('users', { username: event.createdBy });
    const organizerDisplayName = organizer ? organizer.name : 'Event Organizer';

    // Send confirmation email
    const subject = `Registration Approved: ${event.title}`;
    const text = `Your registration for ${event.title} as a ${reg.type}${reg.roleName ? ` (${reg.roleName})` : ''} has been successfully approved.

Best Wishes
${organizerDisplayName}`;
    await emailUtil.sendEmail(reg.email, subject, text);

    res.json({ success: true, message: 'Registration approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/reject - Admin: reject registration
router.patch('/:id/reject', authMiddleware, async (req, res) => {
  try {
    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    // Discard registration (set status to cancelled/rejected)
    await db.update('registrations', { registrationId: req.params.id }, { $set: { status: 'cancelled', rejectedAt: new Date() } });
    
    res.json({ success: true, message: 'Registration rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/registrations/my - Get registrations by email
router.get('/my', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const regs = await db.find('registrations', { email: email.toLowerCase(), status: { $ne: 'cancelled' } }, { registeredAt: -1 });
    const enriched = await Promise.all(regs.map(async r => {
      const event = await db.findOne('events', { eventId: r.eventId });
      return { ...r, event: event ? { title: event.title, date: event.date, time: event.time, location: event.location, volunteerRoles: event.volunteerRoles } : null };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/cancel - Cancel registration
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { email } = req.body;
    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (reg.email !== email?.toLowerCase()) return res.status(403).json({ error: 'Unauthorized' });
    if (reg.status === 'cancelled') return res.status(400).json({ error: 'Already cancelled' });

    await db.update('registrations', { registrationId: req.params.id }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
    res.json({ success: true, message: 'Registration cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/swap-request - Request shift swap or transfer to another person
router.patch('/:id/swap-request', async (req, res) => {
  try {
    const { email, requestedRoleId, reason, newPersonEmail, newPersonName, newPersonUsn, otp } = req.body;
    
    // 1. Verify OTP first (sent to the target person: new if transfer, else requester)
    const targetEmail = (newPersonEmail || email).toLowerCase().trim();
    if (!otp) return res.status(400).json({ error: 'OTP is required' });
    const otpDoc = await db.findOne('otps', { email: targetEmail, otp });
    if (!otpDoc || new Date() > new Date(otpDoc.expiresAt)) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    // Delete OTP after use
    await db.remove('otps', { _id: otpDoc._id });

    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (reg.email !== email?.toLowerCase()) return res.status(403).json({ error: 'Unauthorized' });
    if (reg.type !== 'volunteer') return res.status(400).json({ error: 'Only volunteers can request swaps' });

    const updateData = { 
      swapRequested: true, 
      swapRequestedRoleId: requestedRoleId, 
      swapReason: reason, 
      swapRequestedAt: new Date() 
    };

    if (newPersonEmail) {
      updateData.swapRequestedNewEmail = newPersonEmail.toLowerCase().trim();
      updateData.swapRequestedNewName = newPersonName || '';
      updateData.swapRequestedNewUsn = newPersonUsn || '';
    }

    await db.update('registrations', { registrationId: req.params.id }, { $set: updateData });
    res.json({ success: true, message: 'Swap request submitted. Organizer will be notified.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/swap-approve - Admin: approve swap
router.patch('/:id/swap-approve', authMiddleware, async (req, res) => {
  try {
    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    const event = await db.findOne('events', { eventId: reg.eventId });
    
    const targetRoleId = reg.swapRequestedRoleId || reg.roleId;
    const newRole = (event?.volunteerRoles || []).find(r => r.id === targetRoleId);
    
    if (!newRole) {
      await db.update('registrations', { registrationId: req.params.id }, { $set: { swapRequested: false } });
      return res.json({ success: true, message: 'Invalid swap request cleared' });
    }

    // Check slots only if role is changing
    if (targetRoleId !== reg.roleId) {
      const filled = await db.count('registrations', { eventId: reg.eventId, roleId: newRole.id, type: 'volunteer', status: { $ne: 'cancelled' } });
      if (filled >= newRole.slots) return res.status(409).json({ error: 'No slots available in requested role' });
    }
    
    const updateData = { 
      roleId: newRole.id, 
      roleName: newRole.name, 
      swapRequested: false, 
      swapApprovedAt: new Date(),
      // Clear request fields
      swapRequestedRoleId: null,
      swapRequestedNewEmail: null,
      swapRequestedNewName: null,
      swapRequestedNewUsn: null
    };

    const oldName = reg.name;
    const isTransfer = !!reg.swapRequestedNewEmail;
    const targetEmail = reg.swapRequestedNewEmail || reg.email;

    if (isTransfer) {
      updateData.email = reg.swapRequestedNewEmail;
      updateData.name = reg.swapRequestedNewName;
      updateData.usn = reg.swapRequestedNewUsn;
    }

    await db.update('registrations', { registrationId: req.params.id }, { $set: updateData });

    // Send notification email
    const subject = isTransfer ? `Volunteer Transfer Confirmed: ${event.title}` : `Swap Request Approved: ${event.title}`;
    const text = isTransfer 
      ? `Dear ${updateData.name},\n\nYour swap/transfer request has been successfully approved for the event "${event.title}". You have replaced ${oldName} for the role: ${newRole.name}.\n\nBest regards,\nBGMIT Event Team`
      : `Dear ${reg.name},\n\nYour role swap request for "${event.title}" has been approved. Your new role is: ${newRole.name}.\n\nBest regards,\nBGMIT Event Team`;
    
    await emailUtil.sendEmail(targetEmail, subject, text);

    res.json({ success: true, message: isTransfer ? 'Transfer approved' : 'Swap request approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/swap-reject - Admin: reject swap
router.patch('/:id/swap-reject', authMiddleware, async (req, res) => {
  try {
    await db.update('registrations', { registrationId: req.params.id }, { $set: { swapRequested: false, swapRejectedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/checkin - Admin: check-in
router.patch('/:id/checkin', authMiddleware, async (req, res) => {
  try {
    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    const event = await db.findOne('events', { eventId: reg.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer' && event.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { hoursVolunteered } = req.body;
    await db.update('registrations', { registrationId: req.params.id }, { $set: { checkedIn: true, checkinAt: new Date(), hoursVolunteered: parseFloat(hoursVolunteered) || 0 } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/registrations/:id/noshow - Admin: mark no-show
router.patch('/:id/noshow', authMiddleware, async (req, res) => {
  try {
    const reg = await db.findOne('registrations', { registrationId: req.params.id });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    const event = await db.findOne('events', { eventId: reg.eventId });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (req.user.role === 'organizer' && event.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.update('registrations', { registrationId: req.params.id }, { $set: { noShow: true, status: 'no-show' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/registrations/broadcast - Admin: send message to all registered users
router.post('/broadcast', authMiddleware, async (req, res) => {
  console.log('[Broadcast API] Received request:', req.body);
  const { message, eventId, type, teamName, methods, organizer, category } = req.body;
  
  if (!message) return res.status(400).json({ error: 'Message content is required' });

  // If organizer, ensure eventId is provided or filter to their events
  let targetEventIds = [];
  if (req.user.role === 'organizer') {
    const myEvents = await db.find('events', { createdBy: req.user.username });
    targetEventIds = myEvents.map(e => e.eventId);
    if (eventId && !targetEventIds.includes(eventId)) {
      return res.status(403).json({ error: 'Access denied to this event' });
    }
  }

  const targetMethods = (methods && Array.isArray(methods)) ? methods : ['whatsapp'];

  // Send immediate response to avoid browser timeout
  res.status(202).json({ success: true, message: 'Broadcast initiated in background' });

  // Process in background
  (async () => {
    try {
      let query = { status: { $ne: 'cancelled' } };
      
      if (req.user.role === 'organizer') {
        query.eventId = { $in: targetEventIds };
        if (eventId && targetEventIds.includes(eventId)) query.eventId = eventId;
      } else if (organizer) {
        const orgEvents = await db.find('events', { createdBy: organizer });
        const orgEventIds = orgEvents.map(e => e.eventId);
        query.eventId = { $in: orgEventIds };
      }

      if (eventId && !query.eventId) query.eventId = eventId;
      if (type) query.type = type;
      if (teamName) query.teamName = teamName;

      console.log(`[Broadcast Task] Finding registrations for query:`, query);
      let registrations = await db.find('registrations', query);
      
      // Filter by Category on the results
      if (category) {
        const events = await db.find('events', { status: { $ne: 'deleted' } });
        const allEventsMap = {};
        events.forEach(e => allEventsMap[e.eventId] = e);

        registrations = registrations.filter(r => {
          const ev = allEventsMap[r.eventId];
          if (!ev) return false;
          if (category && ev.category !== category) return false;
          return true;
        });
      }

      console.log(`[Broadcast Task] Found ${registrations.length} registrations after filtering`);

      const formattedMessage = `${message}\n\n- BGMIT`;

      // Send via Email
      if (targetMethods.includes('email')) {
        const emails = [...new Set(registrations.map(r => r.email).filter(e => !!e))];
        console.log(`[Broadcast Task] Email sending to ${emails.length} unique addresses...`);
        const subject = eventId ? `Broadcast Message for Event: ${eventId}` : 'Broadcast Message - BGMIT';
        const results = await emailUtil.sendBroadcast(emails, subject, message);
        console.log(`[Broadcast Task] Email completed. Success: ${results.success}, Failure: ${results.failure}`);
      }
    } catch (err) {
      console.error('[Broadcast Task FATAL Error]', err);
    }
  })();
});

// POST /api/registrations/broadcast-certificates - Admin: send certificates to all confirmed registrations for an event
router.post('/broadcast-certificates', authMiddleware, async (req, res) => {
  const { eventId, methods, organizer, category } = req.body;
  
  try {
    // Broaden query to include both confirmed and checked-in users
    // We'll filter more specifically in JS to handle multiple conditions
    let query = { status: { $ne: 'cancelled' } };
    
    if (req.user.role === 'organizer') {
      const myEvents = await db.find('events', { createdBy: req.user.username });
      const myEventIds = myEvents.map(e => e.eventId);
      query.eventId = { $in: myEventIds };
      if (eventId && myEventIds.includes(eventId)) {
        query.eventId = eventId;
      }
    } else if (organizer) {
      const orgEvents = await db.find('events', { createdBy: organizer });
      const orgEventIds = orgEvents.map(e => e.eventId);
      query.eventId = { $in: orgEventIds };
      if (eventId && orgEventIds.includes(eventId)) {
        query.eventId = eventId;
      }
    } else if (eventId) {
      query.eventId = eventId;
    }

    let registrations = await db.find('registrations', query);
    
    // Filter to only those who are either confirmed OR checked-in
    registrations = registrations.filter(r => r.status === 'confirmed' || r.checkedIn === true);

    const events = await db.find('events', { status: { $ne: 'deleted' } });
    const allEventsMap = {};
    events.forEach(e => allEventsMap[e.eventId] = e);

    // Filter by Category on the results
    if (category) {
      registrations = registrations.filter(r => {
        const ev = allEventsMap[r.eventId];
        if (!ev) return false;
        if (category && ev.category !== category) return false;
        return true;
      });
    }

    if (registrations.length === 0) return res.status(404).json({ error: 'No confirmed or checked-in registrations found matching the filters' });

    console.log(`[Cert Broadcast] Starting broadcast to ${registrations.length} registrations...`);
    res.status(202).json({ success: true, message: `Broadcasting certificates to ${registrations.length} registrations initiated` });

    const targetMethods = (methods && Array.isArray(methods)) ? methods : ['email'];

    // Background process
    (async () => {
      console.log(`[Cert Broadcast] Background process started for ${registrations.length} users.`);
      let successCount = 0;
      let failCount = 0;

      for (const reg of registrations) {
        const event = allEventsMap[reg.eventId];
        if (!event) {
          console.warn(`[Cert Broadcast] Skipping registration ${reg.registrationId} - Event not found for eventId: ${reg.eventId}`);
          continue;
        }

        try {
          console.log(`[Cert Broadcast] Processing ${reg.name} (${reg.email}) for Event: ${event.title}`);
          const eventDateStr = new Date(event.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
          
          console.log(`[Cert Broadcast] Generating PDF for ${reg.name}...`);
          const certBuffer = await certUtil.generateCertificatePDF({
            name: reg.name,
            usn: reg.usn,
            eventTitle: event.title,
            eventDate: eventDateStr,
            type: reg.type,
            roleName: reg.roleName,
            photo: reg.photo
          });

          if (!certBuffer || certBuffer.length === 0) {
            throw new Error('Generated certificate buffer is empty');
          }
          console.log(`[Cert Broadcast] PDF generated (${certBuffer.length} bytes)`);

          const filename = `Certificate_${reg.name.replace(/\s+/g, '_')}_${event.title.replace(/\s+/g, '_')}.pdf`;

          // Send via Email
          if (targetMethods.includes('email') && reg.email) {
            const subject = `Certificate of ${reg.type === 'volunteer' ? 'Volunteering' : 'Participation'} - ${event.title}`;
            const text = `Dear ${reg.name},\n\nPlease find attached your certificate for the event: ${event.title}.\n\nBest regards,\nBGMIT Event Team`;
            
            console.log(`[Cert Broadcast] Attempting to send email to ${reg.email}...`);
            const emailResult = await emailUtil.sendEmail(
              reg.email,
              subject,
              text,
              null,
              [{ filename, content: certBuffer }]
            );
            
            if (emailResult.error) {
              console.error(`[Cert Broadcast] Email failed for ${reg.email}: ${emailResult.error}`);
              failCount++;
            } else {
              console.log(`[Cert Broadcast] Email sent successfully to ${reg.email}`);
              successCount++;
            }
          } else {
            console.warn(`[Cert Broadcast] Skipping email for ${reg.name} - No email provided or email method not selected`);
          }

          // Small delay between sends
          await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
          console.error(`[Cert Broadcast Error] User ${reg.email} for event ${event.title}:`, err.stack || err.message);
          failCount++;
        }
      }
      console.log(`[Cert Broadcast] Completed. Success: ${successCount}, Failures: ${failCount}`);
    })();
  } catch (err) {
    console.error('[Cert Broadcast FATAL]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// GET /api/registrations/all - Admin: all registrations
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const { eventId, organizer, category, startDate, endDate, type } = req.query;
    let query = {};
    
    // If organizer, restrict to their events
    if (req.user.role === 'organizer') {
      const myEvents = await db.find('events', { createdBy: req.user.username });
      const myEventIds = myEvents.map(e => e.eventId);
      query.eventId = { $in: myEventIds };
    } else if (organizer) {
      // Admin filtering by organizer
      const orgEvents = await db.find('events', { createdBy: organizer });
      const orgEventIds = orgEvents.map(e => e.eventId);
      query.eventId = { $in: orgEventIds };
    }

    if (eventId) query.eventId = eventId;
    if (type && type !== 'all') query.type = type;

    let regs = await db.find('registrations', query, { registeredAt: -1 });
    
    // Fetch events to filter by category and date if needed
    const allEventsMap = {};
    const events = await db.find('events', { status: { $ne: 'deleted' } });
    events.forEach(e => allEventsMap[e.eventId] = e);

    // Filter by Category and Date on the results
    if (category || startDate || endDate) {
      regs = regs.filter(r => {
        const ev = allEventsMap[r.eventId];
        if (!ev) return false;
        
        if (category && ev.category !== category) return false;
        if (startDate && new Date(ev.date) < new Date(startDate)) return false;
        if (endDate && new Date(ev.date) > new Date(endDate)) return false;
        
        return true;
      });
    }

    const enriched = regs.map(r => {
      const event = allEventsMap[r.eventId];
      return { ...r, eventTitle: event?.title, eventCategory: event?.category, eventDate: event?.date };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/registrations/swap-requests - Admin: pending swaps
router.get('/swap-requests', authMiddleware, async (req, res) => {
  try {
    let query = { swapRequested: true };
    if (req.user.role === 'organizer') {
      const myEvents = await db.find('events', { createdBy: req.user.username });
      const myEventIds = myEvents.map(e => e.eventId);
      query.eventId = { $in: myEventIds };
    }

    const regs = await db.find('registrations', query, { swapRequestedAt: -1 });
    const enriched = await Promise.all(regs.map(async r => {
      const event = await db.findOne('events', { eventId: r.eventId });
      const newRole = (event?.volunteerRoles || []).find(rl => rl.id === r.swapRequestedRoleId);
      return { ...r, eventTitle: event?.title, requestedRoleName: newRole?.name };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
