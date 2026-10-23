/** users.js — manajemen pengguna (admin/superadmin). Hak akses sebenarnya ditegakkan backend. */
import { call } from './api.js';
import { h, icon, mount, fmt, emptyState, errorState, skeleton, dataTable, pager, debounce, formDialog, confirmDialog, showSecret, toast, errMessage } from './ui.js';
import { validateUser } from './validators.js';
import { isSuper, roleLabel } from './auth.js';

function openUserForm(user, me) {
  const editing = !!user;
  const roles = isSuper(me) ? [['user', 'Pengguna'], ['admin', 'Admin'], ['superadmin', 'Superadmin']] : [['user', 'Pengguna']];
  const specs = [
    { name: 'username', label: 'Username', required: true, maxlength: 32, disabled: editing, autocomplete: 'off' },
    { name: 'full_name', label: 'Nama lengkap', required: true, maxlength: 80 },
    { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 120, autocomplete: 'off' },
    { name: 'role', label: 'Peran', type: 'select', options: roles.map(([v, l]) => ({ value: v, label: l })), disabled: editing && !isSuper(me) }
  ];
  return formDialog({
    title: editing ? 'Ubah pengguna' : 'Tambah pengguna', specs, values: Object.assign({ role: 'user' }, user || {}),
    intro: editing ? null : 'Password sementara dibuat otomatis dan ditampilkan sekali. Pengguna wajib menggantinya saat login pertama.',
    submitText: editing ? 'Simpan' : 'Buat pengguna',
    validate: (v) => validateUser(v, !editing),
    onSubmit: async (v) => {
      if (editing) { const p = { user_id: user.user_id, full_name: v.full_name, email: v.email }; if (isSuper(me)) p.role = v.role; return call('users.update', p); }
      return call('users.create', v);
    }
  });
}

export async function render(container, ctx) {
  const me = ctx.user;
  const st = { search: '', role: '', status: '', page: 1 };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cari username, nama, email…', 'aria-label': 'Cari pengguna' });
  const rsel = h('select', { class: 'input', 'aria-label': 'Peran' }, [['', 'Semua peran'], ['user', 'Pengguna'], ['admin', 'Admin'], ['superadmin', 'Superadmin']].map(([v, l]) => h('option', { value: v }, l)));
  const ssel = h('select', { class: 'input', 'aria-label': 'Status' }, [['', 'Semua status'], ['active', 'Aktif'], ['inactive', 'Nonaktif']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div', { class: 'card' });

  async function reset(u) {
    if (!await confirmDialog({ title: 'Reset password?', message: 'Password baru sementara dibuat untuk ' + u.username + '. Semua sesi aktifnya diakhiri.', confirmText: 'Reset password', danger: true })) return;
    try { const r = await call('users.resetPassword', { user_id: u.user_id }); await showSecret({ title: 'Password sementara', intro: 'Untuk ' + u.username + ':', secret: r.temporaryPassword }); load(); } catch (e) { toast(errMessage(e), 'bad'); }
  }
  async function toggle(u) {
    const deact = u.status === 'active';
    if (!await confirmDialog({ title: deact ? 'Nonaktifkan pengguna?' : 'Aktifkan pengguna?', message: deact ? u.username + ' tidak dapat login dan sesinya diakhiri.' : u.username + ' dapat login kembali.', confirmText: deact ? 'Nonaktifkan' : 'Aktifkan', danger: deact })) return;
    try { await call(deact ? 'users.deactivate' : 'users.update', deact ? { user_id: u.user_id } : { user_id: u.user_id, status: 'active' }); toast('Status pengguna diperbarui.', 'ok'); load(); } catch (e) { toast(errMessage(e), 'bad'); }
  }
  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('users.list', { search: st.search, role: st.role, status: st.status, page: st.page, pageSize: 15, sortBy: 'username', sortDir: 'asc' });
      if (!r.items.length) { mount(out, emptyState('users', 'Tidak ada pengguna', 'Ubah filter atau tambah pengguna baru.')); return; }
      mount(out, dataTable([
        { label: 'Pengguna', render: (u) => h('div', null, h('div', { class: 'cell-main', text: u.full_name }), h('div', { class: 'cell-sub', text: u.username + ' · ' + u.email })) },
        { label: 'Peran', render: (u) => h('span', { class: 'badge b-muted', text: roleLabel(u.role) }) },
        { label: 'Status', render: (u) => u.status === 'active' ? h('span', { class: 'badge b-ok' }, icon('circle-check'), 'Aktif') : h('span', { class: 'badge b-muted' }, icon('ban'), 'Nonaktif') },
        { label: 'Login terakhir', cls: 'nowrap', render: (u) => u.last_login_at ? fmt.datetime(u.last_login_at) : 'Belum pernah' },
        { label: 'Aksi', actions: true, render: (u) => h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Ubah', 'aria-label': 'Ubah ' + u.username, onclick: async () => { if (await openUserForm(u, me)) { toast('Pengguna diperbarui.', 'ok'); load(); } } }, icon('pencil')),
          h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Reset password', 'aria-label': 'Reset password ' + u.username, onclick: () => reset(u) }, icon('key-round')),
          u.user_id !== me.user_id ? h('button', { class: 'btn btn-sm ' + (u.status === 'active' ? 'btn-danger' : ''), type: 'button', onclick: () => toggle(u) }, u.status === 'active' ? 'Nonaktifkan' : 'Aktifkan') : null) }
      ], r.items, { caption: 'Daftar pengguna' }), pager(r, (p) => { st.page = p; load(); }));
    } catch (e) { mount(out, errorState(e, load)); }
  }
  search.addEventListener('input', debounce(() => { st.search = search.value.trim(); st.page = 1; load(); }, 300));
  rsel.addEventListener('change', () => { st.role = rsel.value; st.page = 1; load(); });
  ssel.addEventListener('change', () => { st.status = ssel.value; st.page = 1; load(); });
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Manajemen pengguna' }), h('p', { text: 'Akses kendaraan per pengguna diatur dari halaman detail kendaraan.' })),
    h('div', { class: 'page-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const r = await openUserForm(null, me);
      if (r && r.temporaryPassword) { await showSecret({ title: 'Pengguna dibuat', intro: 'Password sementara untuk ' + r.user.username + ':', secret: r.temporaryPassword }); }
      if (r) load();
    } }, icon('user-plus'), 'Tambah pengguna'))),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow search' }, icon('search'), search), h('div', { class: 'field' }, rsel), h('div', { class: 'field' }, ssel)), out);
  await load();
}
