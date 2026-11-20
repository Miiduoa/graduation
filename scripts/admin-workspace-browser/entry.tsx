import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminWorkspace } from '@/features/admin/AdminWorkspace';
import '@/app/globals.css';
import { initializeFixtureSession } from './session';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
initializeFixtureSession(params.get('role') || 'operator');
createRoot(document.getElementById('root')!).render(<AdminWorkspace />);
