# Event App Sports Category Updates - TODO

## Approved Plan Summary
- Add Individual/Team toggle for Sports events in admin.html
- Backend support for teamMode in events.js  
- Update participant registration in signup.html (team name only for team events)
- Adjust registrations.js backend handling

## Steps (0/8 completed)

### 1. [x] Update public/admin.html 
   - Add eventType select (Individual/Team) after category, conditional on Sports
   - New show/hide logic for team-size-container
   - Include teamMode in saveEvent() body

### 2. [x] Update routes/events.js 
   - Store teamMode field
   - teamSize = teamMode=='team' ? parseInt(teamSize)||0 : 0

### 3. [x] Update event GET endpoints to include teamMode (automatic via ...ev)

### 4. [x] Update public/signup.html 
   - participant + Sports + teamMode=='team': team name input only (no multi-members)
   - Add password field

### 5. [x] Update routes/registrations.js 
   - Handle teamName for individual team registrations
   - Optional password storage

### 6. [ ] Test event creation (individual vs team Sports)

### 7. [ ] Test registration flows

### 8. [ ] Update stats/admin displays if needed

**Next step: Edit public/admin.html**

