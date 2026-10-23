/** reports.js — laporan tabel + ekspor CSV (proteksi formula injection dilakukan di backend). */
import { call } from './api.js';
import { h, icon, mount, fmt, emptyState, errorState, skeleton, toast, errMessage } from './ui.js';
import { isAdmin } from './auth.js';
import { downloadCsv } from './service-history.js';

const REPORTS = [
  ['serviceHistoryByVehicle', 'Riwayat servis per kendaraan'], ['upcomingServices', 'Jadwal servis mendatang'], ['overdueVehicles', 'Kendaraan terlambat servis'],
  ['monthlyCost', 'Rekap biaya per bulan'], ['serviceFrequency', 'Frekuensi jenis servis'], ['dataCompleteness', 'Kelengkapan data perawatan'], ['activeUsersVehicles', 'Pengguna & kendaraan aktif', true]
];

export async function render(container, ctx) {
  const admin = isAdmin(ctx.user);
  const vr = await call('vehicles.list', { pageSize: 100, sortBy: 'plate_number', sortDir: 'asc' });
  const rsel = h('select', { class: 'input', 'aria-label': 'Jenis laporan' }, REPORTS.filter((r) => !r[2] || admin).map(([v, l]) => h('option', { value: v }, l)));
  const vsel = h('select', { class: 'input', 'aria-label': 'Kendaraan' }, [h('option', { value: '' }, 'Semua kendaraan')].concat(vr.items.map((v) => h('option', { value: v.vehicle_id }, v.plate_number))));
  const from = h('input', { class: 'input', type: 'date', 'aria-label': 'Dari tanggal' });
  const to = h('input', { class: 'input', type: 'date', 'aria-label': 'Sampai tanggal' });
  const out = h('div', { class: 'card' });
  const params = () => ({ report: rsel.value, vehicle_id: vsel.value || undefined, from: from.value, to: to.value });
  const numeric = /cost|biaya|total|count|jumlah|odometer|km|vehicles|kendaraan/i;

  async function load() {
    mount(out, h('div', { class: 'card-pad' }, skeleton(4)));
    try {
      const r = await call('reports.get', params());
      if (!r.rows.length) { mount(out, emptyState('chart-column', 'Tidak ada data', 'Tidak ada data untuk laporan dan filter ini.')); return; }
      const head = h('tr', null, r.columns.map((c) => h('th', { scope: 'col', text: c.label })));
      const body = h('tbody', null, r.rows.map((row) => h('tr', null, r.columns.map((c) => {
        const v = row[c.key]; const isNum = typeof v === 'number';
        return h('td', { 'data-label': c.label, class: isNum ? 'mono' : '' }, v === '' || v === null || v === undefined ? '—' : (isNum && /cost|biaya|total/i.test(c.key) ? fmt.rupiah(v) : isNum && numeric.test(c.key) ? fmt.num(v) : String(v)));
      }))));
      mount(out, h('div', { class: 'card-pad' }, h('h2', { text: r.title }), h('p', { class: 'cell-sub', text: r.totalRows + ' baris' + (r.truncated ? ' (ditampilkan sebagian — ekspor untuk data lengkap)' : '') })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data stack' }, h('thead', null, head), body)));
    } catch (e) { mount(out, errorState(e, load)); }
  }
  async function exp() {
    try { const r = await call('reports.export', params()); downloadCsv(r.filename, r.csv); toast('Ekspor selesai (' + r.rows + ' baris).', 'ok'); } catch (e) { toast(errMessage(e), 'bad'); }
  }
  [rsel, vsel, from, to].forEach((el) => el.addEventListener('change', load));
  mount(container, h('div', { class: 'page-head' }, h('div', null, h('h2', { text: 'Laporan & ekspor' }), h('p', { text: 'Ekspor CSV memakai pengaman formula spreadsheet dan hanya memuat data yang boleh Anda lihat.' })),
    h('div', { class: 'page-actions' }, h('button', { class: 'btn', type: 'button', onclick: exp }, icon('download'), 'Ekspor CSV'))),
    h('div', { class: 'toolbar' }, h('div', { class: 'field grow' }, rsel), h('div', { class: 'field' }, vsel), h('div', { class: 'field' }, from), h('div', { class: 'field' }, to)), out);
  await load();
}
