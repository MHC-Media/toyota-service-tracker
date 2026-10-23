/** vehicles.js — daftar kendaraan, form, dan halaman detail dengan tab. */
import { call } from './api.js';
import { h, icon, mount, fmt, statusBadge, verifyBadge, plateTag, emptyState, errorState, skeleton, dataTable, pager, debounce, formDialog, confirmDialog, toast, errMessage, tabs, detailsToMap } from './ui.js';
import { validateVehicle } from './validators.js';
import { isAdmin } from './auth.js';
import { openServiceForm, serviceTimeline } from './service-history.js';
import { recCard } from './maintenance.js';

const TRANSMISSIONS = ['MT', 'AT', 'CVT', 'DCT', 'e-CVT', 'Lainnya'];
const FUELS = ['Bensin', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Listrik', 'Lainnya'];
const opts = (arr, blank) => [{ value: '', label: blank || '— Pilih —' }].concat(arr.map((x) => ({ value: x, label: x })));

async function loadOwners() {
  const r = await call('users.list', { role: 'user', status: 'active', pageSize: 100, sortBy: 'username', sortDir: 'asc' });
  return [{ value: '', label: '— Tanpa pemilik (akses diberikan manual) —' }].concat(r.items.map((u) => ({ value: u.user_id, label: u.full_name + ' (' + u.username + ')' })));
}

export async function openVehicleForm(vehicle, user) {
  const editing = !!vehicle;
  const owners = isAdmin(user) ? await loadOwners() : [];
  const specs = [
    { name: 'plate_number', label: 'Nomor polisi', required: true, maxlength: 14, placeholder: 'KH 1234 AB', hint: 'Disimpan huruf besar.' },
    { name: 'owner_user_id', label: 'Pemilik (akun pengguna)', type: 'select', options: owners },
    { name: 'brand', label: 'Merek', maxlength: 30 },
    { name: 'model', label: 'Model', required: true, maxlength: 40, placeholder: 'mis. Avanza' },
    { name: 'variant', label: 'Varian', maxlength: 60, placeholder: 'mis. 1.3 G' },
    { name: 'year', label: 'Tahun', type: 'number', required: true, min: 1980, max: new Date().getFullYear() + 1 },
    { name: 'transmission', label: 'Transmisi', type: 'select', options: opts(TRANSMISSIONS) },
    { name: 'fuel_type', label: 'Bahan bakar', type: 'select', options: opts(FUELS) },
    { name: 'engine', label: 'Mesin', maxlength: 60, placeholder: 'mis. 1NR-VE', hint: 'Dipakai mencocokkan aturan perawatan.' },
    { name: 'vin_last4', label: '4 digit terakhir no. rangka', maxlength: 4 },
    { name: 'purchase_date', label: 'Tanggal pembelian', type: 'date' },
    { name: 'delivery_date', label: 'Tanggal pengiriman / mulai dipakai', type: 'date' },
    { name: 'current_odometer', label: 'Kilometer saat ini', type: 'number', min: 0, max: 2000000 },
    { name: 'warranty_end_date', label: 'Garansi berakhir', type: 'date' },
    { name: 'notes', label: 'Catatan', type: 'textarea', maxlength: 500, span2: true }
  ];
  if (editing) specs.push({ name: 'correction_reason', label: 'Alasan koreksi kilometer', maxlength: 200, span2: true, hidden: true, hint: 'Wajib bila kilometer diturunkan dari catatan sebelumnya (min. 5 karakter).' });
  const values = Object.assign({ brand: 'Toyota' }, vehicle || {});
  const result = await formDialog({
    title: editing ? 'Ubah kendaraan' : 'Tambah kendaraan', size: 'wide', specs, values, submitText: editing ? 'Simpan perubahan' : 'Tambah kendaraan',
    validate: validateVehicle,
    onServerError: (e, form) => {
      if (e.code === 'VALIDATION_ERROR' && e.details && e.details.some((d) => d.field === 'current_odometer' && /koreksi/i.test(d.message))) {
        form.show('correction_reason', true); form.setErrors(detailsToMap(e.details)); return true;
      }
      return false;
    },
    onSubmit: async (v) => {
      const p = Object.assign({}, v);
      if (!p.correction_reason) delete p.correction_reason;
      if (!isAdmin(user)) delete p.owner_user_id;
      if (editing) { p.vehicle_id = vehicle.vehicle_id; return call('vehicles.update', p); }
      return call('vehicles.create', p);
    }
  });
  if (result) toast(editing ? 'Kendaraan diperbarui.' : 'Kendaraan ditambahkan.', 'ok');
  return result;
}

export async function archiveVehicle(v) {
  const ok = await confirmDialog({ title: 'Arsipkan kendaraan?', message: 'Kendaraan ' + v.plate_number + ' disembunyikan dari pengguna dan tidak menerima servis baru. Riwayat tetap tersimpan.', confirmText: 'Arsipkan', danger: true });
  if (!ok) return false;
  try { await call('vehicles.archive', { vehicle_id: v.vehicle_id }); toast('Kendaraan diarsipkan.', 'ok'); return true; }
  catch (e) { toast(errMessage(e), 'bad'); return false; }
}

/* ---------------- daftar ---------------- */
export async function list(container, ctx) {
  const admin = isAdmin(ctx.user);
  const st = { search: ctx.query.search || '', status: '', sortBy: 'plate_number', sortDir: 'asc', page: 1 };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cari nomor polisi, model, atau tahun…', 'aria-label': 'Cari kendaraan', value: st.search });
  const status = admin ? h('select', { class: 'input', 'aria-label': 'Filter status' }, [['', 'Aktif'], ['archived', 'Diarsipkan']].map(([v, l]) => h('option', { value: v }, l))) : null;
  const sort = h('select', { class: 'input', 'aria-label': 'Urutkan' }, [
    ['plate_number|asc', 'Nomor polisi (A–Z)'], ['model|asc', 'Model (A–Z)'], ['year|desc', 'Tahun (terbaru)'],
    ['current_odometer|desc', 'Kilometer (tertinggi)'], ['next_service_date|asc', 'Servis berikutnya (terdekat)'], ['created_at|desc', 'Terbaru ditambahkan']
  ].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div', { class: 'card' });

  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('vehicles.list', { search: st.search, status: st.status || undefined, sortBy: st.sortBy, sortDir: st.sortDir, page: st.page, pageSize: 15 });
      if (!r.items.length) {
        mount(out, emptyState('car', st.search || st.status ? 'Tidak ada kendaraan yang cocok' : 'Belum ada kendaraan',
          st.search ? 'Coba kata kunci lain.' : (admin ? 'Tambahkan kendaraan pertama untuk mulai mencatat servis.' : 'Hubungi admin agar kendaraan Anda dihubungkan ke akun ini.'),
          admin && !st.search ? h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, icon('plus'), 'Tambah kendaraan') : null));
        return;
      }
      mount(out, dataTable([
        { label: 'Kendaraan', render: (v) => h('div', null, h('a', { href: '#/vehicles/' + v.vehicle_id }, plateTag(v.plate_number)), h('div', { class: 'cell-main', style: 'margin-top:4px', text: v.brand + ' ' + v.model + (v.variant ? ' ' + v.variant : '') }), h('div', { class: 'cell-sub', text: v.year + (v.engine ? ' · ' + v.engine : '') + (admin && v.owner_name ? ' · ' + v.owner_name : '') })) },
        { label: 'Odometer', cls: 'mono nowrap', render: (v) => fmt.km(v.current_odometer) },
        { label: 'Servis terakhir', render: (v) => v.last_service_date ? h('div', null, fmt.date(v.last_service_date), h('div', { class: 'cell-sub', text: fmt.km(v.last_service_odometer) })) : '—' },
        { label: 'Status perawatan', render: (v) => h('div', null, statusBadge(v.maintenance.status, v.maintenance.label), v.maintenance.has_unverified ? h('div', { style: 'margin-top:4px' }, verifyBadge('UNVERIFIED')) : null) },
        { label: 'Aksi', actions: true, render: (v) => h('div', { class: 'row-actions' },
          h('a', { class: 'btn btn-sm', href: '#/vehicles/' + v.vehicle_id }, icon('eye'), 'Detail'),
          admin && v.status === 'active' ? h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Ubah', 'aria-label': 'Ubah ' + v.plate_number, onclick: async () => { if (await openVehicleForm(v, ctx.user)) load(); } }, icon('pencil')) : null,
          admin && v.status === 'active' ? h('button', { class: 'btn btn-sm btn-icon btn-danger', type: 'button', title: 'Arsipkan', 'aria-label': 'Arsipkan ' + v.plate_number, onclick: async () => { if (await archiveVehicle(v)) load(); } }, icon('archive')) : null,
          admin && v.status === 'archived' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await call('vehicles.update', { vehicle_id: v.vehicle_id, status: 'active' }); toast('Kendaraan diaktifkan kembali.', 'ok'); load(); } catch (e) { toast(errMessage(e), 'bad'); } } }, icon('archive-restore'), 'Aktifkan') : null) }
      ], r.items, { caption: 'Daftar kendaraan' }), pager(r, (p) => { st.page = p; load(); }));
    } catch (e) { mount(out, errorState(e, load)); }
  }
  async function add() { if (await openVehicleForm(null, ctx.user)) load(); }

  search.addEventListener('input', debounce(() => { st.search = search.value.trim(); st.page = 1; load(); }, 300));
  if (status) status.addEventListener('change', () => { st.status = status.value; st.page = 1; load(); });
  sort.addEventListener('change', () => { const [a, b] = sort.value.split('|'); st.sortBy = a; st.sortDir = b; st.page = 1; load(); });

  mount(container,
    h('div', { class: 'page-head' }, h('div', null, h('h2', { text: admin ? 'Armada kendaraan' : 'Kendaraan Anda' }), h('p', { text: 'Status perawatan dihitung backend dari aturan dan riwayat servis.' })),
      admin ? h('div', { class: 'page-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, icon('plus'), 'Tambah kendaraan')) : null),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow search' }, h('label', { class: 'sr-only', text: 'Cari' }), icon('search'), search),
      status ? h('div', { class: 'field' }, status) : null, h('div', { class: 'field' }, sort)),
    out);
  await load();
}

/* ---------------- detail ---------------- */
function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', { text: k }), h('dd', null, v === '' || v === null || v === undefined ? '—' : v)]));
}

export async function detail(container, ctx) {
  const id = ctx.params[0];
  const admin = isAdmin(ctx.user);
  let v, recs = null;
  const content = h('div');
  const head = h('div', { class: 'card card-pad', style: 'margin-bottom:16px' });

  async function loadVehicle() {
    const d = await call('vehicles.get', { vehicle_id: id });
    v = d.vehicle;
  }
  async function loadRecs(force) {
    if (recs && !force) return recs;
    recs = await call('recommendations.get', { vehicle_id: id });
    return recs;
  }

  function renderHead() {
    mount(head, h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between' },
      h('div', null, plateTag(v.plate_number), h('h2', { style: 'margin-top:8px', text: v.brand + ' ' + v.model + (v.variant ? ' ' + v.variant : '') }),
        h('div', { class: 'cell-sub', text: v.year + (v.engine ? ' · ' + v.engine : '') + (v.transmission ? ' · ' + v.transmission : '') + (v.fuel_type ? ' · ' + v.fuel_type : '') })),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' },
        statusBadge(v.maintenance.status, v.maintenance.label), v.maintenance.has_unverified ? verifyBadge('UNVERIFIED') : null,
        admin && v.status === 'active' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: addService }, icon('plus'), 'Catat servis') : null,
        admin && v.status === 'active' ? h('button', { class: 'btn', type: 'button', onclick: edit }, icon('pencil'), 'Ubah') : null,
        admin && v.status === 'active' ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (await archiveVehicle(v)) ctx.go('/vehicles'); } }, icon('archive'), 'Arsipkan') : null)),
      v.status === 'archived' ? h('div', { class: 'alert warn', style: 'margin-top:12px' }, icon('archive'), 'Kendaraan ini diarsipkan.') : null);
  }

  async function edit() { if (await openVehicleForm(v, ctx.user)) { await refreshAll(); } }
  async function addService() { if (await openServiceForm({ vehicle: v })) { await refreshAll(); } }
  async function refreshAll() { await loadVehicle(); recs = null; renderHead(); tabCtl.select(current); ctx.refreshBell(); }

  let current = 'summary';
  const items = [{ key: 'summary', label: 'Ringkasan' }, { key: 'history', label: 'Riwayat servis' }, { key: 'recs', label: 'Rekomendasi' }, { key: 'upcoming', label: 'Jadwal mendatang' }, { key: 'info', label: 'Informasi' }];
  if (admin) items.push({ key: 'access', label: 'Akses pengguna' });
  const tabCtl = tabs(items, 'summary', async (key) => {
    current = key; mount(content, skeleton(4));
    try { await renderTab(key); } catch (e) { mount(content, errorState(e, () => tabCtl.select(key))); }
  });

  async function renderTab(key) {
    if (key === 'summary') {
      const r = await loadRecs();
      const s = r.summary;
      const counts = s.counts;
      mount(content, h('div', { class: 'dash-grid' },
        h('section', { class: 'card card-pad span-6' }, h('h2', { text: 'Kondisi saat ini' }), h('div', { style: 'margin-top:12px' }, kv([
          ['Kilometer saat ini', fmt.km(v.current_odometer)], ['Servis terakhir', v.last_service_date ? fmt.date(v.last_service_date) + ' · ' + fmt.km(v.last_service_odometer) : ''],
          ['Servis berikutnya (terdekat)', v.next_service_date ? fmt.date(v.next_service_date) + (v.next_service_odometer !== '' ? ' · ' + fmt.km(v.next_service_odometer) : '') : ''],
          ['Jumlah riwayat servis', fmt.num(v.service_count)], ['Garansi berakhir', v.warranty_end_date ? fmt.date(v.warranty_end_date) : '']]))),
        h('section', { class: 'card card-pad span-6' }, h('h2', { text: 'Ringkasan status perawatan' }), h('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' },
          ['OVERDUE', 'DUE', 'NEAR', 'SAFE', 'UNKNOWN'].map((k) => counts[k] ? statusBadge(k, STATUS_LABEL[k] + ': ' + counts[k]) : null)),
          s.next ? h('p', { style: 'margin-top:12px', text: 'Berikutnya: ' + s.next.service_name + (s.next.target_date ? ' · ' + fmt.date(s.next.target_date) : '') + (s.next.target_km ? ' · ' + fmt.km(s.next.target_km) : '') }) : h('p', { class: 'muted', style: 'margin-top:12px', text: 'Belum ada jadwal yang dapat dihitung.' }),
          r.warnings.map((w) => h('div', { class: 'alert warn', style: 'margin-top:10px' }, icon('triangle-alert'), w)))));
      return;
    }
    if (key === 'history') {
      const r = await call('serviceHistory.list', { vehicle_id: id, pageSize: 100, sortBy: 'service_date', sortDir: 'desc' });
      mount(content, r.items.length ? h('div', { class: 'card card-pad' }, serviceTimeline(r.items, { admin, onChanged: refreshAll })) : emptyState('file-clock', 'Belum ada riwayat servis', admin ? 'Catat servis pertama kendaraan ini.' : 'Riwayat dicatat oleh admin.', admin && v.status === 'active' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: addService }, icon('plus'), 'Catat servis') : null));
      return;
    }
    if (key === 'recs' || key === 'upcoming') {
      const r = await loadRecs();
      let items2 = r.items;
      if (key === 'upcoming') items2 = items2.filter((i) => i.status !== 'UNKNOWN' && (i.status !== 'SAFE' || (i.remaining_days !== null && i.remaining_days <= 90)));
      mount(content, h('div', { class: 'alert info', style: 'margin-bottom:14px' }, icon('info'), r.disclaimer),
        r.warnings.map((w) => h('div', { class: 'alert warn', style: 'margin-bottom:10px' }, icon('triangle-alert'), w)),
        items2.length ? h('div', { class: 'rec-list' }, items2.map((it) => recCard(it, r.vehicle))) : emptyState('wrench', key === 'upcoming' ? 'Tidak ada jadwal dalam 90 hari' : 'Belum ada rekomendasi', 'Rekomendasi muncul bila ada aturan perawatan yang cocok dengan model, tahun, dan mesin kendaraan.', admin ? h('a', { class: 'btn', href: '#/rules' }, 'Kelola aturan') : null));
      return;
    }
    if (key === 'info') {
      mount(content, h('div', { class: 'card card-pad' }, kv([
        ['Nomor polisi', v.plate_number], ['Merek / model', v.brand + ' ' + v.model], ['Varian', v.variant], ['Tahun', v.year], ['Mesin', v.engine], ['Transmisi', v.transmission], ['Bahan bakar', v.fuel_type],
        ['4 digit no. rangka', v.vin_last4], ['Tanggal pembelian', v.purchase_date ? fmt.date(v.purchase_date) : ''], ['Tanggal pengiriman', v.delivery_date ? fmt.date(v.delivery_date) : ''],
        ['Garansi berakhir', v.warranty_end_date ? fmt.date(v.warranty_end_date) : ''], admin ? ['Pemilik', v.owner_name ? v.owner_name + ' (' + v.owner_username + ')' : ''] : null,
        ['Catatan', v.notes], ['Ditambahkan', fmt.datetime(v.created_at)], ['Diperbarui', fmt.datetime(v.updated_at)]])));
      return;
    }
    if (key === 'access') {
      const [acc, us] = await Promise.all([call('access.list', { vehicle_id: id }), call('users.list', { role: 'user', status: 'active', pageSize: 100, sortBy: 'username', sortDir: 'asc' })]);
      const have = new Set(acc.items.map((a) => a.user_id));
      const choices = us.items.filter((u) => !have.has(u.user_id));
      const sel = h('select', { class: 'input', 'aria-label': 'Pilih pengguna' }, [h('option', { value: '' }, '— Pilih pengguna —')].concat(choices.map((u) => h('option', { value: u.user_id }, u.full_name + ' (' + u.username + ')'))));
      mount(content, h('div', { class: 'card card-pad' }, h('h2', { text: 'Pengguna yang dapat melihat kendaraan ini' }),
        h('p', { class: 'muted', text: 'Pemilik selalu memiliki akses. Pengguna lain hanya melihat bila diberi akses di sini.' }),
        acc.items.length ? h('ul', { class: 'list-plain' }, acc.items.map((a) => h('li', null, h('div', { class: 'li-main' }, h('div', { class: 'li-title', text: a.full_name }), h('div', { class: 'li-sub', text: a.username })),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => { try { await call('access.revoke', { access_id: a.access_id }); toast('Akses dicabut.', 'ok'); tabCtl.select('access'); } catch (e) { toast(errMessage(e), 'bad'); } } }, 'Cabut')))) : h('p', { class: 'muted', style: 'margin:12px 0', text: 'Belum ada akses tambahan.' }),
        h('div', { class: 'toolbar', style: 'margin-top:12px' }, h('div', { class: 'field grow' }, sel),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { if (!sel.value) return; try { await call('access.grant', { user_id: sel.value, vehicle_id: id }); toast('Akses diberikan.', 'ok'); tabCtl.select('access'); } catch (e) { toast(errMessage(e), 'bad'); } } }, icon('user-plus'), 'Berikan akses'))));
    }
  }

  const STATUS_LABEL = { SAFE: 'Aman', NEAR: 'Mendekati', DUE: 'Jatuh tempo', OVERDUE: 'Terlambat', UNKNOWN: 'Belum ada data' };
  await loadVehicle();
  renderHead();
  mount(container, head, tabCtl.el, content);
  tabCtl.select('summary');
}
