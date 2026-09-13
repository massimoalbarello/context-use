import '@fontsource-variable/dm-sans';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LandingPage } from './page';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
