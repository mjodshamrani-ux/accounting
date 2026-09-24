import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/page';
import { LanguageProvider } from './lib/i18n/context';
import { applyDocumentLanguage, storedLanguage } from './lib/i18n/language';
import './app/globals.css';

// Set lang/dir before the first render, so a saved English preference never
// paints one frame in the other direction.
const lang = storedLanguage();
applyDocumentLanguage(lang);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider initial={lang}>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
