/** settings.js — profil, ganti password, info sistem, audit log, dan paksa ganti password. */
import { call, session } from './api.js';
import { h, icon, mount, fmt, emptyState, errorState, skeleton, dataTable, pager, formDialog, openModal, toast, errMessage, buildForm, plateTag } from './ui.js';
import { passwordProblem, RE_EMAIL } from './validators.js';
import { isAdmin, isSuper, roleLabel, logout } from './auth.js';

function pwSpecs(withCurrent) {
  return [
    withCurrent ? { name: 'currentPassword', label: 'Password saat ini', type: 'password', required: true, autocomplete: 'current-password', maxlength: 128 } : null,
    { name: 'newPassword', label: 'Password baru', type: 'password', required: true, autocomplete: 'new-password', maxlength: 128, hint: 'Minimal 12 karakter, memuat huruf besar, huruf kecil, dan angka.' },
    { name: 'confirm', label: 'Ulangi password baru', type: 'password', required: true, autocomplete: 'new-password', maxlength: 128 }
  ].filter(Boolean);
}
function validatePw(v) {
  const e = {};
  if (v.currentPassword !== undefined && !v.currentPassword) e.currentPassword = 'Wajib diisi.';
  const p = passwordProblem(v.newPassword); if (p) e.newPassword = p;
  if (!e.newPassword && v.newPassword === v.currentPassword) e.newPassword = 'Password baru harus berbeda dari yang lama.';
  if (v.confirm !== v.newPassword) e.confirm = 'Konfirmasi tidak sama.';
  return e;
}

/** Dialog non-dismissable: dipakai saat must_change_password. Selesai setelah password berhasil diganti. */
export async function forcePasswordChange() {
  let done = false;
  while (!done) {
    const form = buildForm(pwSpecs(true), {});
    const alertBox = h('div', { class: 'hidden', style: 'margin-bottom:12px' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Ganti password');
    const out = h('button', { class: 'btn', type: 'button' }, 'Keluar');
    const m = openModal({ title: 'Ganti password sementara', size: 'narrow', body: h('div', null, h('p', { class: 'muted', style: 'margin-bottom:12px', text: 'Demi keamanan, ganti password sementara Anda sebelum melanjutkan.' }), alertBox, form.el), footer: [out, submit] });
    m.el.addEventListener('cancel', (ev) => ev.preventDefault());
    m.el.addEventListener('click', (ev) => { if (ev.target === m.el) ev.stopImmediatePropagation(); }, true);
    out.addEventListener('click', () => logout());
    const run = async (ev) => {
      ev.preventDefault(); alertBox.classList.add('hidden');
      const v = form.values(); const errs = validatePw(v);
      if (Object.keys(errs).length) { form.setErrors(errs); return; }
      form.clearErrors(); submit.disabled = true;
      try { await call('auth.changePassword', { currentPassword: v.currentPassword, newPassword: v.newPassword }); done = true; m.close(true); toast('Password berhasil diganti.', 'ok'); }
      catch (e) { submit.disabled = false; mount(alertBox, h('div', { class: 'alert bad', role: 'alert' }, icon('circle-alert'), errMessage(e))); alertBox.classList.remove('hidden'); }
    };
    form.el.addEventListener('submit', run); submit.addEventListener('click', (ev) => { if (!form.el.contains(ev.target)) run(ev); });
    // dialog ditutup hanya lewat m.close(true); cancel (ESC) diblokir di atas
    await m.closed;
  }
}

export async function render(container, ctx) {
  const u = ctx.user;
  const profileBox = h('div', { class: 'card card-pad' });
  const pf = buildForm([{ name: 'full_name', label: 'Nama lengkap', required: true, maxlength: 80 }, { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 120, autocomplete: 'email' }], u);
  const pAlert = h('div', { class: 'hidden', style: 'margin:12px 0' });
  const pBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Simpan profil');
  pf.el.addEventListener('submit', async (ev) => {
    ev.preventDefault(); pAlert.classList.add('hidden');
    const v = pf.values(); const e = {};
    if (!v.full_name || v.full_name.length < 2) e.full_name = 'Minimal 2 karakter.';
    if (!RE_EMAIL.test(v.email)) e.email = 'Format email tidak valid.';
    if (Object.keys(e).length) { pf.setErrors(e); return; }
    pf.clearErrors(); pBtn.disabled = true;
    try { const r = await call('profile.update', v); session.user = r.user; toast('Profil disimpan. Muat ulang halaman untuk memperbarui nama di header.', 'ok'); }
    catch (er) { mount(pAlert, h('div', { class: 'alert bad', role: 'alert' }, icon('circle-alert'), errMessage(er))); pAlert.classList.remove('hidden'); }
    pBtn.disabled = false;
  });
  pf.el.appendChild(h('div', { style: 'margin-top:14px' }, pBtn));
  mount(profileBox, h('h2', { text: 'Profil' }), h('p', { class: 'cell-sub', text: 'Username: ' + u.username + ' · Peran: ' + roleLabel(u.role) }), pAlert, pf.el);

  const pwBox = h('div', { class: 'card card-pad' });
  const wf = buildForm(pwSpecs(true), {});
  const wAlert = h('div', { class: 'hidden', style: 'margin:12px 0' });
  const wBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Ganti password');
  wf.el.addEventListener('submit', async (ev) => {
    ev.preventDefault(); wAlert.classList.add('hidden');
    const v = wf.values(); const errs = validatePw(v);
    if (Object.keys(errs).length) { wf.setErrors(errs); return; }
    wf.clearErrors(); wBtn.disabled = true;
    try { await call('auth.changePassword', { currentPassword: v.currentPassword, newPassword: v.newPassword }); toast('Password diganti. Sesi lain diakhiri.', 'ok'); wf.el.reset(); }
    catch (er) { mount(wAlert, h('div', { class: 'alert bad', role: 'alert' }, icon('circle-alert'), errMessage(er))); wAlert.classList.remove('hidden'); }
    wBtn.disabled = false;
  });
  wf.el.appendChild(h('div', { style: 'margin-top:14px' }, wBtn));
  mount(pwBox, h('h2', { text: 'Ganti password' }), wAlert, wf.el);

  const sysBox = h('div', { class: 'card card-pad' });
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Pengaturan' }), h('p', { text: 'Profil, keamanan akun, dan informasi sistem.' }))),
    h('div', { class: 'dash-grid' }, h('div', { class: 'span-6' }, profileBox), h('div', { class: 'span-6' }, pwBox), isAdmin(u) ? h('div', { class: 'span-12' }, sysBox) : null));

  if (isAdmin(u)) {
    mount(sysBox, skeleton(2));
    try {
      const s = await call('settings.get', {});
      const c = s.config;
      const row = (k, v) => [h('dt', { text: k }), h('dd', null, v)];
      const yes = (b) => h('span', { class: 'badge ' + (b ? 'b-ok' : 'b-bad') }, icon(b ? 'circle-check' : 'circle-alert'), b ? 'Ya' : 'Belum');
      const tzSel = h('select', { class: 'input', 'aria-label': 'Zona waktu', disabled: !isSuper(u) }, s.allowedTimezones.map((z) => h('option', { value: z, selected: z === s.timezone }, z)));
      mount(sysBox, h('h2', { text: 'Informasi sistem' }), h('dl', { class: 'kv', style: 'margin-top:12px' },
        row('Aplikasi', s.app.name + ' v' + s.app.version), row('Spreadsheet terhubung', yes(c.spreadsheetConfigured)), row('Pepper password terpasang', yes(c.pepperConfigured)),
        row('Pemicu harian terpasang', yes(c.dailyTriggerInstalled)), row('Iterasi PBKDF2', c.pbkdf2Iterations + (c.pbkdf2Iterations < 100000 ? ' (di bawah rekomendasi OWASP — lihat SECURITY.md)' : '')),
        row('Sesi idle / maksimum', c.sessionIdleMinutes + ' menit / ' + c.sessionAbsoluteHours + ' jam'), row('Batas gagal login', c.loginMaxFailures + ' kali'),
        row('Ambang status', 'Mendekati ≤ ' + c.thresholds.NEAR_DAYS + ' hari / ' + c.thresholds.NEAR_KM + ' km; Jatuh tempo ≤ ' + c.thresholds.DUE_DAYS + ' hari / ' + c.thresholds.DUE_KM + ' km'),
        row('Zona waktu', h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, tzSel, isSuper(u) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await call('settings.update', { timezone: tzSel.value }); toast('Zona waktu disimpan.', 'ok'); } catch (e) { toast(errMessage(e), 'bad'); } } }, 'Simpan') : h('span', { class: 'cell-sub', text: 'Hanya superadmin yang dapat mengubah.' })))));
    } catch (e) { mount(sysBox, errorState(e)); }
  }
}

export async function audit(container, ctx) {
  const st = { action: '', outcome: '', from: '', to: '', page: 1 };
  const action = h('input', { class: 'input', type: 'search', placeholder: 'Filter aksi (mis. login, vehicles)…', 'aria-label': 'Filter aksi' });
  const osel = h('select', { class: 'input', 'aria-label': 'Hasil' }, [['', 'Semua hasil'], ['success', 'Berhasil'], ['failure', 'Gagal'], ['denied', 'Ditolak']].map(([v, l]) => h('option', { value: v }, l)));
  const from = h('input', { class: 'input', type: 'date', 'aria-label': 'Dari tanggal' });
  const to = h('input', { class: 'input', type: 'date', 'aria-label': 'Sampai tanggal' });
  const out = h('div', { class: 'card' });
  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('auditLogs.list', { action: st.action, outcome: st.outcome, from: st.from, to: st.to, page: st.page, pageSize: 20 });
      if (!r.items.length) { mount(out, emptyState('scroll-text', 'Tidak ada log', 'Tidak ada entri sesuai filter.')); return; }
      mount(out, dataTable([
        { label: 'Waktu', cls: 'nowrap', render: (l) => fmt.datetime(l.timestamp) },
        { label: 'Pelaku', render: (l) => l.actor_username },
        { label: 'Aksi', cls: 'mono', render: (l) => l.action },
        { label: 'Objek', render: (l) => h('span', { class: 'cell-sub mono', text: l.entity_type + (l.entity_id ? ' · ' + String(l.entity_id).slice(0, 8) : '') }) },
        { label: 'Hasil', render: (l) => h('span', { class: 'badge ' + (l.outcome === 'success' ? 'b-ok' : l.outcome === 'denied' ? 'b-due' : 'b-bad') }, icon(l.outcome === 'success' ? 'circle-check' : 'circle-alert'), l.outcome === 'success' ? 'Berhasil' : l.outcome === 'denied' ? 'Ditolak' : 'Gagal') },
        { label: 'Rincian', render: (l) => h('span', { class: 'cell-sub mono', text: Object.keys(l.metadata || {}).map((k) => k + '=' + l.metadata[k]).join(' ') }) }
      ], r.items, { caption: 'Audit log' }), pager(r, (p) => { st.page = p; load(); }));
    } catch (e) { mount(out, errorState(e, load)); }
  }
  const reload = () => { st.page = 1; load(); };
  let t; action.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.action = action.value.trim(); reload(); }, 300); });
  osel.addEventListener('change', () => { st.outcome = osel.value; reload(); });
  from.addEventListener('change', () => { st.from = from.value; reload(); }); to.addEventListener('change', () => { st.to = to.value; reload(); });
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Audit log' }), h('p', { text: 'Jejak aksi penting. Password, token, dan data sensitif tidak pernah dicatat.' }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow search' }, icon('search'), action), h('div', { class: 'field' }, osel), h('div', { class: 'field' }, from), h('div', { class: 'field' }, to)), out);
  await load();
}
