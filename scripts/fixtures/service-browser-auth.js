import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';

if (!['127.0.0.1', 'localhost'].includes(location.hostname)) {
  throw new Error('Service browser authentication is restricted to localhost');
}

const app = initializeApp({
  apiKey: 'demo-key',
  authDomain: 'demo-campus-services.firebaseapp.com',
  projectId: 'demo-campus-services',
  appId: '1:1:web:services',
});
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
signInAnonymously(auth).then(({ user }) => {
  window.serviceBrowserAuth = { ready: true, uid: user.uid };
}).catch((error) => {
  window.serviceBrowserAuth = { ready: false, error: error.message };
});
