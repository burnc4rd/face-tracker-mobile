import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Initialize Google Analytics (GA4) if measurement ID is provided at build time
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
if (GA_ID) {
  const gtagScript = document.createElement('script');
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(gtagScript);

  window.dataLayer = window.dataLayer || [];
  const gtag = (...args) => window.dataLayer.push(args);
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID);
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


