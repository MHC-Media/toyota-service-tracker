// Jalankan: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { load } = require('./gas-harness');

const g = load(['Config.gs', 'Security.gs', 'Validation.gs']);

test('PBKDF2 manual cocok dengan crypto.pbkdf2Sync', () => {
  const pw = Buffer.from('rahasia-uji');
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const expected = crypto.pbkdf2Sync(pw, salt, 500, 32, 'sha256').toString('hex');
  const bytes = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));
  const got = g.pbkdf2Hex_(bytes(pw), bytes(salt), 500);
  assert.strictEqual(got, expected);
});

test('hash/verify password: benar, salah, format rusak', () => {
  const rec = g.createPasswordRecord_('Passw0rdKuat123');
  assert.ok(rec.password_hash.startsWith('pbkdf2-sha256$'));
  assert.strictEqual(g.verifyPassword_('Passw0rdKuat123', rec.password_salt, rec.password_hash), true);
  assert.strictEqual(g.verifyPassword_('salah', rec.password_salt, rec.password_hash), false);
  assert.strictEqual(g.verifyPassword_('x', rec.password_salt, 'bukan-hash'), false);
});

test('salt unik per akun', () => {
  const a = g.createPasswordRecord_('Passw0rdKuat123');
  const b = g.createPasswordRecord_('Passw0rdKuat123');
  assert.notStrictEqual(a.password_salt, b.password_salt);
  assert.notStrictEqual(a.password_hash, b.password_hash);
});

test('token acak 64 hex dan hash berbeda dari token', () => {
  const t = g.generateSessionToken_();
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(g.hashToken_(t), t);
  assert.notStrictEqual(g.generateSessionToken_(), t);
});

test('validasi tanggal', () => {
  assert.strictEqual(g.isValidDateStr_('2026-02-28'), true);
  assert.strictEqual(g.isValidDateStr_('2026-02-30'), false);
  assert.strictEqual(g.isValidDateStr_('21-10-2026'), false);
});

test('password policy', () => {
  assert.throws(() => g.vPassword_('pendek1A'));
  assert.throws(() => g.vPassword_('semuahurufkecilpanjang1'));
  assert.doesNotThrow(() => g.vPassword_('KataSandiKuat123'));
});

test('kilometer negatif dan non-integer ditolak', () => {
  assert.throws(() => g.vInt_({ odometer: -1 }, 'odometer', { min: 0 }));
  assert.throws(() => g.vInt_({ odometer: 1.5 }, 'odometer', { min: 0 }));
  assert.strictEqual(g.vInt_({ odometer: '1200' }, 'odometer', { min: 0 }), 1200);
});

test('pickAllowed mencegah mass assignment', () => {
  const r = g.pickAllowed_({ model: 'Avanza', role: 'superadmin', owner_user_id: 'x' }, ['model']);
  assert.deepStrictEqual(Object.assign({}, r), { model: 'Avanza' });
});

test('CSV formula injection dinetralkan', () => {
  assert.strictEqual(g.csvSafe_('=1+1'), "'=1+1");
  assert.strictEqual(g.csvSafe_('@cmd'), "'@cmd");
  assert.strictEqual(g.csvSafe_('a,b'), '"a,b"');
});

test('paging: sortBy di luar allowlist ditolak', () => {
  assert.throws(() => g.parsePaging_({ sortBy: 'password_hash' }, ['plate_number']));
});
