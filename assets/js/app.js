/**
 * app.js — kerangka aplikasi: sidebar, header, router berbasis hash, pemuatan modul halaman secara lazy.
 * Pembatasan menu menurut role hanya untuk kenyamanan; backend selalu memeriksa ulang.
 */
import { requireSession, logout, isAdmin, roleLabel } from './auth.js';
import { call, session } from './api.js';
import { h, icon, mount, clear, skeleton, errorState, emptyState, toast, errMessage } from './ui.js';
import { destroyCharts } from './charts.js';

const ROUTES = [
  { re: /^\/dashboard$/, key: 'dashboard', title: 'Dashboard', mod: () => import('./dashboard.js'), fn: 'render' },
  { re: /^\/vehicles$/, key: 'vehicles', title: 'Kendaraan', mod: () => import('./vehicles.js'), fn: 'list' },
  { re: /^\/vehicles\/([0-9a-fA-F-]{36})$/, key: 'vehicles', title: 'Detail kendaraan', parent: ['Kendaraan', '#/vehicles'], mod: () => import('./vehicles.js'), fn: 'detail' },
  { re: /^\/service-history$/, key: 'service-history', title: 'Riwayat servis', mod: () => import('./service-history.js'), fn: 'render' },
  { re: /^\/recommendations$/, key: 'recommendations', title: 'Rekomendasi perawatan', mod: () => import('./maintenance.js'), fn: 'recommendations' },
  { re: /^\/schedule$/, key: 'schedule', title: 'Jadwal servis', mod: () => import('./maintenance.js'), fn: 'schedule' },
  { re: /^\/rules$/, key: 'rules', title: 'Katalog aturan', mod: () => import('./maintenance.js'), fn: 'rules' },
  { re: /^\/reports$/, key: 'reports', title: 'Laporan', mod: () => import('./reports.js'), fn: 'render' },
  { re: /^\/users$/, key: 'users', title: 'Manajemen pengguna', admin: true, mod: () => import('./users.js'), fn: 'render' },
  { re: /^\/audit$/, key: 'audit', title: 'Audit log', admin: true, mod: () => import('./settings.js'), fn: 'audit' },
  { re: /^\/settings$/, key: 'settings', title: 'Pengaturan', mod: () => import('./settings.js'), fn: 'render' }
];

const NAV = [
  { label: 'Utama', items: [
    { key: 'dashboard', icon: 'layout-dashboard', text: 'Dashboard' },
    { key: 'vehicles', icon: 'car', text: 'Kendaraan' },
    { key: 'service-history', icon: 'file-clock', text: 'Riwayat servis' } ] },
  { label: 'Perawatan', items: [
    { key: 'recommendations', icon: 'wrench', text: 'Rekomendasi' },
    { key: 'schedule', icon: 'calendar-clock', text: 'Jadwal servis' },
    { key: 'rules', icon: 'book-open', text: 'Katalog aturan' } ] },
  { label: 'Laporan', items: [ { key: 'reports', icon: 'chart-column', text: 'Laporan & ekspor' } ] },
  { label: 'Administrasi', admin: true, items: [
    { key: 'users', icon: 'users', text: 'Pengguna' },
    { key: 'audit', icon: 'scroll-text', text: 'Audit log' } ] },
  { label: 'Akun', items: [ { key: 'settings', icon: 'settings', text: 'Pengaturan' } ] }
];

const state = { user: null, cleanup: null, seq: 0, bell: null };
const $ = (id) => document.getElementById(id);

export function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '') || '/dashboard';
  const [path, qs] = raw.split('?');
  const query = {};
  new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
  return { path, query };
}
export function go(path) { location.hash = '#' + path; }

/* ---------- kerangka ---------- */
function buildSidebar() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu' });
  NAV.forEach((sec) => {
    if (sec.admin && !isAdmin(state.user)) return;
    nav.appendChild(h('div', { class: 'nav-label', text: sec.label }));
    sec.items.forEach((it) => nav.appendChild(h('a', { href: '#/' + it.key, dataset: { key: it.key } }, icon(it.icon), it.text)));
  });
  mount($('sidebar'),
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, icon('gauge')), h('div', { class: 'brand-name' }, 'Service Tracker', h('small', { text: 'Toyota · independen' }))),
    nav,
    h('div', { class: 'sidebar-foot', text: 'v0.1 · data Anda dilindungi login & izin per kendaraan' }));
}

function buildTopbar() {
  const menuBtn = h('button', { class: 'btn btn-ghost btn-icon menu-btn', type: 'button', 'aria-label': 'Buka menu', 'aria-expanded': 'false', 'aria-controls': 'sidebar', onclick: () => toggleDrawer() }, icon('menu'));
  const title = h('div', { class: 'topbar-title' }, h('div', { class: 'crumbs', id: 'crumbs' }), h('h1', { id: 'page-title' }));
  const badge = h('span', { class: 'badge b-bad hidden', id: 'bell-count' });
  const bell = h('a', { class: 'btn btn-ghost', href: '#/schedule', 'aria-label': 'Pengingat servis' }, icon('bell'), badge);
  state.bell = badge;

  const menu = h('div', { class: 'card hidden', role: 'menu', id: 'user-menu', style: 'position:absolute;right:0;top:48px;min-width:220px;padding:8px;z-index:60' },
    h('div', { style: 'padding:8px 10px' }, h('div', { class: 'cell-main', text: state.user.full_name }), h('div', { class: 'cell-sub', text: state.user.email })),
    h('a', { class: 'btn btn-ghost', style: 'width:100%;justify-content:flex-start', role: 'menuitem', href: '#/settings' }, icon('user-cog'), 'Profil & pengaturan'),
    h('button', { class: 'btn btn-ghost', style: 'width:100%;justify-content:flex-start', role: 'menuitem', type: 'button', onclick: () => logout() }, icon('log-out'), 'Keluar'));
  const userBtn = h('button', { class: 'btn btn-ghost', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => {
    const open = menu.classList.toggle('hidden') === false; userBtn.setAttribute('aria-expanded', String(open));
  } }, icon('user'), h('span', { class: 'user-name', text: state.user.full_name }), h('span', { class: 'badge b-muted', text: roleLabel(state.user.role) }));
  document.addEventListener('click', (ev) => { if (!menu.contains(ev.target) && !userBtn.contains(ev.target)) { menu.classList.add('hidden'); userBtn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { menu.classList.add('hidden'); toggleDrawer(false); } });
  mount($('topbar'), menuBtn, title, h('div', { class: 'topbar-actions' }, bell, h('div', { style: 'position:relative' }, userBtn, menu)));
}

function toggleDrawer(force) {
  const sb = $('sidebar'); const open = force === undefined ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open); $('overlay').classList.toggle('hidden', !open);
  const b = document.querySelector('.menu-btn'); if (b) b.setAttribute('aria-expanded', String(open));
}

async function refreshBell() {
  try {
    const r = await call('reminders.list', {});
    const n = r.total || 0;
    state.bell.textContent = n > 99 ? '99+' : String(n);
    state.bell.classList.toggle('hidden', n === 0);
    state.bell.setAttribute('title', n + ' pengingat aktif');
  } catch (e) { /* lonceng bersifat tambahan; abaikan galat */ }
}

/* ---------- router ---------- */
async function route() {
  const mySeq = ++state.seq;
  if (state.cleanup) { try { state.cleanup(); } catch (e) { /* abaikan */ } state.cleanup = null; }
  destroyCharts();
  toggleDrawer(false);
  const { path, query } = parseHash();
  const main = $('main');
  let r = null, params = [];
  for (const rt of ROUTES) { const m = path.match(rt.re); if (m) { r = rt; params = m.slice(1); break; } }
  if (!r) { go('/dashboard'); return; }

  document.querySelectorAll('.nav a').forEach((a) => { if (a.dataset.key === r.key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('page-title').textContent = r.title;
  document.title = r.title + ' — Toyota Service Tracker';
  mount($('crumbs'), h('a', { href: '#/dashboard', text: 'Beranda' }), r.parent ? [icon('chevron-right'), h('a', { href: r.parent[1], text: r.parent[0] })] : null, icon('chevron-right'), h('span', { text: r.title }));

  if (r.admin && !isAdmin(state.user)) { mount(main, emptyState('lock', 'Akses ditolak', 'Halaman ini hanya untuk admin.', h('a', { class: 'btn', href: '#/dashboard' }, 'Kembali ke dashboard'))); return; }
  mount(main, skeleton(5));
  try {
    const mod = await r.mod();
    if (mySeq !== state.seq) return;
    const box = h('div');
    const cleanup = await mod[r.fn](box, { user: state.user, params, query, go, refreshBell });
    if (mySeq !== state.seq) { if (typeof cleanup === 'function') cleanup(); return; }
    state.cleanup = typeof cleanup === 'function' ? cleanup : null;
    mount(main, box);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    if (mySeq !== state.seq) return;
    mount(main, errorState(e, () => route()));
  }
}

async function boot() {
  let user;
  try { user = await requireSession(); } catch (e) {
    mount($('boot'), emptyState('circle-alert', 'Tidak dapat memuat aplikasi', errMessage(e), h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Muat ulang')));
    return;
  }
  if (!user) return;
  state.user = user;
  window.addEventListener('tst:session-lost', () => { toast('Sesi berakhir. Silakan login kembali.', 'bad'); setTimeout(() => location.replace('login.html'), 800); });
  buildSidebar(); buildTopbar();
  $('overlay').addEventListener('click', () => toggleDrawer(false));
  $('boot').classList.add('hidden'); $('app').classList.remove('hidden');

  if (user.must_change_password) {
    const { forcePasswordChange } = await import('./settings.js');
    await forcePasswordChange();
    const d = await call('auth.me'); state.user = d.user; session.user = d.user;
  }
  window.addEventListener('hashchange', route);
  route();
  refreshBell();
  setInterval(refreshBell, 5 * 60 * 1000);
}

boot();
