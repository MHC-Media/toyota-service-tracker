// Lingkungan tiruan Google Apps Script untuk pengujian di Node.
// Memuat SEMUA file gas/*.gs ke satu konteks (seperti proyek Apps Script) dengan
// SpreadsheetApp, LockService, CacheService, PropertiesService, dan waktu yang dapat dimajukan.
// Ini BUKAN pengganti uji di Apps Script sungguhan: perilaku Sheets disimulasikan secara sederhana
// (termasuk kesalahan umum: setValues di luar batas baris, lock bersarang).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const toBuf = (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map((b) => b & 0xff)));
const toSigned = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));

class MockSheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.maxCols = 26; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_pos, n) { this.maxRows += n; }
  insertColumnsAfter(_pos, n) { this.maxCols += n; }
  setFrozenRows() {}
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i] && this.rows[i].some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 0 || nc < 0) throw new Error('Range tidak valid');
    if (r + nr - 1 > this.maxRows) throw new Error('The coordinates or dimensions of the range are invalid (melebihi batas baris)');
    const self = this;
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) { const v = (self.rows[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); }
          out.push(row);
        }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some((x) => x.length !== nc)) throw new Error('Jumlah baris/kolom data tidak sama dengan range');
        vals.forEach((rowVals, i) => {
          const rr = r - 1 + i;
          self.rows[rr] = self.rows[rr] || [];
          rowVals.forEach((v, j) => { self.rows[rr][c - 1 + j] = v; });
        });
      },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { if (self.rows[r - 1 + i]) self.rows[r - 1 + i][c - 1 + j] = ''; } },
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
    };
  }
}

class MockSpreadsheet {
  constructor() { this.sheets = [new MockSheet('Sheet1')]; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function createBackend(opts = {}) {
  const store = Object.assign({ SPREADSHEET_ID: 'mock-sheet-id', TZ: 'Asia/Jakarta', PBKDF2_ITERATIONS: '1000' }, opts.props || {});
  const clock = { offset: 0 };
  class FDate extends Date {
    constructor(...a) { if (a.length === 0) super(Date.now() + clock.offset); else super(...a); }
    static now() { return Date.now() + clock.offset; }
  }
  const ss = new MockSpreadsheet();
  const cacheMap = new Map();
  let locked = false;
  const sandbox = {
    console: opts.quiet ? { log() {}, error() {}, warn() {} } : console,
    Date: FDate,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, text) => toSigned(crypto.createHash('sha256').update(toBuf(text)).digest()),
      computeHmacSha256Signature: (data, key) => toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(data)).digest()),
      newBlob: (s) => ({ getBytes: () => toSigned(Buffer.from(s, 'utf8')) }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        if (fmt !== 'yyyy-MM-dd') throw new Error('format tidak didukung pada mock: ' + fmt);
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d.getTime()));
      },
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: (k) => { delete store[k]; },
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = cacheMap.get(k); if (!e) return null; if (e.exp < FDate.now()) { cacheMap.delete(k); return null; } return e.v; },
      put: (k, v, ttl) => { cacheMap.set(k, { v: String(v), exp: FDate.now() + (ttl || 600) * 1000 }); },
      remove: (k) => { cacheMap.delete(k); },
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (locked) throw new Error('MOCK: lock bersarang/tidak dilepas (LockService tidak reentrant)'); locked = true; return true; },
      releaseLock: () => { locked = false; },
    }) },
    SpreadsheetApp: { openById: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; }, getContent() { return s; } }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
  };
  vm.createContext(sandbox);
  const files = fs.readdirSync(GAS_DIR).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'Config.gs' ? -1 : b === 'Config.gs' ? 1 : a.localeCompare(b)));
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), sandbox, { filename: f });

  sandbox.setupSecrets();
  sandbox.setupDatabase();

  function call(action, payload, token, extra) {
    const body = Object.assign({ action, payload: payload || {} }, token ? { token } : {}, extra || {});
    const resp = sandbox.handleRequest_({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(JSON.stringify(resp));
  }
  function callRaw(raw) { return JSON.parse(JSON.stringify(sandbox.handleRequest_({ postData: { contents: raw } }))); }

  /** Buat superadmin awal lewat prosedur bootstrap resmi. */
  function bootstrap(username = 'superadmin', email = 'admin@example.test', password = 'Bootstrap-Pass-123') {
    store.BOOTSTRAP_USERNAME = username; store.BOOTSTRAP_EMAIL = email; store.BOOTSTRAP_PASSWORD = password;
    sandbox.bootstrapSuperadmin();
    return { username, email, password };
  }
  return { sandbox, call, callRaw, bootstrap, store, ss, advance: (ms) => { clock.offset += ms; }, clock, cacheMap };
}

module.exports = { createBackend, MockSheet };
