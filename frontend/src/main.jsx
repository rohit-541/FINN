import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Splash: the app calls window.finnReady() once the first screen has its data. The splash stays
// at least 450 ms so it never flickers, and leaves after 9 s whatever happens.
const splash = document.getElementById('splash');
const shownAt = performance.now();
let splashGone = false;
window.finnReady = () => {
  if (splashGone || !splash) return;
  splashGone = true;
  setTimeout(() => {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 420);
  }, Math.max(0, 450 - (performance.now() - shownAt)));
};
setTimeout(() => window.finnReady(), 9000);

// Zoom lock. The viewport meta stops pinch and double-tap zoom on Android; iOS Safari ignores
// user-scalable, so its pinch gesture is cancelled here (double-tap is handled by touch-action in CSS).
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

// Installable app: the service worker is only registered on a built site, so it never
// caches Vite's dev modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Chrome and Edge fire this when the app can be installed. Keep the event so the
// "Install FINN" button can use it later.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.finnInstall = e;
  window.dispatchEvent(new Event('finn-installable'));
});
