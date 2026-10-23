/** auth.js — login, logout, pengguna aktif. Otorisasi sebenarnya dilakukan backend; ini hanya untuk UI. */
import { call, session } from './api.js';

export const isAdmin = (u) => !!u && (u.role === 'admin' || u.role === 'superadmin');
export const isSuper = (u) => !!u && u.role === 'superadmin';
export const roleLabel = (r) => ({ superadmin: 'Superadmin', admin: 'Admin', user: 'Pengguna' }[r] || r);

export async function login(identifier, password) {
  const d = await call('auth.login', { identifier, password });
  session.token = d.token;
  session.user = d.user;
  return d;
}

export async function logout() {
  try { await call('auth.logout'); } catch (e) { /* sesi mungkin sudah berakhir */ }
  session.clear();
  window.location.replace('login.html');
}

/** Pastikan ada sesi valid. Mengembalikan user terbaru dari server, atau mengarahkan ke login. */
export async function requireSession() {
  if (!session.token) { window.location.replace('login.html'); return null; }
  try {
    const d = await call('auth.me');
    session.user = d.user;
    return d.user;
  } catch (e) {
    if (e.code === 'UNAUTHENTICATED') { window.location.replace('login.html'); return null; }
    throw e;
  }
}
