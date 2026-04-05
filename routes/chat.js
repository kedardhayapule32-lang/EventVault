const router = require('express').Router();
const db = require('../utils/database');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- GEMINI SETUP ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
  console.log('✅ Gemini API Key detected. Initializing...');
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: "gemini-pro" });
} else {
  console.error('❌ GEMINI_API_KEY is missing from environment variables!');
}

router.post('/', async (req, res) => {
  const { message, email, usn } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const input = message.toLowerCase().trim();
  let reply = "";

  try {
    // --- 1. CONTEXT LOADING ---
    const allEvents = await db.find('events', { status: { $ne: 'deleted' } });
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Categorize events (excluding supportive teams from general lists)
    const upcomingEvents = allEvents
      .filter(e => !e.isSupportiveTeam && new Date(e.date).setHours(23,59,59,999) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 15);
      
    const pastEvents = allEvents
      .filter(e => !e.isSupportiveTeam && new Date(e.date).setHours(23,59,59,999) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    const todayEvents = allEvents.filter(e => !e.isSupportiveTeam && e.date === todayStr);

    const supportiveTeams = allEvents.filter(e => e.isSupportiveTeam === true);

    // Identify if a specific item (Event or Supportive Team) is mentioned
    let mentionedItem = null;
    const allItems = [...allEvents];
    const sortedForMatching = allItems.sort((a, b) => b.title.length - a.title.length);
    for (const item of sortedForMatching) {
      const escapedTitle = item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedTitle}\\b`, 'i');
      if (regex.test(input)) {
        mentionedItem = item;
        break;
      }
    }

    // Fuzzy match
    if (!mentionedItem) {
      mentionedItem = allItems.find(item => {
        const words = item.title.toLowerCase().split(/\s+/);
        return words.some(word => word.length > 3 && new RegExp(`\\b${word}\\b`, 'i').test(input));
      });
    }

    // Load organizer for mentioned item
    let organizerInfo = { name: "Organizer", email: "bgmitcs034@gmail.com", phone: "+91 6363338238" };
    if (mentionedItem) {
      const organizer = await db.findOne('users', { username: mentionedItem.createdBy });
      if (organizer) {
        organizerInfo = { name: organizer.name, email: organizer.email, phone: organizer.phone || "+91 6363338238" };
      } else {
        organizerInfo = { name: mentionedItem.createdBy, email: mentionedItem.createdBy, phone: "+91 6363338238" };
      }
    }

    // User Data
    let currentUser = null;
    let registrations = [];
    if (email) {
      currentUser = await db.findOne('registered_users', { email: email.toLowerCase() });
      registrations = await db.find('registrations', { email: email.toLowerCase(), status: { $ne: 'cancelled' } });
    }

    // --- 2. RESPONSE GENERATION ---

    // A. GREETINGS
    if (input.match(/\b(hi|hello|hey|greetings|morning|evening|afternoon|yo)\b/)) {
      const name = currentUser ? currentUser.name.split(' ')[0] : '';
      reply = `Hello${name ? ' ' + name : ''}! I'm the EventVault AI. How can I assist you with events, registrations, or supportive teams today?`;
    }

    // B. DEVELOPER & SUPPORT
    else if (input.includes('who developed') || input.includes('creator') || input.includes('who made') || input.includes('developer')) {
      reply = "EventVault was developed by <b>Anupama S H</b>, <b>Kedar K D</b> (6th Sem), and <b>Amogh I Y</b> (4th Sem) from the <b>CSE Department</b> at BGMIT.";
    }
    else if ((input.includes('admin') || input.includes('panel')) && (input.includes('password') || input.includes('login') || input.includes('cred'))) {
      reply = "I'm sorry, but since this is a sensitive matter, I cannot share any information related to it.";
    }
    else if (input.includes('supportive team') || (input.includes('supportive') && input.includes('team'))) {
      if (supportiveTeams.length > 0) {
        reply = "We have the following <b>Supportive Teams</b> you can join:<br>" + 
                supportiveTeams.map(t => `- <b>${t.title}</b> (Handling by: ${t.createdBy.replace('admin@eventvault.org', 'bgmitcs034@gmail.com')})`).join('<br>') +
                "<br>Click the blue <b>Supportive Teams</b> button on the home page to join!";
      } else {
        reply = "There are currently no active <b>Supportive Teams</b>. Check back later!";
      }
    }
    else if (input.includes('contact') || input.includes('technical support') || (input.includes('help') && !input.includes('event'))) {
      reply = "For technical issues, contact the admin at <b>bgmitcs034@gmail.com</b> (Contact: +91 6363338238) or visit the CSE Department.";
    }

    // FALLBACK TO GEMINI (Primary NLP engine)
    if (!reply && model) {
      try {
        const context = `
You are "EventVault AI", the official assistant for BGMIT's Event Management System.
Current Date: ${todayStr}

UPCOMING EVENTS:
${upcomingEvents.length > 0 ? upcomingEvents.map(e => `- ${e.title}: ${e.date} at ${e.time}, Venue: ${e.location}, Cat: ${e.category}, Mode: ${e.teamMode}`).join('\n') : 'No upcoming events.'}

SUPPORTIVE TEAMS (Volunteering groups):
${supportiveTeams.length > 0 ? supportiveTeams.map(t => `- ${t.title}: Venue: ${t.location}, Role: ${t.volunteerRoles ? t.volunteerRoles.map(r=>r.name).join(', ') : 'Volunteer'}, Handling by: ${t.createdBy.replace('admin@eventvault.org', 'bgmitcs034@gmail.com')}, Description: ${t.description}`).join('\n') : 'No active supportive teams.'}

PAST EVENTS:
${pastEvents.length > 0 ? pastEvents.map(e => `- ${e.title}: held on ${e.date}`).join('\n') : 'No past event records.'}

${mentionedItem ? `USER IS ASKING ABOUT: ${mentionedItem.title}
- Type: ${mentionedItem.isSupportiveTeam ? 'Supportive Team' : 'General Event'}
- Handling/Organizer: ${organizerInfo.name} (${organizerInfo.email.replace('admin@eventvault.org', 'bgmitcs034@gmail.com')})
- Contact: ${organizerInfo.phone}
- Details: ${mentionedItem.description || 'N/A'}
- Registration Type: ${mentionedItem.isSupportiveTeam ? 'Supportive Team Join' : 'Event Registration'}` : ''}

USER PROFILE:
- Name: ${currentUser ? currentUser.name : 'Guest'}
- Registrations: ${registrations.length > 0 ? registrations.map(r => r.eventId).join(', ') : 'None'}

PLATFORM NAVIGATION & RULES:
1. Register for Events: Click "Upcoming Events" (green button) -> "Register Now". Requires Email OTP.
2. Join Supportive Teams: Click "Supportive Teams" (blue outline button) -> "Join Team". Requires Email OTP.
3. Certificates: Sent to your REGISTERED EMAIL only after event completion. NOT downloadable.
4. Team Events: Leader creates team (name/password), members join with same name/password.

INSTRUCTIONS:
- Be concise (2-4 sentences).
- Use <b>...</b> for event names, buttons, and venues.
- Use <br> for lines.
- Always provide specific details from the lists above.
- If asking for registration for a supportive team, specify the "Supportive Teams" button.
- If asking for organizer/faculty/handling, provide: ${organizerInfo.name} (${organizerInfo.email}, Contact: ${organizerInfo.phone}).
- If asked about "supportive teams" generally, list them and mention they are handled by their respective creators.

User: "${message}"
`;
        const result = await model.generateContent(context);
        const response = await result.response;
        reply = response.text();
      } catch (geminiErr) {
        console.error('Gemini error:', geminiErr);
        reply = "I'm having trouble connecting to my brain! Please try again or contact <b>bgmitcs034@gmail.com</b>.";
      }
    }

    // LAST RESORT FALLBACK
    if (!reply) {
      reply = "I'm sorry, I didn't quite catch that. I can help with event info, registration, certificates, and more. Could you please rephrase your question?";
    }

  } catch (err) {
    console.error('Chat error:', err);
    reply = "I'm experiencing a bit of a glitch. Please try again in a moment!";
  }

  res.json({ reply });
});

module.exports = router;
