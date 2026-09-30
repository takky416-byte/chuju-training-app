importScripts("https://www.gstatic.com/firebasejs/12.2.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.2.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC0yy1vbS-5sIW5gd93XRIFJTBEh9Qd6kU",
  authDomain: "aichi-jh-training-507310.firebaseapp.com",
  projectId: "aichi-jh-training-507310",
  storageBucket: "aichi-jh-training-507310.firebasestorage.app",
  messagingSenderId: "127127795519",
  appId: "1:127127795519:web:8ff9820a7321a80e4f458a",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "適性検査トレーニング";
  const body = payload.notification?.body || "";
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.data?.tag || "aichi-training",
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((client) => "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })
  );
});
