/**
 * config.js — konfigurasi frontend. TIDAK boleh berisi secret.
 * Isi API_URL dengan URL Web App Google Apps Script (berakhiran /exec) setelah deployment backend.
 * URL ini publik (terlihat oleh browser) dan BUKAN rahasia: keamanan bergantung pada autentikasi backend.
 */
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxaos3auUS9X_8K8dlVDxUVNOfQzBMf2_E3apKpLhVsuBWQsytX_bEb3lNliSpZRvj_/exec',                       // contoh: 'https://script.google.com/macros/s/AKfycb.../exec'
  TIMEZONE: 'Asia/Jakarta',          // hanya untuk tampilan waktu; tanggal murni tidak dikonversi
  REQUEST_TIMEOUT_MS: 30000
};
