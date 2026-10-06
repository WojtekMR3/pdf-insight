import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, readTheme } from './lib/theme';
import './styles.css';

applyTheme(readTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
