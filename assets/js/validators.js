/**
 * validators.js — validasi di sisi klien (kenyamanan pengguna). Sumber kebenaran tetap backend;
 * aturan di sini mencerminkan gas/Validation.gs dan layanan terkait.
 */
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const RE_PLATE = /^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}$/;
export const RE_USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1980 && y <= 2100;
}

const blank = (v) => v === '' || v === null || v === undefined;

function req(e, v, k) { if (blank(v[k])) e[k] = 'Wajib diisi.'; }
function int(e, v, k, min, max) {
  if (blank(v[k])) return;
  const n = Number(v[k]);
  if (!Number.isFinite(n) || !Number.isInteger(n)) e[k] = 'Harus bilangan bulat.';
  else if (n < min) e[k] = 'Minimal ' + min + '.';
  else if (n > max) e[k] = 'Maksimal ' + max + '.';
}
function date(e, v, k, notFuture) {
  if (blank(v[k])) return;
  if (!isDate(v[k])) e[k] = 'Tanggal tidak valid.';
  else if (notFuture && v[k] > todayStr()) e[k] = 'Tanggal tidak boleh di masa depan.';
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || !pw) return 'Wajib diisi.';
  if (pw.length < 12) return 'Minimal 12 karakter.';
  if (pw.length > 128) return 'Maksimal 128 karakter.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Harus memuat huruf besar, huruf kecil, dan angka.';
  return null;
}

export function validateVehicle(v) {
  const e = {};
  req(e, v, 'plate_number'); req(e, v, 'model'); req(e, v, 'year');
  if (!blank(v.plate_number)) {
    const p = String(v.plate_number).toUpperCase().replace(/\s+/g, ' ').trim();
    if (!RE_PLATE.test(p)) e.plate_number = 'Format nomor polisi tidak valid (contoh: KH 1234 AB).';
  }
  int(e, v, 'year', 1980, new Date().getFullYear() + 1);
  int(e, v, 'current_odometer', 0, 2000000);
  date(e, v, 'purchase_date', true); date(e, v, 'delivery_date', true); date(e, v, 'warranty_end_date', false);
  if (!blank(v.vin_last4) && !/^[A-Za-z0-9]{4}$/.test(v.vin_last4)) e.vin_last4 = 'Harus 4 karakter huruf/angka.';
  if (!e.purchase_date && !e.delivery_date && v.purchase_date && v.delivery_date && v.delivery_date < v.purchase_date) {
    e.delivery_date = 'Tanggal pengiriman tidak boleh sebelum tanggal pembelian.';
  }
  return e;
}

export function validateService(v) {
  const e = {};
  req(e, v, 'vehicle_id'); req(e, v, 'service_date'); req(e, v, 'odometer'); req(e, v, 'service_type'); req(e, v, 'service_category');
  date(e, v, 'service_date', true); date(e, v, 'next_recommended_date', false);
  int(e, v, 'odometer', 0, 2000000); int(e, v, 'next_recommended_odometer', 0, 2000000);
  ['labor_cost', 'parts_cost', 'additional_cost'].forEach((k) => int(e, v, k, 0, 100000000000));
  if (!blank(v.oil_quantity) && !(Number(v.oil_quantity) >= 0 && Number(v.oil_quantity) <= 100)) e.oil_quantity = 'Isi 0–100 liter.';
  if (!e.service_date && !e.next_recommended_date && v.next_recommended_date && v.next_recommended_date < v.service_date) {
    e.next_recommended_date = 'Tidak boleh sebelum tanggal servis.';
  }
  if (!e.odometer && !blank(v.next_recommended_odometer) && Number(v.next_recommended_odometer) < Number(v.odometer)) {
    e.next_recommended_odometer = 'Tidak boleh lebih kecil dari kilometer servis.';
  }
  if (!blank(v.service_codes) && !/^[A-Za-z0-9_.-]{2,40}([,;\s]+[A-Za-z0-9_.-]{2,40})*$/.test(String(v.service_codes).trim())) {
    e.service_codes = 'Pisahkan kode dengan koma; gunakan huruf, angka, . _ -';
  }
  return e;
}

export function validateRule(v) {
  const e = {};
  req(e, v, 'service_code'); req(e, v, 'service_name'); req(e, v, 'category');
  if (!blank(v.service_code) && !/^[A-Z0-9_.-]{2,40}$/.test(v.service_code)) e.service_code = 'Huruf besar, angka, . _ - (2–40 karakter).';
  int(e, v, 'interval_months', 1, 240); int(e, v, 'interval_km', 1, 1000000);
  int(e, v, 'initial_service_months', 1, 240); int(e, v, 'initial_service_km', 1, 1000000);
  if (blank(v.interval_months) && blank(v.interval_km)) e.interval_months = 'Isi minimal salah satu: interval bulan atau kilometer.';
  if (v.due_logic === 'TIME_ONLY' && blank(v.interval_months)) e.interval_months = 'TIME_ONLY memerlukan interval bulan.';
  if (v.due_logic === 'KM_ONLY' && blank(v.interval_km)) e.interval_km = 'KM_ONLY memerlukan interval kilometer.';
  date(e, v, 'effective_from', false); date(e, v, 'effective_until', false);
  if (v.effective_from && v.effective_until && v.effective_until < v.effective_from) e.effective_until = 'Tidak boleh sebelum tanggal mulai.';
  return e;
}

export function validateUser(v, isCreate) {
  const e = {};
  if (isCreate) { req(e, v, 'username'); if (!blank(v.username) && !RE_USERNAME.test(v.username)) e.username = '3–32 karakter: huruf, angka, . _ -'; }
  req(e, v, 'email'); req(e, v, 'full_name');
  if (!blank(v.email) && !RE_EMAIL.test(v.email)) e.email = 'Format email tidak valid.';
  if (!blank(v.full_name) && String(v.full_name).trim().length < 2) e.full_name = 'Minimal 2 karakter.';
  return e;
}
