const router = require('express').Router();
const db = require('../utils/database');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- GEMINI SETUP ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
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
    
    // Categorize events
    const upcomingEvents = allEvents
      .filter(e => new Date(e.date).setHours(23,59,59,999) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 15); // Limit to 15 upcoming
      
    const pastEvents = allEvents
      .filter(e => new Date(e.date).setHours(23,59,59,999) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date)) // Most recent past events first
      .slice(0, 10); // Limit to 10 past

    const todayEvents = allEvents.filter(e => e.date === todayStr);

    // Identify if a specific event is mentioned using word boundaries
    let mentionedEvent = null;
    // Sort all events by title length descending to match more specific titles first
    const sortedForMatching = [...allEvents].sort((a, b) => b.title.length - a.title.length);
    for (const ev of sortedForMatching) {
      const escapedTitle = ev.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedTitle}\\b`, 'i');
      if (regex.test(input)) {
        mentionedEvent = ev;
        break;
      }
    }

    // Fuzzy match if no direct match (e.g., "dance" for "Dance Competition")
    if (!mentionedEvent) {
      mentionedEvent = allEvents.find(ev => {
        const words = ev.title.toLowerCase().split(/\s+/);
        return words.some(word => {
          if (word.length <= 3) return false;
          const regex = new RegExp(`\\b${word}\\b`, 'i');
          return regex.test(input);
        });
      });
    }

    // Load organizer details if an event is mentioned
    let organizerName = "";
    let organizerEmail = "";
    if (mentionedEvent) {
      const organizer = await db.findOne('users', { username: mentionedEvent.createdBy });
      organizerName = organizer ? organizer.name : mentionedEvent.createdBy;
      organizerEmail = organizer ? organizer.email : "bgmitcs034@gmail.com";
    }

    // User Data
    let currentUser = null;
    let registrations = [];
    if (email) {
      currentUser = await db.findOne('registered_users', { email: email.toLowerCase() });
      registrations = await db.find('registrations', { email: email.toLowerCase(), status: { $ne: 'cancelled' } });
    }

    // --- 2. INTENT CLASSIFICATION & RESPONSE GENERATION (Rule-based first) ---

    // A. GREETINGS & CONVERSATION
    if (input.match(/\b(hi|hello|hey|greetings|morning|evening|afternoon|yo)\b/)) {
      const name = currentUser ? currentUser.name.split(' ')[0] : '';
      reply = `Hello${name ? ' ' + name : ''}! I'm the official EventVault AI. How can I assist you with events, registrations, or certificates today?`;
    }
    else if (input.match(/\b(how are you|how's it going|how are things)\b/)) {
      reply = "I'm doing great, thank you for asking! I'm here and ready to help you with anything related to EventVault. What's on your mind?";
    }
    else if (input.match(/\b(thank you|thanks|thx|cool|great|awesome)\b/)) {
      reply = "You're very welcome! Is there anything else I can help you with?";
    }
    else if (input.match(/\b(bye|goodbye|see you|tata)\b/)) {
      reply = "Goodbye! Have a wonderful day, and feel free to come back if you have more questions about our events.";
    }

    // B. EVENT QUERIES (General)
    else if (input.includes('upcoming event') || input.includes('what events are available') || input.includes('available event') || (input.includes('list') && input.includes('event'))) {
      if (upcomingEvents.length > 0) {
        const list = upcomingEvents.slice(0, 5).map(e => `• <b>${e.title}</b> (${new Date(e.date).toLocaleDateString('en-IN', {day:'numeric', month:'short'})})`).join('<br>');
        reply = `We have ${upcomingEvents.length} upcoming events!<br>${list}<br><br>You can view all details on the <b>Upcoming Events</b> page by clicking the green button on the home page.`;
      } else {
        reply = "Currently, there are no upcoming events listed. However, you can check our <b>Past Events</b> to see what we've hosted recently!";
      }
    }
    else if (input.includes('past event') || input.includes('previous event') || input.includes('history')) {
      if (pastEvents.length > 0) {
        const list = pastEvents.slice(0, 5).map(e => `• <b>${e.title}</b> (${new Date(e.date).toLocaleDateString('en-IN', {day:'numeric', month:'short'})})`).join('<br>');
        reply = `Here are some of our recent past events:<br>${list}<br><br>You can find the full list in the <b>Past Events</b> section on the home page.`;
      } else {
        reply = "No past events found in our records.";
      }
    }
    else if (input.match(/\b(today|tonight)\b/) && input.includes('event')) {
      if (todayEvents.length > 0) {
        reply = `Events happening today (${todayStr}):<br>${todayEvents.map(e => `• <b>${e.title}</b> at ${e.time} (${e.location})`).join('<br>')}`;
      } else {
        reply = "There are no events scheduled for today. Check the <b>Upcoming Events</b> section for future dates!";
      }
    }
    else if (input.match(/\b(technical|tech)\b/) && input.includes('event')) {
      const tech = upcomingEvents.filter(e => e.category === 'Technical');
      if (tech.length > 0) reply = `We have ${tech.length} upcoming technical events:<br>${tech.map(e => `• <b>${e.title}</b>`).join('<br>')}`;
      else reply = "No upcoming technical events found. We usually host workshops, hackathons, and seminars!";
    }
    else if (input.match(/\b(cultural|cult)\b/) && input.includes('event')) {
      const cult = upcomingEvents.filter(e => e.category === 'Cultural');
      if (cult.length > 0) reply = `Upcoming cultural events:<br>${cult.map(e => `• <b>${e.title}</b>`).join('<br>')}`;
      else reply = "No upcoming cultural events found. Stay tuned for fests and celebrations!";
    }
    else if (input.match(/\b(sports|sport|game|games)\b/) && input.includes('event')) {
      const sports = upcomingEvents.filter(e => e.category === 'Sports');
      if (sports.length > 0) reply = `Upcoming sports events:<br>${sports.map(e => `• <b>${e.title}</b>`).join('<br>')}`;
      else reply = "No upcoming sports events found. Check back later for tournaments!";
    }

    // C. SPECIFIC EVENT INFO (Only if we are sure user is asking about it)
    else if (mentionedEvent && (input.includes('detail') || input.includes('about') || input.includes('tell me') || input.includes('info') || input.includes('organizer') || input.includes('faculty') || input.includes('teacher') || input.includes('contact') || input.includes('meet') || input.includes('when') || input.includes('where') || input.includes('time') || input.includes('location') || input.includes('fee') || input.includes('prize') || input.includes('team') || input.includes('individual'))) {
      const ev = mentionedEvent;
      const date = new Date(ev.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const isPast = new Date(ev.date).setHours(23,59,59,999) < now;
      
      if (input.includes('contact') || input.includes('meet') || input.includes('email')) {
        reply = `You can contact the organizer of <b>${ev.title}</b>, <b>${organizerName}</b>, at <b>${organizerEmail}</b> to discuss meeting or any queries.`;
      } else if (input.includes('organizer') || input.includes('faculty') || input.includes('teacher') || input.includes('who is organizing')) {
        reply = `The event <b>${ev.title}</b> is organized by <b>${organizerName}</b>.`;
      } else if (input.includes('where') || input.includes('location') || input.includes('venue')) {
        reply = `<b>${ev.title}</b> ${isPast ? 'was' : 'will be'} held at <b>${ev.location}</b>.`;
      } else if (input.includes('when') || input.includes('time') || input.includes('date')) {
        reply = `<b>${ev.title}</b> ${isPast ? 'was' : 'is'} scheduled for <b>${date}</b> at <b>${ev.time}</b>.`;
      } else if (input.includes('fee') || input.includes('price') || input.includes('cost')) {
        reply = `For <b>${ev.title}</b>, the description says: ${ev.description ? ev.description.substring(0, 100) + '...' : 'No fee mentioned'}. Please check the official event card for exact fee details.`;
      } else if (input.includes('prize') || input.includes('reward')) {
        reply = `Participants of <b>${ev.title}</b> will receive official certificates. Specific prize details (if any) are usually mentioned in the event description.`;
      } else if (input.includes('individual') || input.includes('team') || input.includes('size')) {
        reply = `<b>${ev.title}</b> is an <b>${ev.teamMode}</b> event. ${ev.teamMode === 'team' ? `(Maximum Team Size: ${ev.teamSize})` : ''}`;
      } else {
        reply = `<b>Event:</b> ${ev.title}<br><b>Status:</b> ${isPast ? 'Past Event' : 'Upcoming Event'}<br><b>Date:</b> ${date}<br><b>Time:</b> ${ev.time}<br><b>Location:</b> ${ev.location}<br><b>Organizer:</b> ${organizerName} (${organizerEmail})<br><b>Description:</b> ${ev.description || 'N/A'}`;
      }
    }

    // D. REGISTRATION QUERIES
    else if (input.match(/\b(how|where)\b/) && (input.includes('register') || input.includes('sign up') || input.includes('join'))) {
      if (mentionedEvent) {
        const isPast = new Date(mentionedEvent.date).setHours(23,59,59,999) < now;
        if (isPast) {
          reply = `I'm sorry, registrations for <b>${mentionedEvent.title}</b> are closed as the event has already passed.`;
        } else {
          reply = `To register for <b>${mentionedEvent.title}</b>:<br>1. Go to the home page.<br>2. Click on the green <b>Upcoming Events</b> button.<br>3. Locate the <b>${mentionedEvent.title}</b> card.<br>4. Click <b>Register Now</b> and follow the prompts.`;
        }
      } else {
        reply = "To register for any event:<br>1. Click <b>Upcoming Events</b> on the home page.<br>2. Find your preferred event.<br>3. Click <b>Register Now</b>.<br>4. Enter your details and verify with the OTP sent to your email.";
      }
    }
    else if (input.includes('registration status') || input.includes('am i registered') || input.includes('my registration')) {
      if (!email) {
        reply = "To check your registration status, please click the <b>My Sign Ups</b> button on the home page and sign in with your email.";
      } else {
        const regs = await db.find('registrations', { email: email.toLowerCase(), status: { $ne: 'cancelled' } });
        if (regs.length > 0) {
          const regDetails = await Promise.all(regs.map(async r => {
            const ev = await db.findOne('events', { eventId: r.eventId });
            return `• ${r.type === 'volunteer' ? 'Volunteer' : 'Participant'} for <b>${ev ? ev.title : 'Event ID ' + r.eventId}</b>`;
          }));
          reply = `You have ${regs.length} active registration(s):<br>${regDetails.join('<br>')}`;
        } else {
          reply = "I couldn't find any active registrations for your email. If you just registered, it might take a moment to reflect.";
        }
      }
    }

    // E. CERTIFICATE & WINNER QUERIES
    else if (input.includes('certificate')) {
      reply = "<b>Certificates Info:</b><br>• Certificates are NOT downloadable from the website.<br>• They are sent <b>directly to your registered email</b> after the organizer approves your participation.<br>• Ensure you checked in during the event!";
    }
    else if (input.includes('who won') || input.includes('winner') || input.includes('result')) {
      if (mentionedEvent) {
        if (mentionedEvent.results) {
          reply = `The results for <b>${mentionedEvent.title}</b> are available! You can view them in the <b>Achievements</b> section on the home page.`;
        } else {
          reply = `The results for <b>${mentionedEvent.title}</b> haven't been uploaded yet. Please keep an eye on the <b>Achievements</b> section.`;
        }
      } else {
        reply = "You can view all event winners and highlights in the <b>Achievements</b> (yellow button) section on the home page.";
      }
    }

    // F. ORGANIZER & DEVELOPER
    else if (input.includes('who developed') || input.includes('creator') || input.includes('who made') || input.includes('developer')) {
      reply = "EventVault was developed by <b>Anupama S H</b>, <b>Kedar K D</b> (6th Sem), and <b>Amogh I Y</b> (4th Sem) from the <b>CSE Department</b> at BGMIT.";
    }
    else if (input.includes('contact') || input.includes('support') || input.includes('help')) {
      reply = "For any technical issues or inquiries, you can contact the admin at <b>bgmitcs034@gmail.com</b> or visit the CSE Department.";
    }

    // FALLBACK TO GEMINI (If rule didn't produce a reply and key is available)
    if (!reply && model) {
      try {
        const context = `
You are the "EventVault AI Assistant", a friendly and helpful expert for the BGMIT Event Management System.
Your goal is to help students and organizers with event information, registration, and platform navigation.

Current Date: ${todayStr}

UPCOMING EVENTS:
${upcomingEvents.length > 0 ? upcomingEvents.map(e => `- ${e.title}: ${e.date} at ${e.time}, Location: ${e.location}, Category: ${e.category}, Mode: ${e.teamMode}, Organizer: ${organizerName} (${organizerEmail})`).join('\n') : 'No upcoming events.'}

PAST EVENTS:
${pastEvents.length > 0 ? pastEvents.map(e => `- ${e.title}: held on ${e.date}, Category: ${e.category}`).join('\n') : 'No past events records.'}

USER INFO:
- Name: ${currentUser ? currentUser.name : 'Guest User'}
- Email: ${email || 'Not provided'}
- Registrations: ${registrations.length > 0 ? registrations.map(r => r.eventId).join(', ') : 'None'}

PLATFORM RULES:
1. Registration: Requires Email & OTP. Click "Upcoming Events" -> "Register Now".
2. Certificates: Sent via EMAIL only after event completion and organizer approval. Not downloadable.
3. Team Events: One member creates the team (name/password), others join using same credentials.
4. Support: Email bgmitcs034@gmail.com for help.
5. Developers: Anupama S H, Kedar K D, Amogh I Y (CSE Dept).

INSTRUCTIONS:
- Use <b>...</b> for emphasis (event names, dates, buttons).
- Use <br> for new lines.
- Keep responses concise (max 3-4 sentences unless listing).
- If the user asks about a specific event not listed, inform them we only have records for the events mentioned above.
- If the user asks how to contact or meet an organizer, provide their name and email: ${organizerName} (${organizerEmail}).

User Question: "${message}"
`;
        const result = await model.generateContent(context);
        const response = await result.response;
        reply = response.text();
      } catch (geminiErr) {
        console.error('Gemini call failed:', geminiErr);
        reply = "I'm having trouble thinking right now. Please check if you are asking about an event that exists, or try rephrasing your question. For support, contact <b>bgmitcs034@gmail.com</b>.";
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
