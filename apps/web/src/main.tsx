// Inter servie par le tableau de bord : Google Fonts recevait l'adresse IP de chaque visiteur.
import '@fontsource-variable/inter';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
