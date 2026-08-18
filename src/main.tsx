import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { SettingsProvider } from './settings/SettingsContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <BrowserRouter>
            <SettingsProvider>
                <AuthProvider>
                    <App />
                </AuthProvider>
            </SettingsProvider>
        </BrowserRouter>
    </React.StrictMode>,
);
