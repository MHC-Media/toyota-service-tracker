// Harness: memuat file .gs ke konteks Node dengan shim minimal Utilities/PropertiesService.
// Hanya untuk menguji logika murni (kripto, validasi). BUKAN pengganti uji di Apps Script nyata.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function toBuf(x) {
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  return Buffer.from(x.map((b) => b & 0xff));
}
function toSigned(buf) { return Array.from(buf).map((b) => (b > 127 ? b - 256 : b)); }

function load(files, props = {}) {
  const store = Object.assign({ PEPPER: 'test-pepper-0123456789abcdef', TZ: 'Asia/Jakarta' }, props);
  const sandbox = {
    console,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_alg, text) => toSigned(crypto.createHash('sha256').update(toBuf(text)).digest()),
      computeHmacSha256Signature: (data, key) =>
        toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(data)).digest()),
      newBlob: (s) => ({ getBytes: () => toSigned(Buffer.from(s, 'utf8')) }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = v; },
        deleteProperty: (k) => { delete store[k]; },
      }),
    },
  };
  vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox;
}

module.exports = { load, toBuf };
