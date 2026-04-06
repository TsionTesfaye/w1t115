import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Register the integration simulator Service Worker.
// The SW intercepts /api/simulate/** fetch requests and routes them to
// simulated endpoint handlers backed by the shared TalentBridgeDB IDB.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
    console.warn('[TalentBridge] Integration simulator SW registration failed:', err);
  });
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
