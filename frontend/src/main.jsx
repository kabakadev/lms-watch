import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Any 401 from the API means the session is gone: tell the app to show the login screen.
const realFetch = window.fetch;
window.fetch = async (...args) => {
  const res = await realFetch(...args);
  if (res.status === 401) window.dispatchEvent(new Event('lms-unauthorized'));
  return res;
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
