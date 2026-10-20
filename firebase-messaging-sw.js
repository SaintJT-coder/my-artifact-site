/* PickSlip Web Push service worker — scope is the GitHub Pages app directory. */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
 apiKey:"AIzaSyA4Z1PnKxXnTVJ_G-XCGse323DiUhkwhwI",
 authDomain:"pickslip-4e265.firebaseapp.com",
 projectId:"pickslip-4e265",
 storageBucket:"pickslip-4e265.firebasestorage.app",
 messagingSenderId:"893144261549",
 appId:"1:893144261549:web:d3624341a6777ad2963724"
});
firebase.messaging();
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const url=new URL("./",self.registration.scope).href;
 event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{
  const existing=windows.find(w=>w.url.startsWith(url));
  return existing?existing.focus():clients.openWindow(url);
 }));
});
