/**
 * ui.js — pembangun DOM aman (tanpa innerHTML), format Indonesia, dialog, toast, tabel, form.
 * Semua teks dinamis dimasukkan lewat textContent/createTextNode sehingga aman dari injeksi HTML.
 */
import { ICONS } from './icons.js';
import { CONFIG } from './config.js';
import { ApiError } from './api.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function icon(name, cls) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  (ICONS[name] || ICONS['circle-dashed']).forEach(([tag, attrs]) => {
    const el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    svg.appendChild(el);
  });
  return svg;
}

const BOOL_ATTRS = new Set(['disabled', 'hidden', 'checked', 'selected', 'required', 'readonly', 'multiple', 'open']);

/** h('div', {class:'x', onclick: fn}, child1, 'teks', [..]) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;      // CSSOM (diizinkan CSP tanpa 'unsafe-inline')
      else if (k === 'value') value = v;
      else if (k === 'dataset') Object.keys(v).forEach((d) => { el.dataset[d] = v[d]; });
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (BOOL_ATTRS.has(k)) { if (v) el.setAttribute(k, ''); }
      else el.setAttribute(k, v === true ? '' : String(v));
    });
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

export function append(el, kids) {
  kids.forEach((k) => {
    if (k === null || k === undefined || k === false) return;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  });
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }

/* ---------- Format Indonesia ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const nf = new Intl.NumberFormat('id-ID');
export const fmt = {
  date(s) { if (!s) return '—'; const p = String(s).split('-'); return p.length === 3 ? (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0] : String(s); },
  monthLabel(ym) { const p = String(ym).split('-'); return MON[+p[1] - 1] + ' ' + String(p[0]).slice(2); },
  datetime(iso) {
    if (!iso) return '—';
    const d = new Date(iso); if (isNaN(d)) return String(iso);
    return new Intl.DateTimeFormat('id-ID', { timeZone: CONFIG.TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  },
  num(n) { return n === '' || n === null || n === undefined ? '—' : nf.format(n); },
  km(n) { return n === '' || n === null || n === undefined ? '—' : nf.format(n) + ' km'; },
  rupiah(n) { return n === '' || n === null || n === undefined ? '—' : 'Rp ' + nf.format(n); },
  days(d) { if (d === null || d === undefined) return '—'; return d < 0 ? Math.abs(d) + ' hari lewat' : d === 0 ? 'Hari ini' : d + ' hari lagi'; },
  remKm(k) { if (k === null || k === undefined) return '—'; return k < 0 ? nf.format(Math.abs(k)) + ' km lewat' : nf.format(k) + ' km lagi'; }
};

/* ---------- Status ---------- */
export const STATUS_UI = {
  SAFE: { cls: 'b-ok', icon: 'circle-check', label: 'Aman' },
  NEAR: { cls: 'b-warn', icon: 'clock', label: 'Mendekati jadwal' },
  DUE: { cls: 'b-due', icon: 'triangle-alert', label: 'Jatuh tempo' },
  OVERDUE: { cls: 'b-bad', icon: 'circle-alert', label: 'Terlambat' },
  UNKNOWN: { cls: 'b-muted', icon: 'circle-dashed', label: 'Belum ada data' }
};
export function statusBadge(status, label) {
  const s = STATUS_UI[status] || STATUS_UI.UNKNOWN;
  return h('span', { class: 'badge ' + s.cls }, icon(s.icon), label || s.label);
}
export function verifyBadge(verified) {
  return verified === 'VERIFIED'
    ? h('span', { class: 'badge b-info', title: 'Aturan sudah diverifikasi terhadap sumber resmi' }, icon('badge-check'), 'Terverifikasi')
    : h('span', { class: 'badge b-muted', title: 'Belum diverifikasi: bukan jadwal resmi Toyota' }, icon('circle-question-mark'), 'Belum diverifikasi');
}
export function plateTag(p) { return h('span', { class: 'plate' }, p); }

/* ---------- Toast ---------- */
let toastBox = null;
export function toast(message, type = 'info') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
  const ic = type === 'ok' ? 'circle-check' : type === 'bad' ? 'circle-alert' : 'info';
  const t = h('div', { class: 'toast ' + type }, icon(ic), h('div', { text: message }));
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), type === 'bad' ? 7000 : 4500);
}

export function errMessage(e) {
  if (e instanceof ApiError) return e.message + (e.code === 'INTERNAL_ERROR' || !e.requestId ? '' : '');
  return 'Terjadi kesalahan tak terduga.';
}

/* ---------- Dialog (elemen <dialog> native: fokus & ESC dikelola browser) ---------- */
export function openModal({ title, body, footer, size }) {
  const titleId = 'm_' + Math.random().toString(36).slice(2);
  const dlg = h('dialog', { class: 'modal ' + (size || ''), 'aria-labelledby': titleId });
  const closeBtn = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Tutup', onclick: () => api.close() }, icon('x'));
  const head = h('div', { class: 'modal-head' }, h('h2', { id: titleId, text: title }), closeBtn);
  const bodyEl = h('div', { class: 'modal-body' }, body);
  dlg.appendChild(head); dlg.appendChild(bodyEl);
  if (footer && footer.length) dlg.appendChild(h('div', { class: 'modal-foot' }, footer));
  let resolveClosed; const closed = new Promise((r) => { resolveClosed = r; });
  const api = {
    el: dlg, body: bodyEl, closed,
    close(result) { api.result = result; if (dlg.open) dlg.close(); },
    result: null
  };
  dlg.addEventListener('close', () => { dlg.remove(); resolveClosed(api.result); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) api.close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  return api;
}

export function confirmDialog({ title, message, confirmText = 'Ya, lanjutkan', danger = false }) {
  const ok = h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => m.close(true) }, confirmText);
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => m.close(false) }, 'Batal');
  const m = openModal({ title, size: 'narrow', body: h('p', { text: message }), footer: [cancel, ok] });
  cancel.focus();
  return m.closed.then((r) => r === true);
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  return Promise.resolve(false);
}

/** Tampilkan kredensial sementara SEKALI. */
export function showSecret({ title, intro, secret }) {
  const copy = h('button', { class: 'btn', type: 'button', onclick: async () => { toast((await copyText(secret)) ? 'Disalin.' : 'Gagal menyalin; salin manual.', 'info'); } }, icon('copy'), 'Salin');
  const done = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Selesai');
  const m = openModal({
    title, size: 'narrow', footer: [copy, done],
    body: h('div', { class: 'stack' },
      h('p', { text: intro }),
      h('div', { class: 'secret-box', text: secret, style: 'margin:12px 0' }),
      h('div', { class: 'alert warn' }, icon('triangle-alert'), 'Password ini hanya ditampilkan sekali dan wajib diganti saat login pertama. Sampaikan lewat saluran yang aman.'))
  });
  return m.closed;
}

/* ---------- Loading / kosong / galat ---------- */
export function skeleton(rows = 4) {
  const box = h('div', { class: 'card card-pad', 'aria-busy': 'true', 'aria-label': 'Memuat' });
  for (let i = 0; i < rows; i++) box.appendChild(h('div', { class: 'skel', style: 'height:18px;margin:12px 0;width:' + (60 + ((i * 17) % 40)) + '%' }));
  return box;
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, icon(iconName)), h('h3', { text: title }), text ? h('p', { text }) : null, action ? h('div', { style: 'margin-top:14px' }, action) : null);
}

export function errorState(err, retry) {
  const msg = errMessage(err);
  return h('div', { class: 'card card-pad', role: 'alert' },
    h('div', { class: 'alert bad' }, icon('circle-alert'), h('div', null, h('strong', { text: 'Gagal memuat data. ' }), msg, err && err.requestId ? h('div', { class: 'cell-sub', text: 'Kode: ' + err.requestId }) : null)),
    retry ? h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', onclick: retry }, icon('refresh-cw'), 'Coba lagi')) : null);
}

/* ---------- Tabel & paginasi ---------- */
export function dataTable(columns, rows, opts = {}) {
  const head = h('tr', null, columns.map((c) => h('th', { scope: 'col', class: c.cls || '' }, c.label)));
  const body = h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => {
    const v = c.render ? c.render(r) : r[c.key];
    return h('td', { 'data-label': c.label || '', class: (c.cls || '') + (c.actions ? ' td-actions' : '') }, v === null || v === undefined || v === '' ? (c.actions ? null : '—') : v);
  }))));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data stack' + (opts.cls ? ' ' + opts.cls : '') }, opts.caption ? h('caption', { class: 'sr-only', text: opts.caption }) : null, h('thead', null, head), body));
}

export function pager(info, onPage) {
  const { page, totalPages, total, pageSize } = info;
  const from = total ? (page - 1) * pageSize + 1 : 0, to = Math.min(total, page * pageSize);
  return h('div', { class: 'pager' },
    h('span', { text: total ? 'Menampilkan ' + from + '–' + to + ' dari ' + fmt.num(total) : 'Tidak ada data' }),
    h('div', { class: 'btns' },
      h('button', { class: 'btn btn-sm', type: 'button', disabled: page <= 1, onclick: () => onPage(page - 1), 'aria-label': 'Halaman sebelumnya' }, icon('chevron-left'), 'Sebelumnya'),
      h('span', { class: 'btn btn-sm btn-ghost', 'aria-live': 'polite', text: page + ' / ' + totalPages }),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: page >= totalPages, onclick: () => onPage(page + 1), 'aria-label': 'Halaman berikutnya' }, 'Berikutnya', icon('chevron-right'))));
}

export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- Form ---------- */
let fid = 0;
/**
 * specs: [{name,label,type:'text|number|date|email|password|select|textarea|checkbox',options,required,hint,
 *          placeholder,maxlength,min,max,list,span2,autocomplete,disabled,inputmode}]
 */
export function buildForm(specs, values = {}) {
  const fields = {};
  const grid = h('div', { class: 'form-grid' });
  specs.forEach((s) => {
    const id = 'f' + (++fid) + '_' + s.name;
    let input;
    const v = values[s.name];
    if (s.type === 'select') {
      input = h('select', { class: 'input', id, name: s.name, disabled: s.disabled }, (s.options || []).map((o) => h('option', { value: o.value, selected: String(v === undefined || v === null ? '' : v) === String(o.value) }, o.label)));
    } else if (s.type === 'textarea') {
      input = h('textarea', { class: 'input', id, name: s.name, maxlength: s.maxlength, placeholder: s.placeholder, disabled: s.disabled }); input.value = v ?? '';
    } else if (s.type === 'checkbox') {
      input = h('input', { type: 'checkbox', id, name: s.name, checked: !!v, disabled: s.disabled });
    } else {
      input = h('input', {
        class: 'input', id, name: s.name, type: s.type || 'text', maxlength: s.maxlength, placeholder: s.placeholder, min: s.min, max: s.max,
        autocomplete: s.autocomplete || 'off', list: s.list, inputmode: s.inputmode || (s.type === 'number' ? 'numeric' : null), disabled: s.disabled, step: s.type === 'number' ? (s.step || '1') : null
      });
      input.value = v ?? '';
    }
    const err = h('div', { class: 'err hidden', id: id + '_e', role: 'alert' });
    const hint = s.hint ? h('div', { class: 'hint', id: id + '_h', text: s.hint }) : null;
    input.setAttribute('aria-describedby', [hint ? id + '_h' : '', id + '_e'].filter(Boolean).join(' '));
    if (s.required) input.setAttribute('aria-required', 'true');
    let wrap;
    if (s.type === 'checkbox') {
      wrap = h('div', { class: 'field' + (s.span2 ? ' span-2' : '') }, h('label', { class: 'check', for: id }, input, s.label), hint, err);
    } else {
      wrap = h('div', { class: 'field' + (s.span2 ? ' span-2' : '') + (s.hidden ? ' hidden' : '') }, h('label', { for: id }, s.label, s.required ? h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null), input, hint, err);
    }
    fields[s.name] = { wrap, input, err, spec: s };
    grid.appendChild(wrap);
  });
  const form = h('form', { novalidate: true }, grid);
  const api = {
    el: form, fields,
    values() {
      const out = {};
      specs.forEach((s) => {
        const i = fields[s.name].input;
        if (s.type === 'checkbox') out[s.name] = i.checked;
        else if (s.type === 'number') out[s.name] = i.value.trim() === '' ? '' : Number(i.value);
        else out[s.name] = i.value.trim();
      });
      return out;
    },
    clearErrors() { Object.values(fields).forEach((f) => { f.err.classList.add('hidden'); clear(f.err); f.input.removeAttribute('aria-invalid'); }); },
    setErrors(map) {
      api.clearErrors(); let first = null; const unknown = [];
      Object.keys(map).forEach((k) => {
        const f = fields[k];
        if (!f) { unknown.push(map[k]); return; }
        mount(f.err, icon('circle-alert'), map[k]); f.err.classList.remove('hidden'); f.input.setAttribute('aria-invalid', 'true');
        if (!first) first = f.input;
      });
      if (first) first.focus();
      return unknown;
    },
    show(name, on) { fields[name].wrap.classList.toggle('hidden', !on); }
  };
  return api;
}

export function detailsToMap(details) {
  const m = {};
  (details || []).forEach((d) => { if (d && d.field && !m[d.field]) m[d.field] = d.message; });
  return m;
}

/**
 * Dialog berisi form. Mengembalikan Promise<hasil onSubmit | null>.
 * onSubmit(values) -> hasil; melempar ApiError -> ditampilkan di dialog (galat field dipetakan ke kolom).
 */
export function formDialog({ title, specs, values, validate, submitText = 'Simpan', onSubmit, size, intro, onServerError }) {
  const form = buildForm(specs, values);
  const alertBox = h('div', { class: 'hidden', style: 'margin-bottom:12px' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, submitText);
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => m.close(null) }, 'Batal');
  const body = h('div', null, intro ? h('p', { class: 'muted', style: 'margin-bottom:12px', text: intro }) : null, alertBox, form.el);
  const m = openModal({ title, size, body, footer: [cancel, submit] });
  const showAlert = (msg) => { mount(alertBox, h('div', { class: 'alert bad', role: 'alert' }, icon('circle-alert'), msg)); alertBox.classList.remove('hidden'); };
  const run = async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('hidden');
    const vals = form.values();
    const errs = validate ? validate(vals) : {};
    if (Object.keys(errs).length) { form.setErrors(errs); return; }
    form.clearErrors();
    submit.disabled = true; cancel.disabled = true; mount(submit, h('span', { class: 'spin' }, icon('loader-circle')), 'Menyimpan…');
    try {
      const res = await onSubmit(vals);
      m.close(res === undefined ? true : res);
    } catch (e) {
      submit.disabled = false; cancel.disabled = false; mount(submit, submitText);
      if (onServerError && onServerError(e, form, showAlert)) return;
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && e.details) {
        const rest = form.setErrors(detailsToMap(e.details));
        if (rest.length) showAlert(rest.join(' '));
      } else showAlert(errMessage(e));
    }
  };
  form.el.addEventListener('submit', run);
  submit.addEventListener('click', (ev) => { if (!form.el.contains(ev.target)) run(ev); });
  return m.closed.then((r) => (r === undefined ? null : r));
}

export function tabs(items, initial, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const btns = {};
  const select = (key, focus) => {
    Object.keys(btns).forEach((k) => { btns[k].setAttribute('aria-selected', k === key ? 'true' : 'false'); btns[k].tabIndex = k === key ? 0 : -1; });
    if (focus) btns[key].focus();
    onChange(key);
  };
  items.forEach((it, idx) => {
    const b = h('button', {
      class: 'tab', role: 'tab', type: 'button', id: 'tab_' + it.key, 'aria-selected': 'false', onclick: () => select(it.key),
      onkeydown: (ev) => {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
          const n = (idx + (ev.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length; select(items[n].key, true); ev.preventDefault();
        }
      }
    }, it.label);
    btns[it.key] = b; bar.appendChild(b);
  });
  return { el: bar, select };
}
