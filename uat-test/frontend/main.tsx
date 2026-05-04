import React from 'react';
import { createRoot } from 'react-dom/client';
import { UsersAndTeamsProvider } from '@mahirick/users-and-teams/react';
import '@mahirick/users-and-teams/styles.css';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) throw new Error('No #root');

createRoot(container).render(
  <React.StrictMode>
    <UsersAndTeamsProvider apiBase="">
      <App />
    </UsersAndTeamsProvider>
  </React.StrictMode>,
);
