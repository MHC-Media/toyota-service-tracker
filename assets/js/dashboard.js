/** dashboard.js — dashboard admin & pengguna. Seluruh angka berasal dari backend (dashboard.getSummary). */
import { call } from './api.js';
import { h, icon, mount, fmt, statusBadge, verifyBadge, plateTag, emptyState, errorState, STATUS_UI, skeleton } from './ui.js';
import { chartBox, barConfig, lineConfig, doughnutConfig, STATUS_COLORS, PALETTE, destroyCharts } from './charts.js';
import { isAdmin } from './auth.js';

function pct(n) { return (n > 0 ? '+' : '') + n.toLocaleString('id-ID') + '%'; }

function trendNode(t, label) {
  if (!t) return h('span', { class: 'muted', text: 'Belum ada pembanding bulan lalu' });
  const up = t.delta > 0, flat = t.delta === 0;
  return h('span', { class: 'trend' }, icon(flat ? 'minus' : up ? 'trending-up' : 'trending-down'), pct(t.percent), h('span', { class: 'muted', style: 'font-weight:400', text: ' ' + label }));
}

function kpi({ ic, label, value, sub, tone = 'info', hero = false, href }) {
  const body = [
    h('div', { class: 'kpi-top' }, h('div', { class: 'kpi-label', text: label }), h('div', { class: 'kpi-ic' }, icon(ic))),
    h('div', { class: 'kpi-value', text: value }),
    h('div', { class: 'kpi-sub' }, sub)
  ];
  return h(href ? 'a' : 'div', { class: 'card kpi k-' + tone + (hero ? ' k-hero' : ''), href, style: href ? 'color:inherit;text-decoration:none' : null }, body);
}

function chartCard(span, title, sub, box) {
  return h('section', { class: 'card chart-card ' + span, 'aria-label': title }, h('h2', { text: title }), h('div', { class: 'sub', text: sub }), box);
}

function upcomingList(rows) {
  if (!rows.length) return emptyState('calendar-clock', 'Belum ada jadwal mendatang', 'Jadwal muncul setelah aturan perawatan dan data kendaraan lengkap.');
  return h('ul', { class: 'list-plain' }, rows.map((r) => h('li', null,
    plateTag(r.plate_number),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title', text: r.service_name }),
      h('div', { class: 'li-sub', text: fmt.date(r.target_date) + ' · ' + fmt.days(r.remaining_days) + (r.target_km ? ' · ' + fmt.km(r.target_km) : '') })),
    statusBadge(r.status), r.verified_status === 'VERIFIED' ? null : verifyBadge('UNVERIFIED'))));
}

function odometerConfig(series) {
  const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
  return lineConfig(dates.map(fmt.date), series.map((s) => ({
    label: s.label, data: dates.map((d) => { const p = s.points.find((x) => x.date === d); return p ? p.odometer : null; })
  })), { unit: 'km' });
}

export async function render(container, ctx) {
  const admin = isAdmin(ctx.user);
  let months = 6;
  const periodSel = h('select', { class: 'input', id: 'period', 'aria-label': 'Periode grafik', style: 'width:auto' },
    [3, 6, 12].map((m) => h('option', { value: m, selected: m === months }, m + ' bulan terakhir')));
  const body = h('div');
  mount(container,
    h('div', { class: 'page-head' }, h('div', null, h('h2', { text: admin ? 'Ringkasan operasional' : 'Ringkasan kendaraan Anda' }), h('p', { text: 'Data aktual dari backend; tren hanya ditampilkan bila ada pembanding.' })),
      h('div', { class: 'page-actions' }, periodSel)),
    body);

  async function load() {
    destroyCharts();
    mount(body, skeleton(6));
    let d;
    try { d = await call('dashboard.getSummary', { months }); } catch (e) { mount(body, errorState(e, load)); return; }
    const k = d.kpis;
    const cards = [];
    cards.push(kpi({ ic: 'car', label: 'Kendaraan aktif', value: fmt.num(k.activeVehicles), sub: admin ? 'Seluruh armada terdaftar' : 'Terhubung ke akun Anda', tone: 'info', hero: true, href: '#/vehicles' }));
    if (admin) cards.push(kpi({ ic: 'users', label: 'Pengguna aktif', value: fmt.num(k.activeUsers), sub: 'Akun berstatus aktif', tone: 'muted', href: '#/users' }));
    cards.push(kpi({ ic: 'calendar-clock', label: 'Jatuh tempo bulan ini', value: fmt.num(k.dueThisMonth), sub: 'Pekerjaan dengan tanggal target bulan ini', tone: 'warn', href: '#/schedule' }));
    cards.push(kpi({ ic: 'circle-alert', label: 'Servis terlambat', value: fmt.num(k.overdueItems), sub: fmt.num(k.overdueVehicles) + ' kendaraan terdampak', tone: k.overdueItems ? 'bad' : 'ok', href: '#/schedule' }));
    cards.push(kpi({ ic: 'clock', label: 'Jatuh tempo ≤ 30 hari', value: fmt.num(k.dueIn30Days), sub: 'Berdasarkan tanggal target', tone: 'warn' }));
    cards.push(kpi({ ic: 'wrench', label: 'Servis bulan ini', value: fmt.num(k.servicesThisMonth), sub: trendNode(k.servicesTrend, 'vs bulan lalu'), tone: 'info' }));
    cards.push(kpi({ ic: 'receipt', label: 'Biaya servis bulan ini', value: k.costThisMonth === null ? '—' : fmt.rupiah(k.costThisMonth), sub: k.costThisMonth === null ? 'Belum ada data biaya' : trendNode(k.costTrend, 'vs bulan lalu'), tone: 'muted' }));
    cards.push(kpi({ ic: 'shield-check', label: 'Kelengkapan data', value: k.completenessPercent === null ? '—' : k.completenessPercent + '%', sub: 'Kendaraan dengan data perawatan lengkap', tone: k.completenessPercent === 100 ? 'ok' : 'warn' }));

    const c = d.charts;
    const perMonth = c.servicesPerMonth;
    const hasSvc = perMonth.some((m) => m.count > 0);
    const hasCost = perMonth.some((m) => m.cost > 0);
    const statusKeys = ['OVERDUE', 'DUE', 'NEAR', 'SAFE', 'UNKNOWN'].filter((s) => c.statusDistribution[s] > 0);
    const statusCfg = statusKeys.length ? doughnutConfig(statusKeys.map((s) => STATUS_UI[s].label + ' (' + c.statusDistribution[s] + ')'), statusKeys.map((s) => c.statusDistribution[s]), statusKeys.map((s) => STATUS_COLORS[s])) : null;
    const odo = c.odometerTrend;

    const grid = h('div', { class: 'dash-grid' },
      chartCard('span-7', 'Jumlah servis per bulan', 'Total pencatatan servis dalam ' + months + ' bulan terakhir',
        chartBox(hasSvc ? barConfig(perMonth.map((m) => fmt.monthLabel(m.month)), [{ label: 'Servis', data: perMonth.map((m) => m.count) }]) : null, 'Belum ada servis pada periode ini.', { label: 'Grafik jumlah servis per bulan' })),
      chartCard('span-5', 'Status perawatan kendaraan', 'Kendaraan menurut status terburuknya',
        chartBox(statusCfg, 'Belum ada kendaraan dengan status terhitung.', { label: 'Distribusi status perawatan' })),
      chartCard('span-7', 'Tren biaya servis per bulan', 'Dalam Rupiah',
        chartBox(hasCost ? lineConfig(perMonth.map((m) => fmt.monthLabel(m.month)), [{ label: 'Biaya', data: perMonth.map((m) => m.cost) }], { money: true }) : null, 'Belum ada data biaya pada periode ini.', { label: 'Tren biaya servis' })),
      chartCard('span-5', 'Kendaraan berdasarkan model', 'Jumlah kendaraan aktif',
        chartBox(c.vehiclesByModel.length ? barConfig(c.vehiclesByModel.map((m) => m.label), [{ label: 'Kendaraan', data: c.vehiclesByModel.map((m) => m.count) }], { horizontal: true }) : null, 'Belum ada kendaraan.', { label: 'Kendaraan per model' })),
      chartCard('span-5', 'Distribusi kategori servis', 'Dalam ' + months + ' bulan terakhir',
        chartBox(c.serviceCategories.length ? doughnutConfig(c.serviceCategories.map((x) => x.label + ' (' + x.count + ')'), c.serviceCategories.map((x) => x.count), c.serviceCategories.map((_, i) => PALETTE[i % PALETTE.length])) : null, 'Belum ada servis pada periode ini.', { label: 'Distribusi kategori servis' })),
      chartCard('span-7', 'Tren pemakaian kilometer', 'Odometer pada tiap servis (kendaraan dengan ≥ 2 catatan)',
        chartBox(odo.length ? odometerConfig(odo) : null, 'Butuh minimal dua catatan servis berodometer pada satu kendaraan.', { label: 'Tren odometer' })),
      h('section', { class: 'card card-pad span-7', 'aria-label': 'Jadwal servis mendatang' }, h('h2', { text: 'Jadwal servis mendatang' }), h('div', { class: 'sub muted', text: 'Diurutkan menurut tanggal target' }), upcomingList(c.upcoming)),
      admin ? h('section', { class: 'card card-pad span-5', 'aria-label': 'Aktivitas terbaru' }, h('h2', { text: 'Aktivitas terbaru' }),
        d.recentActivity.length ? h('ul', { class: 'list-plain' }, d.recentActivity.map((a) => h('li', null, h('div', { class: 'li-main' }, h('div', { class: 'li-title', text: a.label }), h('div', { class: 'li-sub', text: a.actor + ' · ' + fmt.datetime(a.timestamp) }))))) : emptyState('activity', 'Belum ada aktivitas', 'Aktivitas penting akan tercatat di sini.'))
        : h('section', { class: 'card card-pad span-5', 'aria-label': 'Servis terbaru' }, h('h2', { text: 'Servis terbaru' }),
          d.recentServices.length ? h('ul', { class: 'list-plain' }, d.recentServices.map((s) => h('li', null, h('div', { class: 'li-main' }, h('div', { class: 'li-title', text: s.service_type }), h('div', { class: 'li-sub', text: s.plate_number + ' · ' + fmt.date(s.service_date) + ' · ' + fmt.km(s.odometer) })), h('span', { class: 'mono', text: s.total_cost === '' ? '' : fmt.rupiah(s.total_cost) }))))
            : emptyState('file-clock', 'Belum ada riwayat servis', 'Riwayat dicatat oleh admin bengkel/pengelola.')),
      d.completeness.length ? h('section', { class: 'card card-pad span-12', 'aria-label': 'Data yang perlu dilengkapi' }, h('h2', { text: 'Data yang perlu dilengkapi' }),
        h('ul', { class: 'list-plain' }, d.completeness.map((x) => h('li', null, plateTag(x.plate_number), h('div', { class: 'li-main' }, h('div', { class: 'li-sub', text: 'Belum ada: ' + x.missing.join(', ') })), h('span', { class: 'badge b-warn', text: x.percent + '%' }))))) : null
    );

    const parts = [h('div', { class: 'kpi-grid' }, cards)];
    if (!admin && d.vehicles && d.vehicles.length) {
      parts.push(h('div', { class: 'vehicle-cards' }, d.vehicles.map((v) => h('a', { class: 'card vcard', href: '#/vehicles/' + v.vehicle_id }, h('div', null, plateTag(v.plate_number)),
        h('div', { class: 'cell-main', text: v.brand + ' ' + v.model + (v.variant ? ' ' + v.variant : '') }),
        h('div', { class: 'cell-sub', text: v.year + ' · ' + fmt.km(v.current_odometer) }),
        statusBadge(v.maintenance.status, v.maintenance.label),
        v.maintenance.next ? h('div', { class: 'cell-sub', text: 'Berikutnya: ' + v.maintenance.next.service_name + (v.maintenance.next.target_date ? ' · ' + fmt.date(v.maintenance.next.target_date) : '') }) : null))));
    }
    if (!admin && d.reminders && d.reminders.length) {
      parts.push(h('section', { class: 'card card-pad', style: 'margin-bottom:14px', 'aria-label': 'Pengingat' }, h('h2', { text: 'Pengingat servis' }),
        h('ul', { class: 'list-plain' }, d.reminders.map((r) => h('li', null, plateTag(r.plate_number), h('div', { class: 'li-main' }, h('div', { class: 'li-title', text: r.service_name }), h('div', { class: 'li-sub', text: (r.due_date ? fmt.date(r.due_date) : '') + (r.due_odometer !== '' ? ' · ' + fmt.km(r.due_odometer) : '') })), statusBadge(r.status))))));
    }
    if (admin && k.activeVehicles === 0) parts.push(emptyState('car', 'Belum ada kendaraan', 'Mulai dengan menambahkan kendaraan, lalu catat riwayat servisnya.', h('a', { class: 'btn btn-primary', href: '#/vehicles' }, icon('plus'), 'Tambah kendaraan')));
    else parts.push(grid);
    mount(body, parts);
  }

  periodSel.addEventListener('change', () => { months = Number(periodSel.value); load(); });
  await load();
  return () => destroyCharts();
}
