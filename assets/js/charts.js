/**
 * charts.js — pembungkus Chart.js (dimuat lokal dari assets/vendor/chart.umd.js sebagai global `Chart`).
 * Palet Okabe-Ito agar ramah buta warna; status juga selalu diberi label teks pada legenda.
 */
import { h } from './ui.js';

export const PALETTE = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#7a828c', '#b9a400'];
export const STATUS_COLORS = { SAFE: '#009e73', NEAR: '#e69f00', DUE: '#d55e00', OVERDUE: '#a4121f', UNKNOWN: '#7a828c' };

const live = new Set();
export function destroyCharts() { live.forEach((c) => { try { c.destroy(); } catch (e) { /* abaikan */ } }); live.clear(); }

function css(name, fb) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; }

const nfId = new Intl.NumberFormat('id-ID');
const rp = (v) => 'Rp ' + nfId.format(v);

function baseOptions(extra) {
  const text = css('--text-2', '#4a525c'), grid = css('--border', '#e3e6ea');
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: text, boxWidth: 12, usePointStyle: true } }, tooltip: { padding: 10 } },
    scales: {
      x: { ticks: { color: text }, grid: { display: false } },
      y: { ticks: { color: text, precision: 0 }, grid: { color: grid }, beginAtZero: true }
    }
  }, extra || {});
}

export function barConfig(labels, series, o = {}) {
  const opt = baseOptions({ indexAxis: o.horizontal ? 'y' : 'x' });
  if (o.horizontal) { opt.scales.x.grid = { color: css('--border', '#e3e6ea') }; opt.scales.x.beginAtZero = true; opt.scales.y.grid = { display: false }; }
  if (series.length < 2) opt.plugins.legend.display = false;
  if (o.money) opt.plugins.tooltip.callbacks = { label: (c) => c.dataset.label + ': ' + rp(c.parsed[o.horizontal ? 'x' : 'y']) };
  return {
    type: 'bar', options: opt,
    data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: s.color || PALETTE[i % PALETTE.length], borderRadius: 6, maxBarThickness: 38 })) }
  };
}

export function lineConfig(labels, series, o = {}) {
  const opt = baseOptions();
  if (series.length < 2) opt.plugins.legend.display = false;
  if (o.money) {
    opt.scales.y.ticks.callback = (v) => (v >= 1e6 ? nfId.format(v / 1e6) + ' jt' : nfId.format(v));
    opt.plugins.tooltip.callbacks = { label: (c) => c.dataset.label + ': ' + rp(c.parsed.y) };
  } else {
    opt.plugins.tooltip.callbacks = { label: (c) => c.dataset.label + ': ' + nfId.format(c.parsed.y) + (o.unit ? ' ' + o.unit : '') };
    opt.scales.y.ticks.callback = (v) => nfId.format(v);
    opt.scales.y.beginAtZero = false;
  }
  return {
    type: 'line', options: opt,
    data: {
      labels, datasets: series.map((s, i) => ({
        label: s.label, data: s.data, borderColor: s.color || PALETTE[i % PALETTE.length], backgroundColor: (s.color || PALETTE[i % PALETTE.length]) + '33',
        tension: .3, fill: series.length === 1, spanGaps: true, pointRadius: 4, pointHoverRadius: 6, pointStyle: ['circle', 'rect', 'triangle', 'rectRot', 'star'][i % 5]
      }))
    }
  };
}

export function doughnutConfig(labels, data, colors) {
  const opt = baseOptions({ cutout: '62%' });
  delete opt.scales;
  opt.plugins.legend.position = 'bottom';
  opt.plugins.tooltip.callbacks = { label: (c) => c.label + ': ' + c.parsed + ' item' };
  return { type: 'doughnut', options: opt, data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: css('--surface', '#fff'), borderWidth: 2 }] } };
}

/** Kotak grafik; bila config null tampilkan keadaan kosong yang informatif. */
export function chartBox(config, emptyText, o = {}) {
  const box = h('div', { class: 'chart-box' + (o.tall ? ' tall' : '') });
  if (!config) { box.appendChild(h('div', { class: 'chart-empty', text: emptyText || 'Belum ada data untuk ditampilkan.' })); return box; }
  if (typeof Chart === 'undefined') { box.appendChild(h('div', { class: 'chart-empty', text: 'Pustaka grafik gagal dimuat.' })); return box; }
  const canvas = h('canvas', { role: 'img', 'aria-label': o.label || 'Grafik' });
  box.appendChild(canvas);
  requestAnimationFrame(() => { if (box.isConnected) live.add(new Chart(canvas, config)); });
  return box;
}
