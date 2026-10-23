/** maintenance.js — rekomendasi perawatan, jadwal servis (pengingat), dan katalog aturan. */
import { call } from './api.js';
import { h, icon, mount, fmt, statusBadge, verifyBadge, plateTag, emptyState, errorState, skeleton, dataTable, pager, debounce, formDialog, confirmDialog, openModal, toast, errMessage } from './ui.js';
import { validateRule } from './validators.js';
import { isAdmin, isSuper } from './auth.js';

const LOGIC = [['EARLIER', 'Mana yang lebih dulu (waktu / km)'], ['LATER', 'Mana yang lebih akhir'], ['TIME_ONLY', 'Hanya waktu'], ['KM_ONLY', 'Hanya kilometer']];
const ANCHOR = [['LAST_SERVICE', 'Servis terakhir'], ['DELIVERY_DATE', 'Tanggal pengiriman']];
const SEVERITY = [['info', 'Info'], ['normal', 'Normal'], ['penting', 'Penting'], ['kritis', 'Kritis']];

function kvRow(k, v) { return v === '' || v === null || v === undefined ? null : [h('dt', { text: k }), h('dd', { text: String(v) })]; }

export function openRecDetail(it, vehicle) {
  openModal({
    title: it.service_name, size: 'wide',
    body: h('div', { class: 'stack' },
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, statusBadge(it.status), verifyBadge(it.verified_status)),
      h('p', { text: it.reason }), h('p', { class: 'cell-main', text: it.suggested_action }),
      it.description ? h('p', { class: 'muted', text: it.description }) : null,
      h('dl', { class: 'kv' }, [
        kvRow('Kendaraan', vehicle ? vehicle.plate_number : ''), kvRow('Dasar perhitungan', it.basis),
        kvRow('Interval', [it.interval_months ? it.interval_months + ' bulan' : '', it.interval_km ? fmt.km(it.interval_km) : ''].filter(Boolean).join(' / ')),
        kvRow('Servis terakhir terkait', it.last_service_date ? fmt.date(it.last_service_date) + (it.last_service_odometer ? ' · ' + fmt.km(it.last_service_odometer) : '') : 'Belum ada'),
        kvRow('Target tanggal', it.target_date ? fmt.date(it.target_date) : ''), kvRow('Target kilometer', it.target_km ? fmt.km(it.target_km) : ''),
        kvRow('Sisa waktu', it.remaining_days !== null ? fmt.days(it.remaining_days) : ''), kvRow('Sisa kilometer', it.remaining_km !== null ? fmt.remKm(it.remaining_km) : ''),
        kvRow('Perkiraan tanggal (dari pemakaian km)', it.predicted_date_by_km ? fmt.date(it.predicted_date_by_km) : ''),
        kvRow('Sumber', it.source_name ? it.source_name + (it.source_reference ? ' — ' + it.source_reference : '') : 'Tidak ada sumber tercatat')]),
      (it.warnings || []).map((w) => h('div', { class: 'alert warn' }, icon('triangle-alert'), w)),
      it.verified_status !== 'VERIFIED' ? h('div', { class: 'alert info' }, icon('info'), 'Aturan ini belum diverifikasi sehingga bukan jadwal resmi Toyota. Cocokkan dengan buku servis atau dealer resmi.') : null),
    footer: [h('button', { class: 'btn', type: 'button', onclick: (ev) => ev.target.closest('dialog').close() }, 'Tutup')]
  });
}

export function recCard(it, vehicle) {
  return h('article', { class: 'card card-pad rec rec-' + it.status.toLowerCase() },
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start' },
      h('h3', { text: it.service_name }),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, statusBadge(it.status), verifyBadge(it.verified_status))),
    h('p', { class: 'muted', text: it.reason }),
    h('div', { class: 'cell-sub', text: [it.target_date ? 'Target ' + fmt.date(it.target_date) + ' (' + fmt.days(it.remaining_days) + ')' : '', it.target_km ? 'Target ' + fmt.km(it.target_km) + ' (' + fmt.remKm(it.remaining_km) + ')' : ''].filter(Boolean).join(' · ') }),
    h('p', { class: 'cell-main', style: 'margin-top:8px', text: it.suggested_action }),
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openRecDetail(it, vehicle) }, icon('info'), 'Penjelasan lengkap')));
}

/* ---------------- rekomendasi ---------------- */
export async function recommendations(container, ctx) {
  const vr = await call('vehicles.list', { pageSize: 100, sortBy: 'plate_number', sortDir: 'asc' });
  if (!vr.items.length) { mount(container, emptyState('car', 'Belum ada kendaraan', 'Rekomendasi muncul setelah ada kendaraan yang dapat Anda akses.')); return; }
  const sel = h('select', { class: 'input', 'aria-label': 'Pilih kendaraan' }, vr.items.map((v) => h('option', { value: v.vehicle_id, selected: v.vehicle_id === ctx.query.vehicle_id }, v.plate_number + ' · ' + v.model)));
  const fstat = h('select', { class: 'input', 'aria-label': 'Filter status' }, [['', 'Semua status'], ['OVERDUE', 'Terlambat'], ['DUE', 'Jatuh tempo'], ['NEAR', 'Mendekati'], ['SAFE', 'Aman'], ['UNKNOWN', 'Belum ada data']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div');
  let data = null;
  function draw() {
    const items = data.items.filter((i) => !fstat.value || i.status === fstat.value);
    mount(out, h('div', { class: 'alert info', style: 'margin-bottom:14px' }, icon('info'), data.disclaimer),
      data.warnings.map((w) => h('div', { class: 'alert warn', style: 'margin-bottom:10px' }, icon('triangle-alert'), w)),
      items.length ? h('div', { class: 'rec-list' }, items.map((i) => recCard(i, data.vehicle))) : emptyState('wrench', 'Tidak ada rekomendasi', 'Belum ada aturan yang cocok dengan kendaraan ini atau filter terlalu ketat.'));
  }
  async function load() {
    mount(out, skeleton(4));
    try { data = await call('recommendations.get', { vehicle_id: sel.value }); draw(); } catch (e) { mount(out, errorState(e, load)); }
  }
  sel.addEventListener('change', load); fstat.addEventListener('change', () => data && draw());
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Rekomendasi perawatan' }), h('p', { text: 'Dihitung dari aturan perawatan, riwayat servis, dan data kendaraan.' }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, sel), h('div', { class: 'field' }, fstat)), out);
  await load();
}

/* ---------------- jadwal (pengingat) ---------------- */
export async function schedule(container, ctx) {
  const admin = isAdmin(ctx.user);
  const vr = await call('vehicles.list', { pageSize: 100, sortBy: 'plate_number', sortDir: 'asc' });
  const vsel = h('select', { class: 'input', 'aria-label': 'Kendaraan' }, [h('option', { value: '' }, 'Semua kendaraan')].concat(vr.items.map((v) => h('option', { value: v.vehicle_id }, v.plate_number))));
  const ssel = h('select', { class: 'input', 'aria-label': 'Status' }, [['', 'Belum selesai'], ['OVERDUE', 'Terlambat'], ['DUE', 'Jatuh tempo'], ['NEAR', 'Mendekati'], ['RESOLVED', 'Selesai']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div', { class: 'card' });
  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('reminders.list', { vehicle_id: vsel.value || undefined, status: ssel.value || undefined });
      if (!r.items.length) { mount(out, emptyState('calendar-clock', 'Tidak ada jadwal', 'Tidak ada pengingat sesuai filter. Admin dapat menyegarkan pengingat dari aturan terbaru.')); return; }
      mount(out, dataTable([
        { label: 'Kendaraan', render: (x) => h('div', null, plateTag(x.plate_number), h('div', { class: 'cell-sub', text: x.vehicle_label })) },
        { label: 'Servis', render: (x) => h('div', null, h('div', { class: 'cell-main', text: x.service_name }), x.verified_status !== 'VERIFIED' ? verifyBadge('UNVERIFIED') : null) },
        { label: 'Jatuh tempo', cls: 'nowrap', render: (x) => x.due_date ? fmt.date(x.due_date) : '—' },
        { label: 'Kilometer', cls: 'mono nowrap', render: (x) => x.due_odometer ? fmt.km(x.due_odometer) : '—' },
        { label: 'Status', render: (x) => statusBadge(x.status === 'RESOLVED' ? 'SAFE' : x.status, x.status_label) },
        { label: 'Aksi', actions: true, render: (x) => h('a', { class: 'btn btn-sm', href: '#/recommendations?vehicle_id=' + x.vehicle_id }, 'Lihat rekomendasi') }
      ], r.items, { caption: 'Jadwal servis' }));
    } catch (e) { mount(out, errorState(e, load)); }
  }
  vsel.addEventListener('change', load); ssel.addEventListener('change', load);
  async function sync() {
    try { const r = await call('reminders.sync', {}); toast('Pengingat disegarkan: ' + r.created + ' baru, ' + r.updated + ' diperbarui, ' + r.resolved + ' selesai.', 'ok'); load(); ctx.refreshBell(); }
    catch (e) { toast(errMessage(e), 'bad'); }
  }
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Jadwal servis' }), h('p', { text: 'Pengingat dalam aplikasi untuk servis yang mendekati atau melewati jadwal.' })),
    admin ? h('div', { class: 'page-actions' }, h('button', { class: 'btn', type: 'button', onclick: sync }, icon('refresh-cw'), 'Segarkan pengingat')) : null),
    h('div', { class: 'toolbar' }, h('div', { class: 'field' }, vsel), h('div', { class: 'field' }, ssel)), out);
  await load();
}

/* ---------------- katalog aturan ---------------- */
function openRuleForm(rule) {
  const editing = !!rule;
  const specs = [
    { name: 'service_code', label: 'Kode servis', required: true, maxlength: 40, placeholder: 'OIL_CHANGE', hint: 'Huruf besar, angka, . _ -' },
    { name: 'service_name', label: 'Nama servis', required: true, maxlength: 100 },
    { name: 'category', label: 'Kategori', required: true, maxlength: 40, placeholder: 'mis. Mesin, Rem, Ban' },
    { name: 'severity', label: 'Tingkat kepentingan', type: 'select', options: SEVERITY.map(([v, l]) => ({ value: v, label: l })) },
    { name: 'model_scope', label: 'Cakupan model', maxlength: 200, placeholder: '*', hint: '* = semua model, atau daftar dipisah koma (Avanza, Veloz).' },
    { name: 'model_year_scope', label: 'Cakupan tahun', maxlength: 200, placeholder: '*', hint: '*, 2020, atau rentang 2018-2022.' },
    { name: 'engine_scope', label: 'Cakupan mesin', maxlength: 200, placeholder: '*' },
    { name: 'due_logic', label: 'Logika jatuh tempo', type: 'select', options: LOGIC.map(([v, l]) => ({ value: v, label: l })) },
    { name: 'anchor', label: 'Titik acuan', type: 'select', options: ANCHOR.map(([v, l]) => ({ value: v, label: l })) },
    { name: 'interval_months', label: 'Interval (bulan)', type: 'number', min: 1, max: 240 },
    { name: 'interval_km', label: 'Interval (km)', type: 'number', min: 1, max: 1000000 },
    { name: 'initial_service_months', label: 'Servis pertama (bulan)', type: 'number', min: 1, max: 240 },
    { name: 'initial_service_km', label: 'Servis pertama (km)', type: 'number', min: 1, max: 1000000 },
    { name: 'effective_from', label: 'Berlaku mulai', type: 'date' },
    { name: 'effective_until', label: 'Berlaku sampai', type: 'date' },
    { name: 'source_name', label: 'Nama sumber', maxlength: 120, placeholder: 'mis. Buku Pedoman Pemilik', span2: true },
    { name: 'source_reference', label: 'Referensi sumber', maxlength: 200, placeholder: 'mis. halaman / bab / URL', span2: true },
    { name: 'description', label: 'Deskripsi', type: 'textarea', maxlength: 500, span2: true },
    { name: 'applicability_notes', label: 'Catatan keberlakuan', type: 'textarea', maxlength: 500, span2: true },
    { name: 'active', label: 'Aturan aktif', type: 'checkbox' }
  ];
  const values = Object.assign({ severity: 'normal', due_logic: 'EARLIER', anchor: 'LAST_SERVICE', model_scope: '*', model_year_scope: '*', engine_scope: '*', active: true }, rule || {});
  return formDialog({
    title: editing ? 'Ubah aturan perawatan' : 'Tambah aturan perawatan', size: 'wide', specs, values, validate: validateRule,
    intro: editing ? 'Mengubah interval, cakupan, atau logika pada aturan terverifikasi akan mengembalikan statusnya ke "Belum diverifikasi".' : 'Aturan baru selalu berstatus "Belum diverifikasi" sampai superadmin memverifikasi dengan sumber.',
    submitText: editing ? 'Simpan perubahan' : 'Tambah aturan',
    onSubmit: (v) => { const p = Object.assign({}, v); if (editing) p.rule_id = rule.rule_id; return call(editing ? 'maintenanceRules.update' : 'maintenanceRules.create', p); }
  });
}

export async function rules(container, ctx) {
  const admin = isAdmin(ctx.user), sup = isSuper(ctx.user);
  const st = { search: '', verified_status: '', page: 1 };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cari kode atau nama servis…', 'aria-label': 'Cari aturan' });
  const vsel = h('select', { class: 'input', 'aria-label': 'Status verifikasi' }, [['', 'Semua status verifikasi'], ['VERIFIED', 'Terverifikasi'], ['UNVERIFIED', 'Belum diverifikasi']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div', { class: 'card' });
  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('maintenanceRules.list', { search: st.search, verified_status: st.verified_status, page: st.page, pageSize: 15 });
      if (!r.items.length) { mount(out, emptyState('book-open', 'Belum ada aturan', admin ? 'Tambahkan aturan dari buku servis resmi, atau muat aturan contoh lewat setup.' : 'Admin belum menambahkan aturan.')); return; }
      mount(out, dataTable([
        { label: 'Servis', render: (x) => h('div', null, h('div', { class: 'cell-main', text: x.service_name }), h('div', { class: 'cell-sub mono', text: x.service_code + ' · ' + x.category })) },
        { label: 'Interval', render: (x) => [x.interval_months ? x.interval_months + ' bulan' : '', x.interval_km ? fmt.km(x.interval_km) : ''].filter(Boolean).join(' / ') || '—' },
        { label: 'Cakupan', render: (x) => h('div', { class: 'cell-sub', text: 'Model: ' + x.model_scope + ' · Tahun: ' + x.model_year_scope + ' · Mesin: ' + x.engine_scope }) },
        { label: 'Sumber', render: (x) => x.source_name ? h('div', { class: 'cell-sub', text: x.source_name + (x.source_reference ? ' — ' + x.source_reference : '') }) : h('span', { class: 'muted', text: 'Tidak ada' }) },
        { label: 'Status', render: (x) => h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, verifyBadge(x.verified_status), x.active ? null : h('span', { class: 'badge b-muted' }, icon('ban'), 'Nonaktif')) },
        { label: 'Aksi', actions: true, render: (x) => admin ? h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'Ubah', 'aria-label': 'Ubah aturan ' + x.service_name, onclick: async () => { if (await openRuleForm(x)) { toast('Aturan disimpan.', 'ok'); load(); } } }, icon('pencil')),
          sup ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => toggleVerify(x) }, icon('shield-check'), x.verified_status === 'VERIFIED' ? 'Cabut verifikasi' : 'Verifikasi') : null) : null }
      ], r.items, { caption: 'Katalog aturan perawatan' }), pager(r, (p) => { st.page = p; load(); }));
    } catch (e) { mount(out, errorState(e, load)); }
  }
  async function toggleVerify(x) {
    const to = x.verified_status === 'VERIFIED' ? 'UNVERIFIED' : 'VERIFIED';
    const ok = await confirmDialog({ title: to === 'VERIFIED' ? 'Verifikasi aturan?' : 'Cabut verifikasi?', message: to === 'VERIFIED' ? 'Pastikan nama sumber dan referensi sudah benar dan interval cocok dengan sumber tersebut. Aturan akan tampil sebagai terverifikasi.' : 'Aturan akan kembali berstatus belum diverifikasi.', confirmText: to === 'VERIFIED' ? 'Verifikasi' : 'Cabut' });
    if (!ok) return;
    try { await call('maintenanceRules.verify', { rule_id: x.rule_id, status: to }); toast('Status verifikasi diperbarui.', 'ok'); load(); } catch (e) { toast(errMessage(e), 'bad'); }
  }
  search.addEventListener('input', debounce(() => { st.search = search.value.trim(); st.page = 1; load(); }, 300));
  vsel.addEventListener('change', () => { st.verified_status = vsel.value; st.page = 1; load(); });
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Katalog aturan perawatan' }), h('p', { text: 'Aturan menentukan jadwal rekomendasi. Interval resmi Toyota hanya ditandai terverifikasi bila ada sumber.' })),
    admin ? h('div', { class: 'page-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { if (await openRuleForm(null)) { toast('Aturan ditambahkan.', 'ok'); load(); } } }, icon('plus'), 'Tambah aturan')) : null),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow search' }, icon('search'), search), h('div', { class: 'field' }, vsel)), out);
  await load();
}
