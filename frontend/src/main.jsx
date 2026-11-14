import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

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
