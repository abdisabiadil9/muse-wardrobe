import React from 'react';
import { createRoot } from 'react-dom/client';
import Application from './Application';
import { ThemeScope } from '@lenso/ui';
import '@lenso/tokens/styles.css';
import './styles.css';
import './interaction.css';
import './today.css';
import './native-mobile.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeScope theme="light">
      <Application />
    </ThemeScope>
  </React.StrictMode>,
);
