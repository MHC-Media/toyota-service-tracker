// Server pengembangan LOKAL: file statis + POST /exec ke backend Apps Script TIRUAN (gas-mock). Bukan untuk produksi.
// Jalankan: node tests/dev-server.js [port]   -> data demo dibuat dalam memori; akun tercetak di konsol.
const http = require('http'), fs = require('fs'), path = require('path');
const { createBackend } = require('./gas-mock');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8080);
const b = createBackend({ quiet: true });

const DEV = { admin: { u: 'admin.dev', p: 'AdminDev-Pass-123' }, user: { u: 'budi.dev', p: 'BudiDev-Pass-123' }, fresh: { u: 'baru.dev' } };
function ok(r) { if (!r.success) throw new Error(JSON.stringify(r.error)); return r.data; }
function seed() {
  const sa = b.bootstrap('superadmin.dev', 'sa@example.test', 'SuperDev-Temp-123');
  let t = ok(b.call('auth.login', { identifier: sa.username, password: sa.password })).token;
  ok(b.call('auth.changePassword', { currentPassword: sa.password, newPassword: 'SuperDev-Pass-123' }, t));
  t = ok(b.call('auth.login', { identifier: sa.username, password: 'SuperDev-Pass-123' })).token;
  const mk = (u, role, pw) => {
    const c = ok(b.call('users.create', { username: u, email: u + '@example.test', full_name: 'Demo ' + u, role }, t));
    if (pw) { const l = ok(b.call('auth.login', { identifier: u, password: c.temporaryPassword })); ok(b.call('auth.changePassword', { currentPassword: c.temporaryPassword, newPassword: pw }, l.token)); }
    return { user: c.user, temp: c.temporaryPassword };
  };
  mk(DEV.admin.u, 'admin', DEV.admin.p);
  const budi = mk(DEV.user.u, 'user', DEV.user.p);
  const fresh = mk(DEV.fresh.u, 'user', null); DEV.fresh.p = fresh.temp;
  b.sandbox.seedDemoRules();
  const veh = (o) => ok(b.call('vehicles.create', o, t)).vehicle;
  const v1 = veh({ plate_number: 'KH 1234 AB', brand: 'Toyota', model: 'Avanza', variant: '1.3 G', year: 2021, engine: '1NR-VE', transmission: 'MT', fuel_type: 'Bensin', current_odometer: 43000, delivery_date: '2021-03-10', owner_user_id: budi.user.user_id });
  veh({ plate_number: 'B 9876 XYZ', brand: 'Toyota', model: 'Kijang Innova', year: 2019, engine: '2GD-FTV', current_odometer: 88000, delivery_date: '2019-06-01' });
  const svc = (d, km, type, codes) => ok(b.call('serviceHistory.create', { vehicle_id: v1.vehicle_id, service_date: d, odometer: km, service_type: type, service_category: 'berkala', service_codes: codes, labor_cost: 150000, parts_cost: 350000 }, t));
  svc('2025-10-01', 35000, 'Servis berkala 35.000 km', 'DEMO-OLI, DEMO-BERKALA');
  svc('2026-04-02', 41000, 'Ganti oli', 'DEMO-OLI');
  b.call('reminders.sync', {}, t);
  console.log('Akun dev:'); [['superadmin.dev', 'SuperDev-Pass-123'], [DEV.admin.u, DEV.admin.p], [DEV.user.u, DEV.user.p], [DEV.fresh.u + ' (wajib ganti password)', DEV.fresh.p]].forEach((x) => console.log('  ' + x[0] + ' / ' + x[1]));
}
seed();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/exec') {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { const out = b.callRaw(body); res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(out)); });
    return;
  }
  if (url.pathname === '/__advance') { b.advance(Number(url.searchParams.get('ms') || 0)); res.writeHead(200); return res.end('ok'); }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p === '/assets/js/config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end("export const CONFIG = { API_URL: '/exec', TIMEZONE: 'Asia/Jakarta', REQUEST_TIMEOUT_MS: 30000 };"); }
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT) || f.includes(path.sep + 'gas' + path.sep) || f.includes(path.sep + 'tests' + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('Dev server: http://localhost:' + PORT + '/login.html'));
