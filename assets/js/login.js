/** login.js — halaman masuk. Pesan galat generik dari backend ditampilkan apa adanya. */
import { CONFIG } from './config.js';
import { login } from './auth.js';
import { session, ApiError } from './api.js';
import { h, icon, mount } from './ui.js';

const form = document.getElementById('login-form');
const idEl = document.getElementById('identifier');
const pwEl = document.getElementById('password');
const errBox = document.getElementById('form-error');
const submit = document.getElementById('submit');
const toggle = document.getElementById('toggle-pw');
['hero-mark', 'card-mark'].forEach((id) => document.getElementById(id).appendChild(icon('gauge')));
mount(toggle, icon('eye'));

if (session.token) window.location.replace('index.html');
if (!CONFIG.API_URL) {
  mount(document.getElementById('notice'), h('div', { class: 'alert warn', style: 'margin-bottom:14px' }, icon('triangle-alert'), 'Backend belum dikonfigurasi. Isi API_URL pada assets/js/config.js (lihat DEPLOYMENT.md).'));
}

toggle.addEventListener('click', () => {
  const show = pwEl.type === 'password';
  pwEl.type = show ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(show));
  toggle.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
  mount(toggle, icon(show ? 'eye-off' : 'eye'));
});

function showError(msg) {
  mount(errBox, h('div', { class: 'alert bad' }, icon('circle-alert'), msg));
  errBox.classList.remove('hidden');
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  errBox.classList.add('hidden');
  const identifier = idEl.value.trim(), password = pwEl.value;
  if (!identifier || !password) { showError('Username/email dan password wajib diisi.'); (identifier ? pwEl : idEl).focus(); return; }
  submit.disabled = true; mount(submit, h('span', { class: 'spin' }, icon('loader-circle')), ' Memeriksa…');
  try {
    await login(identifier, password);
    window.location.replace('index.html');
  } catch (e) {
    submit.disabled = false; mount(submit, 'Masuk');
    pwEl.value = '';
    showError(e instanceof ApiError ? e.message : 'Terjadi kesalahan. Coba lagi.');
    pwEl.focus();
  }
});
