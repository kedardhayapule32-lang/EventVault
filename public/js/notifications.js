// Browser notification API
const requestNotificationPermission = async () => {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
};

const showBrowserNotification = (title, body) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
    });
  }
};

// Schedule reminder notifications
const scheduleReminders = (events, volunteers) => {
  const now = new Date();
  
  volunteers.forEach(volunteer => {
    if (volunteer.status !== 'approved' && volunteer.status !== 'confirmed') return;
    
    const event = events.find(e => e.eventId === volunteer.eventId);
    if (!event) return;

    const eventDate = new Date(event.date);
    const [hours, minutes] = (event.time || "00:00").split(':');
    eventDate.setHours(parseInt(hours) || 0, parseInt(minutes) || 0);

    // Calculate time until 24 hours before event
    const reminderTime = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000);
    const timeUntilReminder = reminderTime.getTime() - now.getTime();

    // If reminder time is in the future and within the next 7 days
    if (timeUntilReminder > 0 && timeUntilReminder < 7 * 24 * 60 * 60 * 1000) {
      setTimeout(() => {
        showBrowserNotification(
          '⏰ Event Reminder',
          `${event.title} is happening tomorrow at ${event.time}!`
        );
      }, Math.min(timeUntilReminder, 2147483647)); // Max setTimeout value
    }
  });
};

// Create notification object
const createNotification = (userId, type, eventId, message) => {
  return {
    id: Date.now().toString() + Math.random(),
    userId,
    type,
    eventId,
    message,
    createdAt: new Date().toISOString(),
    read: false,
  };
};
