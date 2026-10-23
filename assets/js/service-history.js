/** service-history.js — daftar riwayat servis, form catat/ubah servis, dan timeline. */
import { call } from './api.js';
import { h, icon, mount, fmt, emptyState, errorState, skeleton, dataTable, pager, debounce, formDialog, toast, errMessage, detailsToMap, plateTag, openModal } from './ui.js';
import { validateService } from './validators.js';
import { isAdmin } from './auth.js';

export const CATEGORIES = [['berkala', 'Berkala'], ['perbaikan', 'Perbaikan'], ['penggantian', 'Penggantian'], ['inspeksi', 'Inspeksi'], ['garansi', 'Garansi'], ['lainnya', 'Lainnya']];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

function listId() { return 'rulecodes_' + Math.random().toString(36).slice(2); }

/** Dialog catat/ubah servis. opts: {vehicle?, record?}. Mengembalikan hasil atau null. */
export async function openServiceForm(opts) {
  const rec = opts.record || null;
  let vehicle = opts.vehicle || null;
  let vehicleOptions = null;
  if (!vehicle) {
    const r = await call('vehicles.list', { pageSize: 100, sortBy: 'plate_number', sortDir: 'asc' });
    vehicleOptions = [{ value: '', label: '— Pilih kendaraan —' }].concat(r.items.map((v) => ({ value: v.vehicle_id, label: v.plate_number + ' · ' + v.model })));
  }
  // saran kode servis dari katalog aturan (opsional; gagal tidak menghalangi form)
  let codes = [];
  try { const r = await call('maintenanceRules.list', { pageSize: 100, active: true }); codes = Array.from(new Set(r.items.map((x) => x.service_code))); } catch (e) { /* abaikan */ }
  const dl = h('datalist', { id: listId() }, codes.map((c) => h('option', { value: c })));
  const specs = [];
  if (!vehicle) specs.push({ name: 'vehicle_id', label: 'Kendaraan', type: 'select', required: true, options: vehicleOptions, disabled: !!rec, span2: true });
  specs.push(
    { name: 'service_date', label: 'Tanggal servis', type: 'date', required: true },
    { name: 'odometer', label: 'Kilometer saat servis', type: 'number', required: true, min: 0, max: 2000000 },
    { name: 'service_type', label: 'Jenis servis', required: true, maxlength: 80, placeholder: 'mis. Servis berkala 10.000 km' },
    { name: 'service_category', label: 'Kategori', type: 'select', required: true, options: CATEGORIES.map(([v, l]) => ({ value: v, label: l })) },
    { name: 'service_codes', label: 'Kode servis (opsional)', maxlength: 120, list: dl.id, placeholder: 'mis. OIL_CHANGE, TIRE_ROTATION', hint: 'Pisahkan dengan koma. Dipakai untuk mereset jadwal aturan terkait.', span2: true },
    { name: 'dealer_name', label: 'Dealer', maxlength: 80 },
    { name: 'workshop_name', label: 'Bengkel', maxlength: 80 },
    { name: 'service_advisor', label: 'Service advisor', maxlength: 80 },
    { name: 'invoice_reference', label: 'No. invoice', maxlength: 60 },
    { name: 'complaint', label: 'Keluhan', type: 'textarea', maxlength: 500, span2: true },
    { name: 'diagnosis', label: 'Diagnosis', type: 'textarea', maxlength: 500, span2: true },
    { name: 'work_performed', label: 'Pekerjaan dilakukan', type: 'textarea', maxlength: 1000, span2: true },
    { name: 'parts_replaced', label: 'Suku cadang diganti', type: 'textarea', maxlength: 500, span2: true },
    { name: 'oil_type', label: 'Jenis oli', maxlength: 60 },
    { name: 'oil_quantity', label: 'Jumlah oli (liter)', type: 'number', min: 0, max: 100, step: '0.1' },
    { name: 'labor_cost', label: 'Biaya jasa (Rp)', type: 'number', min: 0 },
    { name: 'parts_cost', label: 'Biaya suku cadang (Rp)', type: 'number', min: 0 },
    { name: 'additional_cost', label: 'Biaya tambahan (Rp)', type: 'number', min: 0 },
    { name: 'next_recommended_date', label: 'Servis berikutnya (tanggal)', type: 'date' },
    { name: 'next_recommended_odometer', label: 'Servis berikutnya (km)', type: 'number', min: 0, max: 2000000 },
    { name: 'notes', label: 'Catatan', type: 'textarea', maxlength: 500, span2: true },
    { name: 'correction_reason', label: 'Alasan koreksi', maxlength: 200, span2: true, hidden: true, hint: 'Diperlukan karena kilometer/tanggal tidak konsisten dengan servis lain (min. 5 karakter).' }
  );
  const values = Object.assign({ service_category: 'berkala' }, rec || {});
  if (vehicle) values.vehicle_id = vehicle.vehicle_id;
  if (rec && Array.isArray(rec.service_codes)) values.service_codes = rec.service_codes.join(', ');
  const result = await formDialog({
    title: rec ? 'Ubah riwayat servis' : 'Catat servis' + (vehicle ? ' — ' + vehicle.plate_number : ''),
    size: 'wide', specs, values, submitText: rec ? 'Simpan perubahan' : 'Simpan servis',
    intro: 'Total biaya dihitung otomatis oleh server dari jasa + suku cadang + tambahan.',
    validate: (v) => validateService(Object.assign({}, v, { vehicle_id: v.vehicle_id || (vehicle && vehicle.vehicle_id) || '' })),
    onServerError: (e, form) => {
      if (e.code === 'VALIDATION_ERROR' && e.details && e.details.some((d) => /alasan koreksi/i.test(d.message || ''))) {
        form.show('correction_reason', true); form.setErrors(detailsToMap(e.details)); return true;
      }
      return false;
    },
    onSubmit: async (v) => {
      const p = {};
      Object.keys(v).forEach((k) => { if (v[k] !== '' || rec) p[k] = v[k]; });
      if (vehicle) p.vehicle_id = vehicle.vehicle_id;
      if (!p.correction_reason) delete p.correction_reason;
      if (rec) { p.service_id = rec.service_id; delete p.vehicle_id; return call('serviceHistory.update', p); }
      return call('serviceHistory.create', p);
    }
  });
  if (result) toast(rec ? 'Riwayat servis diperbarui.' : 'Servis dicatat.', 'ok');
  return result;
}

function costBreakdown(s) {
  return h('div', { class: 'cell-sub', text: 'Jasa ' + fmt.rupiah(s.labor_cost || 0) + ' · Suku cadang ' + fmt.rupiah(s.parts_cost || 0) + ' · Tambahan ' + fmt.rupiah(s.additional_cost || 0) });
}

export function openServiceDetail(s) {
  const row = (k, v) => (v === '' || v === null || v === undefined ? null : [h('dt', { text: k }), h('dd', { text: String(v) })]);
  openModal({
    title: s.service_type, size: 'wide',
    body: h('dl', { class: 'kv' }, [
      row('Kendaraan', s.plate_number ? s.plate_number + ' · ' + s.vehicle_label : ''), row('Tanggal', fmt.date(s.service_date)), row('Kilometer', fmt.km(s.odometer)),
      row('Kategori', CAT_LABEL[s.service_category] || s.service_category), row('Kode servis', s.service_codes), row('Dealer', s.dealer_name), row('Bengkel', s.workshop_name),
      row('Service advisor', s.service_advisor), row('No. invoice', s.invoice_reference), row('Keluhan', s.complaint), row('Diagnosis', s.diagnosis),
      row('Pekerjaan', s.work_performed), row('Suku cadang', s.parts_replaced), row('Oli', [s.oil_type, s.oil_quantity !== '' ? s.oil_quantity + ' L' : ''].filter(Boolean).join(' · ')),
      row('Biaya jasa', fmt.rupiah(s.labor_cost || 0)), row('Biaya suku cadang', fmt.rupiah(s.parts_cost || 0)), row('Biaya tambahan', fmt.rupiah(s.additional_cost || 0)), row('Total biaya', fmt.rupiah(s.total_cost || 0)),
      row('Servis berikutnya', [s.next_recommended_date ? fmt.date(s.next_recommended_date) : '', s.next_recommended_odometer !== '' ? fmt.km(s.next_recommended_odometer) : ''].filter(Boolean).join(' · ')),
      row('Catatan', s.notes), row('Dicatat', fmt.datetime(s.created_at))
    ]),
    footer: [h('button', { class: 'btn', type: 'button', onclick: (ev) => ev.target.closest('dialog').close() }, 'Tutup')]
  });
}

/** Timeline vertikal untuk satu kendaraan. */
export function serviceTimeline(items, { admin, onChanged }) {
  return h('ol', { class: 'timeline' }, items.map((s) => h('li', { class: 'tl-item' },
    h('div', { class: 'tl-date' }, h('strong', { text: fmt.date(s.service_date) }), h('div', { class: 'cell-sub', text: fmt.km(s.odometer) })),
    h('div', { class: 'tl-body' },
      h('div', { class: 'cell-main', text: s.service_type }),
      h('div', { class: 'cell-sub', text: (CAT_LABEL[s.service_category] || s.service_category) + (s.workshop_name || s.dealer_name ? ' · ' + (s.workshop_name || s.dealer_name) : '') + ' · ' + fmt.rupiah(s.total_cost || 0) }),
      s.work_performed ? h('p', { class: 'muted', text: s.work_performed }) : null,
      h('div', { class: 'row-actions', style: 'margin-top:6px' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openServiceDetail(s) }, icon('eye'), 'Rincian'),
        admin ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await openServiceForm({ record: s, vehicle: { vehicle_id: s.vehicle_id, plate_number: s.plate_number } })) onChanged(); } }, icon('pencil'), 'Ubah') : null)))));
}

function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export { downloadCsv };

export async function render(container, ctx) {
  const admin = isAdmin(ctx.user);
  const st = { search: '', category: '', vehicle_id: ctx.query.vehicle_id || '', from: '', to: '', sortBy: 'service_date', sortDir: 'desc', page: 1 };
  const vr = await call('vehicles.list', { pageSize: 100, sortBy: 'plate_number', sortDir: 'asc' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cari jenis servis, pekerjaan, bengkel, invoice…', 'aria-label': 'Cari riwayat servis' });
  const vsel = h('select', { class: 'input', 'aria-label': 'Kendaraan' }, [h('option', { value: '' }, 'Semua kendaraan')].concat(vr.items.map((v) => h('option', { value: v.vehicle_id, selected: v.vehicle_id === st.vehicle_id }, v.plate_number))));
  const csel = h('select', { class: 'input', 'aria-label': 'Kategori' }, [h('option', { value: '' }, 'Semua kategori')].concat(CATEGORIES.map(([v, l]) => h('option', { value: v }, l))));
  const from = h('input', { class: 'input', type: 'date', 'aria-label': 'Dari tanggal' });
  const to = h('input', { class: 'input', type: 'date', 'aria-label': 'Sampai tanggal' });
  const out = h('div', { class: 'card' });

  const params = () => ({ search: st.search, category: st.category, vehicle_id: st.vehicle_id || undefined, from: st.from, to: st.to, sortBy: st.sortBy, sortDir: st.sortDir });

  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('serviceHistory.list', Object.assign(params(), { page: st.page, pageSize: 15 }));
      if (!r.items.length) { mount(out, emptyState('file-clock', 'Tidak ada riwayat servis', 'Ubah filter, atau ' + (admin ? 'catat servis baru.' : 'tunggu admin mencatat servis.'))); return; }
      mount(out, dataTable([
        { label: 'Tanggal', cls: 'nowrap', render: (s) => fmt.date(s.service_date) },
        { label: 'Kendaraan', render: (s) => h('div', null, plateTag(s.plate_number), h('div', { class: 'cell-sub', text: s.vehicle_label })) },
        { label: 'Servis', render: (s) => h('div', null, h('div', { class: 'cell-main', text: s.service_type }), h('div', { class: 'cell-sub', text: CAT_LABEL[s.service_category] || s.service_category })) },
        { label: 'Odometer', cls: 'mono nowrap', render: (s) => fmt.km(s.odometer) },
        { label: 'Total biaya', cls: 'mono nowrap', render: (s) => h('div', null, fmt.rupiah(s.total_cost || 0), costBreakdown(s)) },
        { label: 'Aksi', actions: true, render: (s) => h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openServiceDetail(s) }, icon('eye'), 'Rincian'),
          admin ? h('button', { class: 'btn btn-sm btn-icon', type: 'button', 'aria-label': 'Ubah servis ' + s.service_type, title: 'Ubah', onclick: async () => { if (await openServiceForm({ record: s, vehicle: { vehicle_id: s.vehicle_id, plate_number: s.plate_number } })) load(); } }, icon('pencil')) : null) }
      ], r.items, { caption: 'Riwayat servis' }), pager(r, (p) => { st.page = p; load(); }));
    } catch (e) { mount(out, errorState(e, load)); }
  }

  async function exportCsv() {
    try {
      const r = await call('reports.export', { report: 'serviceHistoryByVehicle', vehicle_id: st.vehicle_id || undefined, from: st.from, to: st.to });
      downloadCsv(r.filename, r.csv); toast('Ekspor selesai (' + r.rows + ' baris).', 'ok');
    } catch (e) { toast(errMessage(e), 'bad'); }
  }
  async function add() { if (await openServiceForm({})) load(); }

  const reload = () => { st.page = 1; load(); };
  search.addEventListener('input', debounce(() => { st.search = search.value.trim(); reload(); }, 300));
  vsel.addEventListener('change', () => { st.vehicle_id = vsel.value; reload(); });
  csel.addEventListener('change', () => { st.category = csel.value; reload(); });
  from.addEventListener('change', () => { st.from = from.value; reload(); });
  to.addEventListener('change', () => { st.to = to.value; reload(); });

  mount(container,
    h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Riwayat servis' }), h('p', { text: 'Seluruh catatan servis kendaraan yang dapat Anda akses.' })),
      h('div', { class: 'page-actions' }, h('button', { class: 'btn', type: 'button', onclick: exportCsv }, icon('download'), 'Ekspor CSV'),
        admin ? h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, icon('plus'), 'Catat servis') : null)),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow search' }, icon('search'), search), h('div', { class: 'field' }, vsel), h('div', { class: 'field' }, csel),
      h('div', { class: 'field' }, from), h('div', { class: 'field' }, to)),
    out);
  await load();
}
