/* KomiNovel v1.12 — Service Worker untuk Push Notification (FCM)
   Letakkan file ini di ROOT website (sejajar dengan index.html). */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDmAEREMEbxAFFBXGzwC25C6_Fty_3x7h0",
  authDomain: "manzcodewebsite.firebaseapp.com",
  projectId: "manzcodewebsite",
  storageBucket: "manzcodewebsite.firebasestorage.app",
  messagingSenderId: "645735217075",
  appId: "1:645735217075:web:9c01b1c18b3157c7a4bdc6"
});

const messaging = firebase.messaging();
const DEFAULT_ICON = 'https://i.ibb.co.com/SDTthJ7m/Gemini-Generated-Image-fhupt4fhupt4fhup.jpg';

// Server mengirim pesan "data-only", jadi tampilan notifikasi diatur di sini
// (tidak akan dobel dan klik bisa langsung membuka karya/chat yang tepat).
messaging.onBackgroundMessage((payload) => {
  const d = (payload && payload.data) || {};
  if (!d.title) return;
  const options = {
    body: d.body || '',
    icon: d.icon || DEFAULT_ICON,
    badge: DEFAULT_ICON,
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' }
  };
  if (d.image) options.image = d.image;
  return self.registration.showNotification(d.title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) {
        try { await c.focus(); } catch (e) {}
        try { if ('navigate' in c) await c.navigate(target); } catch (e) {}
        return;
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
