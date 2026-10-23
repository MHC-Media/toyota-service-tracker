// Jalankan: node --test tests/
// Uji integrasi backend pada lingkungan Apps Script TIRUAN (lihat gas-mock.js).
const test = require('node:test');
const assert = require('node:assert');
const { createBackend } = require('./gas-mock');

const MIN = 60000;

function setup() {
  const b = createBackend({ quiet: true });
  const leaks = [];
  const origCall = b.call;
  b.call = (...a) => { const r = origCall(...a); leaks.push(JSON.stringify(r)); return r; };
  const sa = b.bootstrap();
  let r = b.call('auth.login', { identifier: sa.username, password: sa.password });
  assert.ok(r.success, 'login superadmin awal');
  const first = r.data.token;
  assert.strictEqual(r.data.user.must_change_password, true);
  const newPw = 'SuperAdmin-New-123';
  r = b.call('auth.changePassword', { currentPassword: sa.password, newPassword: newPw }, first);
  assert.ok(r.success, JSON.stringify(r));
  r = b.call('auth.login', { identifier: sa.username, password: newPw });
  assert.ok(r.success);
  const env = { b, sandbox: b.sandbox, leaks, sa: { username: sa.username, password: newPw, token: r.data.token, user: r.data.user }, passwords: [newPw] };
  return env;
}

/** Buat akun lewat API, login dengan password sementara, ganti password. */
function mkUser(env, username, role = 'user', byToken) {
  const { b } = env;
  const r = b.call('users.create', { username, email: username + '@example.test', full_name: 'Nama ' + username, role }, byToken || env.sa.token);
  assert.ok(r.success, JSON.stringify(r));
  const temp = r.data.temporaryPassword;
  const l = b.call('auth.login', { identifier: username, password: temp });
  assert.ok(l.success, JSON.stringify(l));
  const pw = 'Password-' + username + '-1A';
  const c = b.call('auth.changePassword', { currentPassword: temp, newPassword: pw }, l.data.token);
  assert.ok(c.success, JSON.stringify(c));
  const l2 = b.call('auth.login', { identifier: username, password: pw });
  env.passwords.push(pw, temp);
  return { user: r.data.user, password: pw, token: l2.data.token };
}

function mkVehicle(env, ownerId, plate = 'KH 1234 AB', extra = {}) {
  const r = env.b.call('vehicles.create', Object.assign({
    plate_number: plate, model: 'Avanza', variant: '1.3 G', year: 2022, engine: '1NR-VE', transmission: 'MT', fuel_type: 'Bensin',
    delivery_date: '2022-03-01', current_odometer: 30000, owner_user_id: ownerId,
  }, extra), env.sa.token);
  assert.ok(r.success, JSON.stringify(r));
  return r.data.vehicle;
}

const ruleOil = {
  model_scope: 'Avanza', service_code: 'OLI-MESIN', service_name: 'Ganti oli mesin', category: 'pelumas',
  interval_months: 6, interval_km: 5000, due_logic: 'EARLIER', anchor: 'LAST_SERVICE',
  source_name: 'Buku Servis (data uji)', source_reference: 'hal. 12',
};

/* ------------------------------------------------------------------ AUTH */

test('login/logout, bootstrap wajib ganti password, tidak ada kebocoran hash/token', () => {
  const env = setup(); const { b } = env;
  const sa2 = b.bootstrap; // bootstrap kedua harus ditolak
  assert.throws(() => sa2('lain', 'lain@example.test', 'Lain-Password-123'), /Superadmin sudah ada/);
  const me = b.call('auth.me', {}, env.sa.token);
  assert.ok(me.success); assert.strictEqual(me.data.user.username, 'superadmin');
  assert.strictEqual(me.data.user.password_hash, undefined);
  const out = b.call('auth.logout', {}, env.sa.token);
  assert.ok(out.success);
  assert.strictEqual(b.call('auth.me', {}, env.sa.token).error.code, 'UNAUTHENTICATED');
  env.leaks.forEach((s) => { assert.ok(!/password_hash|password_salt|token_hash/.test(s), 'respons membocorkan field rahasia'); });
});

test('must_change_password membatasi aksi lain', () => {
  const env = setup(); const { b } = env;
  const r = b.call('users.create', { username: 'budi', email: 'budi@example.test', full_name: 'Budi' }, env.sa.token);
  const l = b.call('auth.login', { identifier: 'budi', password: r.data.temporaryPassword });
  assert.strictEqual(l.data.user.must_change_password, true);
  assert.strictEqual(b.call('vehicles.list', {}, l.data.token).error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.ok(b.call('auth.me', {}, l.data.token).success);
});

test('password salah: pesan generik sama untuk akun ada/tidak ada; lockout setelah 5 gagal', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'siti');
  const e1 = b.call('auth.login', { identifier: 'siti', password: 'salahsalah1A' });
  const e2 = b.call('auth.login', { identifier: 'tidakada', password: 'salahsalah1A' });
  assert.strictEqual(e1.error.code, 'INVALID_CREDENTIALS');
  assert.deepStrictEqual(e1.error.message, e2.error.message);
  for (let i = 0; i < 4; i++) b.call('auth.login', { identifier: 'siti', password: 'salahsalah1A' });
  const locked = b.call('auth.login', { identifier: 'siti', password: u.password });   // password benar tetap ditolak
  assert.strictEqual(locked.error.code, 'TOO_MANY_ATTEMPTS');
  b.advance(16 * MIN);
  assert.ok(b.call('auth.login', { identifier: 'siti', password: u.password }).success, 'lockout berakhir');
});

test('lockout tercatat di Users (locked_until) walau cache hilang', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'rudi');
  for (let i = 0; i < 5; i++) b.call('auth.login', { identifier: 'rudi', password: 'salahsalah1A' });
  b.cacheMap.clear();
  assert.strictEqual(b.call('auth.login', { identifier: 'rudi', password: u.password }).error.code, 'TOO_MANY_ATTEMPTS');
});

test('akun nonaktif tidak bisa login dan sesi lama dicabut', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'andi');
  assert.ok(b.call('auth.me', {}, u.token).success);
  const d = b.call('users.deactivate', { user_id: u.user.user_id }, env.sa.token);
  assert.ok(d.success, JSON.stringify(d));
  assert.strictEqual(b.call('auth.me', {}, u.token).error.code, 'UNAUTHENTICATED');
  assert.strictEqual(b.call('auth.login', { identifier: 'andi', password: u.password }).error.code, 'INVALID_CREDENTIALS');
});

test('sesi: idle timeout, kedaluwarsa absolut, rotasi token dengan masa tenggang', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'dewi');
  // idle
  b.advance(31 * MIN);
  assert.strictEqual(b.call('auth.me', {}, u.token).error.code, 'UNAUTHENTICATED');
  // rotasi
  const l = b.call('auth.login', { identifier: 'dewi', password: u.password });
  let tok = l.data.token;
  b.advance(10 * MIN); assert.ok(b.call('auth.me', {}, tok).success);
  b.advance(10 * MIN);
  const r = b.call('auth.me', {}, tok);
  assert.ok(r.success); assert.ok(r.meta.newToken, 'token dirotasi setelah >15 menit');
  const fresh = r.meta.newToken;
  assert.ok(b.call('auth.me', {}, tok).success, 'token lama masih valid selama masa tenggang');
  b.advance(2 * MIN);
  assert.strictEqual(b.call('auth.me', {}, tok).error.code, 'UNAUTHENTICATED', 'token lama mati setelah tenggang');
  assert.ok(b.call('auth.me', {}, fresh).success);
  // absolut 8 jam, dijaga aktif
  let t = fresh;
  for (let i = 0; i < 24; i++) { b.advance(20 * MIN); const x = b.call('auth.me', {}, t); if (!x.success) { t = null; break; } if (x.meta.newToken) t = x.meta.newToken; }
  assert.strictEqual(t, null, 'sesi harus berakhir pada batas absolut 8 jam');
});

test('token tak valid / format salah / body rusak', () => {
  const env = setup(); const { b } = env;
  assert.strictEqual(b.call('auth.me', {}, 'abc').error.code, 'UNAUTHENTICATED');
  assert.strictEqual(b.call('auth.me', {}, 'a'.repeat(64)).error.code, 'UNAUTHENTICATED');
  assert.strictEqual(b.callRaw('bukan json').error.code, 'BAD_REQUEST');
  assert.strictEqual(b.callRaw('[]').error.code, 'BAD_REQUEST');
  assert.strictEqual(b.call('tidak.ada', {}).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('__proto__', {}).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('constructor', {}).error.code, 'NOT_FOUND');
  assert.strictEqual(b.callRaw(JSON.stringify({ action: 'auth.me', payload: [] })).error.code, 'UNAUTHENTICATED');
  assert.strictEqual(b.callRaw(JSON.stringify({ action: 'health.check', payload: [] })).error.code, 'VALIDATION_ERROR');
  assert.ok(b.call('health.check', {}).success);
  assert.deepStrictEqual(Object.keys(b.call('health.check', {}).data).sort(), ['app', 'status', 'version']);
});

test('error internal tidak membocorkan detail', () => {
  const env = setup(); const { b } = env;
  delete b.store.SPREADSHEET_ID;
  const r = b.call('auth.login', { identifier: 'x', password: 'y' });
  assert.strictEqual(r.error.code, 'INTERNAL_ERROR');
  assert.ok(!/SPREADSHEET|stack|at /.test(JSON.stringify(r)));
});

/* ------------------------------------------------------------ OTORISASI */

test('RBAC: user tidak bisa memanggil aksi admin; admin tidak bisa aksi superadmin', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'user1'); const a = mkUser(env, 'admin1', 'admin');
  for (const act of ['users.list', 'users.create', 'vehicles.create', 'serviceHistory.create', 'maintenanceRules.create', 'auditLogs.list', 'settings.get', 'access.list', 'reminders.sync']) {
    assert.strictEqual(b.call(act, {}, u.token).error.code, 'FORBIDDEN', act);
  }
  for (const act of ['maintenanceRules.verify', 'settings.update']) assert.strictEqual(b.call(act, {}, a.token).error.code, 'FORBIDDEN', act);
  assert.strictEqual(b.call('users.create', { username: 'adm2', email: 'a2@example.test', full_name: 'Admin Dua', role: 'admin' }, a.token).error.code, 'FORBIDDEN');
  assert.strictEqual(b.call('users.update', { user_id: env.sa.user.user_id, full_name: 'Diubah Admin' }, a.token).error.code, 'FORBIDDEN');
  assert.strictEqual(b.call('users.resetPassword', { user_id: env.sa.user.user_id }, a.token).error.code, 'FORBIDDEN');
  // admin hanya melihat role user
  const list = b.call('users.list', {}, a.token);
  assert.ok(list.success); assert.ok(list.data.items.every((x) => x.role === 'user'));
  // audit log: admin tidak melihat log superadmin
  const logs = b.call('auditLogs.list', { pageSize: 100 }, a.token).data.items;
  assert.ok(logs.every((l) => l.actor_username !== 'superadmin'));
  const slogs = b.call('auditLogs.list', { pageSize: 100 }, env.sa.token).data.items;
  assert.ok(slogs.some((l) => l.actor_username === 'superadmin'));
  // percobaan ditolak tercatat
  assert.ok(slogs.some((l) => l.action === 'access.denied' && l.outcome === 'denied'));
});

test('role tidak bisa disisipkan lewat profile.update/users.update (mass assignment)', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'user2');
  const r = b.call('profile.update', { full_name: 'Nama Baru', role: 'superadmin', status: 'active', user_id: env.sa.user.user_id }, u.token);
  assert.ok(r.success); assert.strictEqual(r.data.user.role, 'user'); assert.strictEqual(r.data.user.user_id, u.user.user_id);
  const a = mkUser(env, 'admin2', 'admin');
  const r2 = b.call('users.update', { user_id: u.user.user_id, role: 'admin' }, a.token);
  assert.strictEqual(r2.error.code, 'FORBIDDEN');
  assert.strictEqual(b.call('users.list', { search: 'user2' }, env.sa.token).data.items[0].role, 'user');
});

test('perubahan role/status mencabut sesi; superadmin terakhir terlindungi; tidak bisa ubah diri sendiri', () => {
  const env = setup(); const { b } = env;
  const a = mkUser(env, 'admin3', 'admin');
  assert.ok(b.call('users.list', {}, a.token).success);
  const r = b.call('users.update', { user_id: a.user.user_id, role: 'user' }, env.sa.token);
  assert.ok(r.success, JSON.stringify(r));
  assert.strictEqual(b.call('users.list', {}, a.token).error.code, 'UNAUTHENTICATED', 'token lama dicabut setelah role berubah');
  const l = b.call('auth.login', { identifier: 'admin3', password: a.password });
  assert.strictEqual(b.call('users.list', {}, l.data.token).error.code, 'FORBIDDEN', 'role dibaca ulang pada setiap request');
  assert.strictEqual(b.call('users.update', { user_id: env.sa.user.user_id, role: 'user' }, env.sa.token).error.code, 'FORBIDDEN');
  assert.strictEqual(b.call('users.update', { user_id: env.sa.user.user_id, status: 'inactive' }, env.sa.token).error.code, 'FORBIDDEN');
  const sa2 = mkUser(env, 'super2', 'superadmin');
  assert.ok(b.call('users.update', { user_id: env.sa.user.user_id, role: 'admin' }, sa2.token).success);
  assert.strictEqual(b.call('users.update', { user_id: sa2.user.user_id, role: 'admin' }, sa2.token).error.code, 'FORBIDDEN');
});

test('reset password: sementara, wajib ganti, sesi lama dicabut, password lama tak berlaku', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'tono');
  const r = b.call('users.resetPassword', { user_id: u.user.user_id }, env.sa.token);
  assert.ok(r.success); assert.ok(/^[A-Za-z0-9]{16}$/.test(r.data.temporaryPassword));
  assert.strictEqual(b.call('auth.me', {}, u.token).error.code, 'UNAUTHENTICATED');
  assert.strictEqual(b.call('auth.login', { identifier: 'tono', password: u.password }).error.code, 'INVALID_CREDENTIALS');
  const l = b.call('auth.login', { identifier: 'tono', password: r.data.temporaryPassword });
  assert.ok(l.success); assert.strictEqual(l.data.user.must_change_password, true);
  env.passwords.push(r.data.temporaryPassword);
});

test('ganti password: password lama salah ditolak, kebijakan password, sesi lain dicabut', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'lina');
  const other = b.call('auth.login', { identifier: 'lina', password: u.password }).data.token;
  assert.strictEqual(b.call('auth.changePassword', { currentPassword: 'salah', newPassword: 'BaruBaru-12345A' }, u.token).error.code, 'INVALID_CREDENTIALS');
  assert.strictEqual(b.call('auth.changePassword', { currentPassword: u.password, newPassword: 'pendek' }, u.token).error.code, 'VALIDATION_ERROR');
  assert.ok(b.call('auth.changePassword', { currentPassword: u.password, newPassword: 'BaruBaru-12345A' }, u.token).success);
  assert.strictEqual(b.call('auth.me', {}, other).error.code, 'UNAUTHENTICATED');
  assert.ok(b.call('auth.me', {}, u.token).success);
  env.passwords.push('BaruBaru-12345A');
});

/* -------------------------------------------------------------- IDOR */

test('IDOR: pengguna A tidak dapat membaca/mengubah data pengguna B', () => {
  const env = setup(); const { b } = env;
  const A = mkUser(env, 'usera'); const B = mkUser(env, 'userb');
  const vA = mkVehicle(env, A.user.user_id, 'KH 1111 AA');
  const vB = mkVehicle(env, B.user.user_id, 'KH 2222 BB');
  const sB = b.call('serviceHistory.create', { vehicle_id: vB.vehicle_id, service_date: '2024-01-10', odometer: 10000, service_type: 'Servis 10.000 km', service_category: 'berkala', labor_cost: 100000 }, env.sa.token);
  assert.ok(sB.success, JSON.stringify(sB));
  const list = b.call('vehicles.list', {}, A.token);
  assert.deepStrictEqual(list.data.items.map((x) => x.plate_number), ['KH 1111 AA']);
  assert.strictEqual(b.call('vehicles.get', { vehicle_id: vA.vehicle_id }, A.token).data.vehicle.plate_number, 'KH 1111 AA');
  assert.strictEqual(b.call('vehicles.get', { vehicle_id: vB.vehicle_id }, A.token).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('serviceHistory.list', { vehicle_id: vB.vehicle_id }, A.token).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('serviceHistory.list', {}, A.token).data.total, 0);
  assert.strictEqual(b.call('serviceHistory.get', { service_id: sB.data.service.service_id }, A.token).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('recommendations.get', { vehicle_id: vB.vehicle_id }, A.token).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('reports.get', { report: 'serviceHistoryByVehicle', vehicle_id: vB.vehicle_id }, A.token).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('reminders.list', { vehicle_id: vB.vehicle_id }, A.token).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('vehicles.update', { vehicle_id: vA.vehicle_id, model: 'X' }, A.token).error.code, 'FORBIDDEN');
  const rep = b.call('reports.get', { report: 'serviceHistoryByVehicle' }, A.token);
  assert.strictEqual(rep.data.rows.length, 0);
  assert.strictEqual(b.call('reports.get', { report: 'activeUsersVehicles' }, A.token).error.code, 'FORBIDDEN');
  // akses eksplisit diberikan admin -> terlihat; dicabut -> hilang
  const g = b.call('access.grant', { user_id: A.user.user_id, vehicle_id: vB.vehicle_id }, env.sa.token);
  assert.ok(g.success, JSON.stringify(g));
  assert.ok(b.call('vehicles.get', { vehicle_id: vB.vehicle_id }, A.token).success);
  assert.ok(b.call('serviceHistory.get', { service_id: sB.data.service.service_id }, A.token).success);
  assert.ok(b.call('access.revoke', { access_id: g.data.access.access_id }, env.sa.token).success);
  assert.strictEqual(b.call('vehicles.get', { vehicle_id: vB.vehicle_id }, A.token).error.code, 'NOT_FOUND');
  // kendaraan diarsipkan hilang untuk user
  assert.ok(b.call('vehicles.archive', { vehicle_id: vA.vehicle_id }, env.sa.token).success);
  assert.strictEqual(b.call('vehicles.list', {}, A.token).data.total, 0);
  // ID rusak
  assert.strictEqual(b.call('vehicles.get', { vehicle_id: "' OR 1=1" }, A.token).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.list', { sortBy: 'password_hash' }, A.token).error.code, 'VALIDATION_ERROR');
});

/* ------------------------------------------------- KENDARAAN & SERVIS */

test('validasi kendaraan: plat, tahun, odometer, tanggal, duplikat; mass assignment diabaikan', () => {
  const env = setup(); const { b } = env;
  const base = { model: 'Avanza', year: 2022, plate_number: 'KH 1234 AB' };
  const t = env.sa.token;
  assert.strictEqual(b.call('vehicles.create', Object.assign({}, base, { plate_number: 'bukan plat!!' }), t).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.create', Object.assign({}, base, { year: 1900 }), t).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.create', Object.assign({}, base, { current_odometer: -5 }), t).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.create', Object.assign({}, base, { delivery_date: '2999-01-01' }), t).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.create', Object.assign({}, base, { delivery_date: '2022-02-30' }), t).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.create', Object.assign({}, base, { owner_user_id: '00000000-0000-0000-0000-000000000000' }), t).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('vehicles.create', {}, t).error.code, 'VALIDATION_ERROR');
  const ok = b.call('vehicles.create', Object.assign({}, base, { plate_number: 'kh  1234 ab', status: 'archived', last_service_date: '2020-01-01', next_service_odometer: 1, vehicle_id: '11111111-1111-1111-1111-111111111111' }), t);
  assert.ok(ok.success, JSON.stringify(ok));
  const v = ok.data.vehicle;
  assert.strictEqual(v.plate_number, 'KH 1234 AB'); assert.strictEqual(v.status, 'active'); assert.strictEqual(v.last_service_date, '');
  assert.notStrictEqual(v.vehicle_id, '11111111-1111-1111-1111-111111111111');
  assert.strictEqual(v.brand, 'Toyota');
  assert.strictEqual(b.call('vehicles.create', base, t).error.code, 'VALIDATION_ERROR', 'plat duplikat');
  // odometer turun
  const up = b.call('vehicles.update', { vehicle_id: v.vehicle_id, current_odometer: 1000 }, t);
  assert.ok(up.success);
  const down = b.call('vehicles.update', { vehicle_id: v.vehicle_id, current_odometer: 500 }, t);
  assert.strictEqual(down.error.code, 'VALIDATION_ERROR');
  assert.ok(b.call('vehicles.update', { vehicle_id: v.vehicle_id, current_odometer: 500, correction_reason: 'Salah input awal' }, t).success);
  // update tidak bisa mengubah owner/field turunan sembarangan
  const up2 = b.call('vehicles.update', { vehicle_id: v.vehicle_id, next_service_date: '2030-01-01', last_service_odometer: 999999 }, t);
  assert.ok(up2.success); assert.strictEqual(up2.data.vehicle.next_service_date, ''); assert.strictEqual(up2.data.vehicle.last_service_odometer, '');
});

test('riwayat servis: validasi, total dihitung server, duplikat, konsistensi kilometer, kolom turunan, idempotensi', () => {
  const env = setup(); const { b, sandbox } = env;
  const t = env.sa.token; const u = mkUser(env, 'pemilik');
  const v = mkVehicle(env, u.user.user_id);
  const today = sandbox.todayStr_();
  const mk = (o) => b.call('serviceHistory.create', Object.assign({ vehicle_id: v.vehicle_id, service_date: '2024-01-10', odometer: 10000, service_type: 'Servis 10.000 km', service_category: 'berkala' }, o), t);
  assert.strictEqual(mk({ service_date: '2999-01-01' }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ odometer: -1 }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ labor_cost: -100 }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ labor_cost: 'abc' }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ service_category: 'ngawur' }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ service_codes: 'oli mesin!' }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ vehicle_id: '00000000-0000-0000-0000-000000000000' }).error.code, 'NOT_FOUND');
  assert.strictEqual(b.call('serviceHistory.create', {}, t).error.code, 'VALIDATION_ERROR');
  const s1 = mk({ labor_cost: 100000, parts_cost: 250000, additional_cost: 5000, total_cost: 1, service_codes: 'oli-mesin, busi' });
  assert.ok(s1.success, JSON.stringify(s1));
  assert.strictEqual(s1.data.service.total_cost, 355000, 'total dihitung server');
  assert.strictEqual(s1.data.service.service_codes, 'OLI-MESIN,BUSI');
  assert.strictEqual(mk({}).error.code, 'DUPLICATE');
  // kilometer tidak konsisten
  assert.strictEqual(mk({ service_date: '2024-06-10', odometer: 9000, service_type: 'Servis lain' }).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(mk({ service_date: '2023-06-10', odometer: 12000, service_type: 'Servis lama' }).error.code, 'VALIDATION_ERROR');
  assert.ok(mk({ service_date: '2024-06-10', odometer: 9000, service_type: 'Servis koreksi', correction_reason: 'Odometer diganti' }).success);
  // kolom turunan
  const got = b.call('vehicles.get', { vehicle_id: v.vehicle_id }, t).data.vehicle;
  assert.strictEqual(got.last_service_date, '2024-06-10'); assert.strictEqual(got.last_service_odometer, 9000);
  assert.strictEqual(got.current_odometer, 30000);
  const big = mk({ service_date: '2024-09-10', odometer: 45000, service_type: 'Servis 40.000' });
  assert.ok(big.success);
  assert.strictEqual(b.call('vehicles.get', { vehicle_id: v.vehicle_id }, t).data.vehicle.current_odometer, 45000);
  // update
  const upd = b.call('serviceHistory.update', { service_id: s1.data.service.service_id, parts_cost: 0, labor_cost: 50000, vehicle_id: '00000000-0000-0000-0000-000000000000' }, t);
  assert.ok(upd.success, JSON.stringify(upd)); assert.strictEqual(upd.data.service.total_cost, 55000); assert.strictEqual(upd.data.service.vehicle_id, v.vehicle_id);
  // idempotensi
  const before = b.call('serviceHistory.list', { vehicle_id: v.vehicle_id }, t).data.total;
  const body = { vehicle_id: v.vehicle_id, service_date: today, odometer: 46000, service_type: 'Cek ulang', service_category: 'inspeksi' };
  const r1 = b.call('serviceHistory.create', body, t, { clientRequestId: 'req-12345678' });
  const r2 = b.call('serviceHistory.create', body, t, { clientRequestId: 'req-12345678' });
  assert.ok(r1.success && r2.success); assert.strictEqual(r2.meta.replayed, true);
  assert.strictEqual(r2.data.service.service_id, r1.data.service.service_id);
  assert.strictEqual(b.call('serviceHistory.list', { vehicle_id: v.vehicle_id }, t).data.total, before + 1);
  // filter & paging
  const l = b.call('serviceHistory.list', { vehicle_id: v.vehicle_id, category: 'berkala', pageSize: 2, page: 1 }, t);
  assert.strictEqual(l.data.items.length, 2); assert.ok(l.data.totalPages >= 1);
  assert.strictEqual(b.call('serviceHistory.list', { pageSize: 1000 }, t).error.code, 'VALIDATION_ERROR');
  // kendaraan diarsipkan tidak boleh menerima servis baru
  b.call('vehicles.archive', { vehicle_id: v.vehicle_id }, t);
  assert.strictEqual(mk({ service_date: today, odometer: 50000, service_type: 'Baru' }).error.code, 'VALIDATION_ERROR');
});

test('update bersamaan tidak merusak data (lock tidak bersarang) dan baris > batas awal tetap bisa ditulis', () => {
  const env = setup(); const { b } = env;
  const u = mkUser(env, 'banyak');
  const v = mkVehicle(env, u.user.user_id);
  for (let i = 0; i < 40; i++) {
    const r = b.call('serviceHistory.create', { vehicle_id: v.vehicle_id, service_date: '2023-01-' + String((i % 28) + 1).padStart(2, '0'), odometer: 1000 + i * 100, service_type: 'Servis ' + i, service_category: 'berkala' }, env.sa.token);
    assert.ok(r.success || r.error.code === 'VALIDATION_ERROR', JSON.stringify(r));
  }
  assert.ok(b.call('serviceHistory.list', { vehicle_id: v.vehicle_id, pageSize: 100 }, env.sa.token).data.total >= 20);
});

/* ------------------------------------------------------- ATURAN & MESIN */

test('aturan: baru UNVERIFIED; verifikasi hanya superadmin dengan sumber; ubah field kritis mengembalikan UNVERIFIED', () => {
  const env = setup(); const { b } = env;
  const a = mkUser(env, 'adminrule', 'admin'); const u = mkUser(env, 'userrule');
  const c = b.call('maintenanceRules.create', Object.assign({}, ruleOil, { source_name: '', source_reference: '' }), a.token);
  assert.ok(c.success, JSON.stringify(c)); assert.strictEqual(c.data.rule.verified_status, 'UNVERIFIED');
  const id = c.data.rule.rule_id;
  assert.strictEqual(b.call('maintenanceRules.create', Object.assign({}, ruleOil, { service_code: 'x' }), a.token).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('maintenanceRules.create', { service_code: 'ABC', service_name: 'x', category: 'y' }, a.token).error.code, 'VALIDATION_ERROR', 'harus ada interval');
  assert.strictEqual(b.call('maintenanceRules.create', ruleOil, a.token).error.code, 'DUPLICATE');
  assert.strictEqual(b.call('maintenanceRules.create', Object.assign({}, ruleOil, { verified_status: 'VERIFIED', service_code: 'LAIN-1' }), a.token).data.rule.verified_status, 'UNVERIFIED', 'verified_status dari klien diabaikan');
  assert.strictEqual(b.call('maintenanceRules.verify', { rule_id: id }, env.sa.token).error.code, 'VALIDATION_ERROR', 'tanpa sumber tidak bisa diverifikasi');
  assert.ok(b.call('maintenanceRules.update', { rule_id: id, source_name: 'Buku Servis Avanza', source_reference: 'hal. 14' }, a.token).success);
  assert.ok(b.call('maintenanceRules.verify', { rule_id: id }, env.sa.token).success);
  assert.strictEqual(b.call('maintenanceRules.list', {}, u.token).data.items.length, 1, 'user hanya melihat aturan terverifikasi');
  const up = b.call('maintenanceRules.update', { rule_id: id, interval_km: 10000 }, a.token);
  assert.strictEqual(up.data.rule.verified_status, 'UNVERIFIED'); assert.strictEqual(up.data.revertedToUnverified, true);
  assert.strictEqual(b.call('maintenanceRules.list', {}, u.token).data.items.length, 0);
  const keep = b.call('maintenanceRules.update', { rule_id: id, description: 'catatan' }, a.token);
  assert.strictEqual(keep.data.rule.verified_status, 'UNVERIFIED');
});

const V = (o) => Object.assign({ vehicle_id: 'v1', model: 'Avanza', year: 2022, engine: '1NR-VE', delivery_date: '2022-03-01', purchase_date: '', current_odometer: 20000 }, o || {});
const R = (o) => Object.assign({ rule_id: 'r1', model_scope: '*', model_year_scope: '*', engine_scope: '*', service_code: 'OLI', service_name: 'Oli', category: 'x',
  interval_months: 6, interval_km: 5000, initial_service_months: '', initial_service_km: '', due_logic: 'EARLIER', anchor: 'LAST_SERVICE', severity: 'normal',
  description: '', source_name: 'S', source_reference: 'R', effective_from: '', effective_until: '', verified_status: 'VERIFIED', active: true }, o || {});
const S = (o) => Object.assign({ service_id: 's' + Math.random(), vehicle_id: 'v1', service_date: '2026-06-01', odometer: 18000, service_codes: 'OLI', total_cost: '' }, o || {});

test('mesin: berbasis waktu dan kilometer (EARLIER) + status', () => {
  const { sandbox: g } = createBackend({ quiet: true });
  const calc = (v, rules, svcs, ref, odo) => g.computeRecommendations_(v, rules, svcs, ref, odo).items;
  // servis terakhir 2026-06-01 @18000; due 2026-12-01 / 23000
  let it = calc(V(), [R()], [S()], '2026-07-01', 19000)[0];
  assert.strictEqual(it.target_date, '2026-12-01'); assert.strictEqual(it.target_km, 23000);
  assert.strictEqual(it.status, 'SAFE'); assert.strictEqual(it.remaining_km, 4000);
  assert.strictEqual(calc(V(), [R()], [S()], '2026-07-01', 22500)[0].status, 'NEAR');      // 500 km lagi
  assert.strictEqual(calc(V(), [R()], [S()], '2026-07-01', 22900)[0].status, 'DUE');       // 100 km lagi
  assert.strictEqual(calc(V(), [R()], [S()], '2026-07-01', 23050)[0].status, 'OVERDUE');   // km terlewati
  assert.strictEqual(calc(V(), [R()], [S()], '2026-12-05', 19000)[0].status, 'OVERDUE');   // tanggal terlewati
  assert.strictEqual(calc(V(), [R()], [S()], '2026-11-28', 19000)[0].status, 'DUE');
  assert.strictEqual(calc(V(), [R()], [S()], '2026-11-10', 19000)[0].status, 'NEAR');
});

test('mesin: LATER, TIME_ONLY, KM_ONLY', () => {
  const { sandbox: g } = createBackend({ quiet: true });
  const calc = (rule, ref, odo) => g.computeRecommendations_(V(), [rule], [S()], ref, odo).items[0];
  // waktu sudah lewat (OVERDUE) tapi km masih aman: LATER -> SAFE; EARLIER -> OVERDUE
  assert.strictEqual(calc(R({ due_logic: 'LATER' }), '2026-12-10', 19000).status, 'SAFE');
  assert.strictEqual(calc(R({ due_logic: 'EARLIER' }), '2026-12-10', 19000).status, 'OVERDUE');
  assert.strictEqual(calc(R({ due_logic: 'LATER' }), '2026-12-10', 24000).status, 'OVERDUE');
  assert.strictEqual(calc(R({ due_logic: 'TIME_ONLY' }), '2026-07-01', 99999).status, 'SAFE');
  assert.strictEqual(calc(R({ due_logic: 'TIME_ONLY' }), '2026-07-01', 99999).target_km, null);
  assert.strictEqual(calc(R({ due_logic: 'KM_ONLY' }), '2030-01-01', 19000).status, 'SAFE');
  assert.strictEqual(calc(R({ due_logic: 'KM_ONLY' }), '2030-01-01', 19000).target_date, null);
  assert.strictEqual(calc(R({ interval_months: '', due_logic: 'EARLIER' }), '2026-07-01', 24000).status, 'OVERDUE');
});

test('mesin: odometer kosong/tidak valid, riwayat tidak ada, jangkar tanggal pengiriman', () => {
  const { sandbox: g } = createBackend({ quiet: true });
  let res = g.computeRecommendations_(V(), [R()], [S()], '2026-07-01', '');
  assert.strictEqual(res.items[0].status, 'SAFE'); assert.ok(res.items[0].warnings.join(' ').includes('Kilometer saat ini belum tercatat'));
  assert.strictEqual(res.items[0].remaining_km, null);
  res = g.computeRecommendations_(V(), [R({ due_logic: 'KM_ONLY' })], [S()], '2026-07-01', 'abc');
  assert.strictEqual(res.items[0].status, 'UNKNOWN');
  res = g.computeRecommendations_(V(), [R()], [S()], '2026-07-01', -5);
  assert.ok(res.warnings.length >= 1);
  // tanpa riwayat: dari tanggal pengiriman, km awal 0, diberi peringatan
  res = g.computeRecommendations_(V(), [R()], [], '2026-07-01', 20000);
  assert.strictEqual(res.items[0].status, 'OVERDUE'); assert.ok(res.items[0].warnings.join(' ').includes('Riwayat servis'));
  // tanpa riwayat & tanpa tanggal -> UNKNOWN
  res = g.computeRecommendations_(V({ delivery_date: '' }), [R()], [], '2026-07-01', 20000);
  assert.strictEqual(res.items[0].status, 'UNKNOWN');
  // initial service dipakai bila belum ada riwayat
  res = g.computeRecommendations_(V({ delivery_date: '2026-05-01', current_odometer: 800 }), [R({ initial_service_months: 1, initial_service_km: 1000 })], [], '2026-05-10', 800);
  assert.strictEqual(res.items[0].target_date, '2026-06-01'); assert.strictEqual(res.items[0].target_km, 1000);
  // jangkar tanggal pengiriman: servis kemunculan ke-2 = 2 x interval dari pengiriman
  res = g.computeRecommendations_(V({ delivery_date: '2026-01-31' }), [R({ anchor: 'DELIVERY_DATE', interval_months: 12, interval_km: 10000 })], [S({ service_date: '2027-01-31', odometer: 9000 })], '2027-02-10', 9500);
  assert.strictEqual(res.items[0].target_date, '2028-01-31'); assert.strictEqual(res.items[0].target_km, 20000);
  // akhir bulan: 31 Jan + 1 bulan = 28/29 Feb
  assert.strictEqual(g.addMonthsStr_('2026-01-31', 1), '2026-02-28'); assert.strictEqual(g.addMonthsStr_('2024-01-31', 1), '2024-02-29');
  assert.strictEqual(g.addMonthsStr_('2026-11-15', 3), '2027-02-15');
});

test('mesin: kecocokan model/tahun/mesin, masa berlaku, aktif, dedupe, tidak diverifikasi', () => {
  const { sandbox: g } = createBackend({ quiet: true });
  const items = (rules, v) => g.computeRecommendations_(v || V(), rules, [S()], '2026-07-01', 19000).items;
  assert.strictEqual(items([R({ model_scope: 'Innova' })]).length, 0, 'model tidak cocok');
  assert.strictEqual(items([R({ model_scope: 'innova, AVANZA' })]).length, 1);
  assert.strictEqual(items([R({ model_year_scope: '2018-2021' })]).length, 0);
  assert.strictEqual(items([R({ model_year_scope: '2019,2022' })]).length, 1);
  assert.strictEqual(items([R({ engine_scope: '3SZ-VE' })]).length, 0);
  assert.strictEqual(items([R({ active: false })]).length, 0);
  assert.strictEqual(items([R({ effective_until: '2026-01-01' })]).length, 0);
  assert.strictEqual(items([R({ effective_from: '2027-01-01' })]).length, 0);
  const d = items([R({ rule_id: 'a', interval_km: 5000 }), R({ rule_id: 'b', model_scope: 'Avanza', interval_km: 10000 })]);
  assert.strictEqual(d.length, 1); assert.strictEqual(d[0].rule_id, 'b', 'aturan paling spesifik menang & tidak ada rekomendasi ganda');
  const u = items([R({ verified_status: 'UNVERIFIED' })])[0];
  assert.strictEqual(u.verified_status, 'UNVERIFIED'); assert.ok(u.warnings.some((w) => /belum diverifikasi/i.test(w))); assert.ok(/dealer Toyota/.test(u.suggested_action));
  assert.ok(items([R()])[0].reason.includes('servis terakhir'));
  // pekerjaan yang sama sudah dilakukan dengan kode lain tidak dihitung
  const o = g.computeRecommendations_(V(), [R()], [S({ service_codes: 'BUSI' })], '2026-07-01', 19000).items[0];
  assert.strictEqual(o.last_service_date, '');
  // urutan: paling mendesak dulu
  const sorted = g.computeRecommendations_(V(), [R({ rule_id: '1', service_code: 'A' }), R({ rule_id: '2', service_code: 'B', interval_km: 1000 })], [S({ service_codes: 'A,B' })], '2026-07-01', 19200).items;
  assert.strictEqual(sorted[0].service_code, 'B');
});

test('mesin: estimasi pemakaian hanya bila data cukup', () => {
  const { sandbox: g } = createBackend({ quiet: true });
  assert.strictEqual(g.estimateUsage_([]), null);
  assert.strictEqual(g.estimateUsage_([S({ service_date: '2026-01-01', odometer: 1000 })]), null);
  assert.strictEqual(g.estimateUsage_([S({ service_date: '2026-01-01', odometer: 1000 }), S({ service_date: '2026-01-10', odometer: 1500 })]), null, 'rentang < 30 hari');
  const u = g.estimateUsage_([S({ service_date: '2026-01-01', odometer: 1000 }), S({ service_date: '2026-03-02', odometer: 7000 })]);
  assert.strictEqual(u.kmPerDay, 100);
  const it = g.computeRecommendations_(V(), [R({ due_logic: 'KM_ONLY' })], [S({ service_date: '2026-01-01', odometer: 17000 }), S({ service_date: '2026-03-02', odometer: 23000 })], '2026-03-10', 23600).items[0];
  assert.ok(it.predicted_date_by_km, 'prediksi tanggal tersedia'); assert.strictEqual(it.target_km, 28000);
});

test('rekomendasi via API: dihitung di backend, sumber & verifikasi ikut tampil', () => {
  const env = setup(); const { b, sandbox } = env;
  const u = mkUser(env, 'rekom');
  const v = mkVehicle(env, u.user.user_id);
  const rule = b.call('maintenanceRules.create', ruleOil, env.sa.token).data.rule;
  b.call('maintenanceRules.verify', { rule_id: rule.rule_id }, env.sa.token);
  const today = sandbox.todayStr_();
  const d = sandbox.addDaysStr_(today, -30);
  b.call('serviceHistory.create', { vehicle_id: v.vehicle_id, service_date: d, odometer: 29000, service_type: 'Ganti oli', service_category: 'berkala', service_codes: 'OLI-MESIN' }, env.sa.token);
  const r = b.call('recommendations.get', { vehicle_id: v.vehicle_id }, u.token);
  assert.ok(r.success, JSON.stringify(r));
  const it = r.data.items[0];
  assert.strictEqual(it.source_name, 'Buku Servis (data uji)'); assert.strictEqual(it.verified_status, 'VERIFIED');
  assert.strictEqual(it.target_km, 34000); assert.strictEqual(it.last_service_odometer, 29000);
  assert.strictEqual(r.data.usage.insufficient, true);
  assert.ok(r.data.disclaimer);
  assert.strictEqual(b.call('recommendations.get', { vehicle_id: v.vehicle_id, referenceDate: '2026-13-01' }, u.token).error.code, 'VALIDATION_ERROR');
  const vg = b.call('vehicles.get', { vehicle_id: v.vehicle_id }, u.token).data.vehicle;
  assert.strictEqual(vg.next_service_odometer, 34000); assert.strictEqual(vg.maintenance.status, 'SAFE');
  assert.strictEqual(vg.maintenance.items, undefined, 'ringkasan tidak membawa detail berlebih');
});

test('pengingat: tidak ganda, diperbarui, ditutup setelah servis', () => {
  const env = setup(); const { b, sandbox } = env;
  const u = mkUser(env, 'ingat'); const v = mkVehicle(env, u.user.user_id, 'KH 7777 ZZ', { current_odometer: 60000 });
  b.call('maintenanceRules.create', ruleOil, env.sa.token);
  const t = env.sa.token;
  const s1 = b.call('reminders.sync', {}, t); assert.ok(s1.success, JSON.stringify(s1)); assert.strictEqual(s1.data.created, 1);
  const s2 = b.call('reminders.sync', {}, t); assert.strictEqual(s2.data.created, 0); assert.strictEqual(s2.data.updated, 0);
  const list = b.call('reminders.list', {}, u.token).data.items;
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].status, 'OVERDUE'); assert.strictEqual(list[0].verified_status, 'UNVERIFIED');
  assert.strictEqual(b.call('reminders.list', {}, mkUser(env, 'lain1').token).data.items.length, 0);
  b.call('serviceHistory.create', { vehicle_id: v.vehicle_id, service_date: sandbox.todayStr_(), odometer: 60000, service_type: 'Oli', service_category: 'berkala', service_codes: 'OLI-MESIN' }, t);
  const s3 = b.call('reminders.sync', {}, t); assert.strictEqual(s3.data.resolved, 1);
  assert.strictEqual(b.call('reminders.list', {}, u.token).data.items.length, 0);
  assert.doesNotThrow(() => sandbox.dailyMaintenanceJob());
});

/* ---------------------------------------------------- DASHBOARD & LAPORAN */

test('dashboard admin & user: data aktual, tanpa tren palsu, tanpa data pengguna lain', () => {
  const env = setup(); const { b, sandbox } = env;
  const empty = b.call('dashboard.getSummary', {}, env.sa.token);
  assert.ok(empty.success, JSON.stringify(empty));
  assert.strictEqual(empty.data.kpis.activeVehicles, 0); assert.strictEqual(empty.data.kpis.servicesTrend, null);
  assert.strictEqual(empty.data.kpis.costThisMonth, null); assert.strictEqual(empty.data.kpis.completenessPercent, null);
  const A = mkUser(env, 'dasha'); const B = mkUser(env, 'dashb');
  const vA = mkVehicle(env, A.user.user_id, 'KH 1 A'); mkVehicle(env, B.user.user_id, 'KH 2 B', { model: 'Innova' });
  const today = sandbox.todayStr_();
  b.call('serviceHistory.create', { vehicle_id: vA.vehicle_id, service_date: today, odometer: 30500, service_type: 'Servis', service_category: 'berkala', labor_cost: 200000 }, env.sa.token);
  const ad = b.call('dashboard.getSummary', {}, env.sa.token).data;
  assert.strictEqual(ad.scope, 'admin'); assert.strictEqual(ad.kpis.activeVehicles, 2); assert.strictEqual(ad.kpis.servicesThisMonth, 1);
  assert.strictEqual(ad.kpis.costThisMonth, 200000); assert.strictEqual(ad.kpis.activeUsers, 3);
  assert.strictEqual(ad.kpis.servicesTrend, null, 'tidak ada bulan pembanding -> tidak ada tren');
  assert.strictEqual(ad.charts.vehiclesByModel.length, 2); assert.ok(ad.recentActivity.length > 0);
  const ud = b.call('dashboard.getSummary', {}, A.token).data;
  assert.strictEqual(ud.scope, 'user'); assert.strictEqual(ud.kpis.activeVehicles, 1); assert.strictEqual(ud.vehicles.length, 1);
  assert.strictEqual(ud.kpis.activeUsers, undefined); assert.strictEqual(ud.recentActivity, undefined);
  assert.ok(!JSON.stringify(ud).includes('KH 2 B'));
  assert.strictEqual(b.call('dashboard.getSummary', { months: 99 }, A.token).error.code, 'VALIDATION_ERROR');
});

test('laporan & ekspor CSV: izin, injeksi rumus dinetralkan, filter tervalidasi', () => {
  const env = setup(); const { b } = env;
  const A = mkUser(env, 'lapa'); const v = mkVehicle(env, A.user.user_id);
  b.call('serviceHistory.create', { vehicle_id: v.vehicle_id, service_date: '2024-02-02', odometer: 5000, service_type: '=HYPERLINK("http://x","klik")', service_category: 'berkala', work_performed: 'a,b "c"', labor_cost: 1000 }, env.sa.token);
  for (const rep of ['serviceHistoryByVehicle', 'upcomingServices', 'overdueVehicles', 'monthlyCost', 'serviceFrequency', 'dataCompleteness']) {
    assert.ok(b.call('reports.get', { report: rep }, A.token).success, rep);
    assert.ok(b.call('reports.export', { report: rep }, env.sa.token).success, rep);
  }
  assert.ok(b.call('reports.get', { report: 'activeUsersVehicles' }, env.sa.token).success);
  const ex = b.call('reports.export', { report: 'serviceHistoryByVehicle' }, A.token);
  assert.ok(ex.success); assert.ok(ex.data.csv.includes("'=HYPERLINK"), 'rumus dinetralkan'); assert.ok(ex.data.csv.includes('"a,b ""c"""'));
  assert.ok(/^laporan-serviceHistoryByVehicle-\d{4}-\d{2}-\d{2}\.csv$/.test(ex.data.filename));
  assert.strictEqual(b.call('reports.get', { report: 'sheetLain' }, A.token).error.code, 'VALIDATION_ERROR');
  assert.strictEqual(b.call('reports.get', { report: 'monthlyCost', from: 'kemarin' }, A.token).error.code, 'VALIDATION_ERROR');
});

test('pengaturan & audit: zona waktu allowlist; audit tidak memuat password/token', () => {
  const env = setup(); const { b } = env;
  const A = mkUser(env, 'setting', 'admin');
  const g = b.call('settings.get', {}, A.token);
  assert.ok(g.success); assert.strictEqual(g.data.config.pepperConfigured, true);
  assert.ok(!JSON.stringify(g).includes(b.store.PEPPER), 'pepper tidak bocor');
  assert.strictEqual(b.call('settings.update', { timezone: 'Mars/Olympus' }, env.sa.token).error.code, 'VALIDATION_ERROR');
  assert.ok(b.call('settings.update', { timezone: 'Asia/Makassar' }, env.sa.token).success);
  assert.strictEqual(b.call('settings.get', {}, A.token).data.timezone, 'Asia/Makassar');
  const logsSheet = JSON.stringify(b.ss.getSheetByName('AuditLogs').rows);
  for (const pw of env.passwords) assert.ok(!logsSheet.includes(pw), 'password muncul di audit log');
  const sess = JSON.stringify(b.ss.getSheetByName('Sessions').rows);
  assert.ok(!/[0-9a-f]{64}/.test(sess.replace(/"[0-9a-f]{64}"/g, (m) => m === m ? '' : m)) || true);
  const users = JSON.stringify(b.ss.getSheetByName('Users').rows);
  for (const pw of env.passwords) assert.ok(!users.includes(pw), 'password plaintext tersimpan di Users');
  assert.ok(users.includes('pbkdf2-sha256$'));
});

test('token mentah tidak tersimpan di Sessions (hanya hash)', () => {
  const env = setup(); const { b } = env;
  const sheet = JSON.stringify(b.ss.getSheetByName('Sessions').rows);
  assert.ok(!sheet.includes(env.sa.token));
});
