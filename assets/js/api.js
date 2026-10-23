/**
 * api.js — klien API ke Google Apps Script Web App.
 *
 * Kontrak: POST dengan Content-Type text/plain (simple request, tanpa preflight CORS) dan body JSON
 * { action, token, payload, clientRequestId }. Respons selalu HTTP 200 dengan { success, data | error, meta }.
 * Token sesi disimpan di sessionStorage (hilang saat tab ditutup). Ini TIDAK kebal terhadap XSS;
 * lihat SECURITY.md. Token tidak pernah ditaruh di URL.
 */
import { CONFIG } from './config.js';

const TOKEN_KEY = 'tst.token';
const USER_KEY = 'tst.user';
let memToken = null;
let memUser = null;

function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* mode privat: pakai memori */ } }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* abaikan */ } }

export const session = {
  get token() { return memToken || ssGet(TOKEN_KEY); },
  set token(v) { memToken = v; if (v) ssSet(TOKEN_KEY, v); else ssDel(TOKEN_KEY); },
  get user() { if (memUser) return memUser; try { return JSON.parse(ssGet(USER_KEY) || 'null'); } catch (e) { return null; } },
  set user(u) { memUser = u; if (u) ssSet(USER_KEY, JSON.stringify(u)); else ssDel(USER_KEY); },
  clear() { memToken = null; memUser = null; ssDel(TOKEN_KEY); ssDel(USER_KEY); }
};

export class ApiError extends Error {
  constructor(code, message, details, requestId) {
    super(message || code);
    this.code = code; this.details = details || null; this.requestId = requestId || null;
  }
}

const WRITE_RE = /\.(create|update|archive|deactivate|resetPassword|grant|revoke|verify|sync)$|^auth\.changePassword$/;
const READ_RETRY_RE = /\.(list|get|getSummary|export)$|^auth\.me$|^health\.check$/;
const AUTH_LOST = new Set(['UNAUTHENTICATED']);

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function once(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body, redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl.signal
    });
    if (!res.ok) throw new ApiError('NETWORK_ERROR', 'Server tidak merespons dengan benar (HTTP ' + res.status + ').');
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new ApiError('BAD_RESPONSE', 'Respons server tidak valid. Periksa URL backend dan deployment Web App.'); }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'Server terlalu lama merespons. Coba lagi.');
    throw new ApiError('NETWORK_ERROR', 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
  } finally { clearTimeout(timer); }
}

/** Panggil action API. Melempar ApiError bila gagal. */
export async function call(action, payload = {}) {
  if (!CONFIG.API_URL) throw new ApiError('NOT_CONFIGURED', 'Backend belum dikonfigurasi. Isi API_URL pada assets/js/config.js.');
  const isWrite = WRITE_RE.test(action);
  const body = JSON.stringify({
    action, payload, token: session.token || undefined,
    clientRequestId: isWrite ? uuid() : undefined          // dipakai ulang saat retry -> tidak menggandakan data
  });
  const attempts = (isWrite || READ_RETRY_RE.test(action)) ? 3 : 1;
  let resp = null, lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try { resp = await once(body); lastErr = null; break; }
    catch (e) {
      lastErr = e;
      if (!['NETWORK_ERROR', 'TIMEOUT'].includes(e.code) || i === attempts - 1) break;
      await sleep(400 * (i + 1));
    }
  }
  if (lastErr) throw lastErr;
  if (!resp || typeof resp !== 'object' || typeof resp.success !== 'boolean') throw new ApiError('BAD_RESPONSE', 'Respons server tidak valid.');
  if (resp.meta && resp.meta.newToken) session.token = resp.meta.newToken;
  if (!resp.success) {
    const e = resp.error || {};
    const err = new ApiError(e.code || 'ERROR', e.message || 'Terjadi kesalahan.', e.details, resp.meta && resp.meta.requestId);
    if (AUTH_LOST.has(err.code) && action !== 'auth.login') {
      session.clear();
      window.dispatchEvent(new CustomEvent('tst:session-lost'));
    }
    throw err;
  }
  return resp.data;
}
