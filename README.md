# 🎉 EventVault — Event Scheduling & Volunteer Sign-up App

A full-stack web application for managing events, volunteer sign-ups, and participation tracking.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Server runs at: http://localhost:3000
```

## 🔐 Default Admin Credentials
- **URL**: `http://localhost:3000/admin`
- **Username**: `admin`
- **Password**: `admin123`

## 📋 Features

### Organizer Panel (`/admin`)
- ✅ Secure JWT login authentication
- ✅ Create/edit/delete events with full details
- ✅ Define volunteer roles with fixed slot counts
- ✅ Automatic QR code generation linking to sign-up page
- ✅ View all registrations in table format
- ✅ Export registrations to CSV
- ✅ Check-in volunteers and mark no-shows
- ✅ Approve shift swap requests
- ✅ Analytics dashboard (volunteer coverage %, no-shows, hours)
- ✅ Top volunteers leaderboard
- ✅ Generate participation certificates (opens printable page)

### Volunteer & Participant Panel (`/`)
- ✅ Browse all events with category filters
- ✅ Sign up as volunteer (choose role) or participant
- ✅ Real-time slot availability display
- ✅ View and manage personal registrations by email
- ✅ Cancel registrations
- ✅ Request shift swaps (notifies organizer)

### QR Code Sign-up (`/signup/:eventId`)
- ✅ Mobile-optimized sign-up page
- ✅ Accessible via QR code scan
- ✅ Same sign-up flow optimized for mobile

### Notifications
- ✅ WhatsApp confirmation on registration (via Twilio)
- ✅ 24-hour reminder before event (cron job)
- ✅ 1-hour reminder before event (cron job)
- ✅ Simulated mode if Twilio not configured (logs to console)

## 🔧 WhatsApp Setup (Optional)

1. Sign up at [twilio.com](https://twilio.com)
2. Enable **WhatsApp Sandbox** in your Twilio console
3. Add credentials to `.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxx
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   ```

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | NeDB (embedded, file-based) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| QR Codes | qrcode npm package |
| Notifications | Twilio WhatsApp API |
| Scheduling | node-cron |
| CSV Export | csv-stringify |
| Frontend | Vanilla HTML/CSS/JS |

## 📁 Project Structure

```
event-app/
├── server.js              # Express server entry point
├── routes/
│   ├── auth.js            # Login/verify endpoints
│   ├── events.js          # Event CRUD + QR + CSV
│   ├── registrations.js   # Sign-up, cancel, swap, check-in
│   └── analytics.js       # Dashboard stats
├── middleware/
│   └── auth.js            # JWT middleware
├── utils/
│   ├── database.js        # NeDB setup + helpers
│   ├── whatsapp.js        # Twilio WhatsApp service
│   └── reminders.js       # Scheduled reminder logic
├── public/
│   ├── index.html         # Volunteer & Participant Panel
│   ├── admin.html         # Organizer Dashboard
│   └── signup.html        # QR Code Sign-up Page
├── data/                  # NeDB database files (auto-created)
└── .env                   # Environment variables
```

## 🌐 API Endpoints

### Auth
- `POST /api/auth/login` — Admin login
- `GET /api/auth/verify` — Verify JWT token

### Events
- `GET /api/events` — List all events (public)
- `GET /api/events/:id` — Get single event (public)
- `POST /api/events` — Create event (admin)
- `PUT /api/events/:id` — Update event (admin)
- `DELETE /api/events/:id` — Delete event (admin)
- `GET /api/events/:id/registrations` — Get event registrations (admin)
- `GET /api/events/:id/registrations/csv` — Export CSV (admin)

### Registrations
- `POST /api/registrations` — Sign up
- `GET /api/registrations/my?email=` — My registrations
- `GET /api/registrations/all` — All registrations (admin)
- `PATCH /api/registrations/:id/cancel` — Cancel
- `PATCH /api/registrations/:id/swap-request` — Request swap
- `PATCH /api/registrations/:id/swap-approve` — Approve swap (admin)
- `PATCH /api/registrations/:id/checkin` — Check-in (admin)
- `PATCH /api/registrations/:id/noshow` — Mark no-show (admin)
- `GET /api/registrations/swap-requests` — Pending swaps (admin)

### Analytics
- `GET /api/analytics/overview` — Dashboard stats (admin)
- `GET /api/analytics/events` — Per-event stats (admin)
- `GET /api/analytics/top-volunteers` — Top volunteers (admin)
