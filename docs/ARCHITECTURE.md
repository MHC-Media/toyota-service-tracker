# Toyota Service Tracker — Arsitektur (Fase 1)

Status dokumen: IMPLEMENTED (desain). Belum ada klaim TESTED.

## 1. Diagram arsitektur

```
 Browser (HTTPS)
 ┌──────────────────────────────┐
 │ GitHub Pages (statis)        │  HTML/CSS/JS, Lucide, Chart.js
 │ index.html, login.html       │  TIDAK ada secret di sini
 └──────────────┬───────────────┘
                │ fetch POST (Content-Type: text/plain, body JSON)
                │ tanpa preflight CORS
                ▼
 ┌──────────────────────────────┐
 │ Google Apps Script Web App   │  Execute as: Me (pemilik)
 │ doPost(e) → Router           │  Access: Anyone (anonim)
 │  ├ Security (hash, token)    │  → autentikasi dilakukan SENDIRI
 │  ├ AuthService / UserService │    oleh aplikasi, bukan oleh Google
 │  ├ Vehicle / Service         │
 │  ├ Maintenance / Recommend   │
 │  └ AuditService              │
 └──────────────┬───────────────┘
                │ SpreadsheetApp (batch read/write, LockService)
                ▼
 ┌──────────────────────────────┐
 │ Google Sheets (privat)       │  Hanya pemilik; user aplikasi
 │ Users, Vehicles, ...         │  TIDAK punya akses ke file ini
 └──────────────────────────────┘
 Script Properties: SPREADSHEET_ID, PEPPER, TZ  (secret server)
```

## 2. Keputusan komunikasi API (penting)

- Web App dideploy "Execute as: Me", "Who has access: Anyone". Identitas pengguna akhir TIDAK diambil dari `Session.getActiveUser()`; seluruh autentikasi memakai token sesi aplikasi.
- Frontend memakai `POST` dengan `Content-Type: text/plain;charset=utf-8` dan body JSON string. Ini "simple request" sehingga tidak memicu preflight `OPTIONS` (Apps Script tidak bisa menjawab OPTIONS). Respons dikembalikan via `ContentService` (JSON).
- Apps Script tidak dapat mengatur header HTTP kustom, cookie HttpOnly, maupun status HTTP selain 200. Karena itu status sukses/gagal ada pada field `success` dan `error.code` di body.
- Token tidak boleh ada di URL. `doGet` hanya mengembalikan `health.check` minimal.
- Status: NOT VERIFIED sampai diuji di browser nyata dari origin GitHub Pages (PRODUCTION BLOCKER sampai lulus).

## 3. Keputusan autentikasi dan sesi

| Aspek | Keputusan | Keterbatasan |
|---|---|---|
| Hash password | PBKDF2-HMAC-SHA256 implementasi manual di atas `Utilities.computeHmacSha256Signature`, salt acak 16 byte per akun, iterasi dapat dikonfigurasi (default 10.000), ditambah pepper di Script Properties | GAS tidak punya PBKDF2/Argon2/scrypt native dan lambat; iterasi jauh di bawah rekomendasi OWASP (≥600.000). Kompensasi: pepper, throttling, password minimal 12 karakter. Kecepatan perlu diukur (NOT VERIFIED) |
| Token sesi | 32 byte acak (dari UUID + entropi tambahan), hanya hash SHA-256 disimpan di sheet Sessions | Entropi bergantung pada `Utilities.getUuid()`; dicampur beberapa sumber |
| Penyimpanan token di browser | `sessionStorage` (hilang saat tab ditutup) | Tetap dapat dicuri oleh XSS. Mitigasi: tanpa innerHTML untuk data tak tepercaya, CSP meta, dependensi minimal dan dipin |
| Masa berlaku | Idle 30 menit, absolut 8 jam, rotasi token tiap 15 menit aktivitas | Dikonfigurasi di Config.gs |
| Pencabutan | Logout, reset password, nonaktif akun, ubah role mencabut semua sesi user | |
| Throttling login | Penghitung di CacheService (per identifier dan global) + `failed_login_count`/`locked_until` di Users | CacheService best-effort; tidak bisa membatasi per IP karena IP tidak tersedia di Apps Script |
| Bootstrap admin | Fungsi `bootstrapSuperadmin()` dijalankan manual sekali dari editor; password dibaca dari Script Properties lalu properti dihapus | Tidak ada kredensial default |

Rekomendasi jalur peningkatan: Cloud Run/Cloud Functions + cookie HttpOnly/Secure/SameSite, Apps Script hanya sebagai layanan data internal.

## 4. Struktur repository

Sesuai master prompt, dengan tambahan `docs/`. File `gas/*.gs` TIDAK dapat dipanggil langsung: salin ke proyek Apps Script (satu file per `.gs`, isi `appsscript.json` lewat Project Settings → Show manifest) atau sinkronkan dengan `clasp push` (`.clasp.json` dengan `rootDir: gas`). Semua file `.gs` berbagi satu global scope, urutan file tidak penting kecuali konstanta top-level yang saling bergantung.

## 5. Model data

Sesuai bagian 5 master prompt. Penyimpangan yang disengaja dan didokumentasikan:

- `Users` ditambah `full_name`, `failed_login_count`, `locked_until` (spec meminta edit nama dan throttling tetapi kolom tidak tercantum).
- `Sessions` ditambah `rotated_from` untuk jejak rotasi.
- Seluruh timestamp ISO 8601; tanggal murni disimpan sebagai teks `yyyy-MM-dd` agar tidak bergeser zona waktu. Kolom tanggal diformat plain text.
- Kunci utama: UUID internal (`Utilities.getUuid()`), bukan nomor polisi.
- Relasi dicek manual di service layer (vehicle→owner, service→vehicle, access→user/vehicle).

## 6. Matriks role dan permission

Default-deny. `own` = kendaraan yang dimiliki atau diberi akses (UserVehicleAccess aktif).

| Action | user | admin | superadmin |
|---|---|---|---|
| auth.login / logout / me / changePassword | ✔ | ✔ | ✔ |
| auth.resetPassword (self-service) | ✖ (via admin) | ✖ | ✔ |
| dashboard.getSummary | own | semua | semua |
| users.list/create/update/deactivate/resetPassword | ✖ | role `user` saja | semua |
| Mengubah role menjadi admin/superadmin | ✖ | ✖ | ✔ |
| vehicles.list/get | own | semua | semua |
| vehicles.create/update/archive | ✖ | ✔ | ✔ |
| serviceHistory.list/get | own | semua | semua |
| serviceHistory.create/update | ✖ | ✔ | ✔ |
| maintenanceRules.list | ✔ (terverifikasi saja) | ✔ | ✔ |
| maintenanceRules.create/update/verify | ✖ | create/update | + verify |
| recommendations.get / reminders.list | own | semua | semua |
| reports.get/export | own | semua | semua |
| auditLogs.list | ✖ | ✔ (tanpa log superadmin) | ✔ |
| health.check | publik (minimal) | | |

## 7. Threat model ringkas

| Ancaman | Mitigasi | Risiko sisa |
|---|---|---|
| Brute force login | Throttle + lockout + pesan generik | Tanpa pembatasan per IP |
| Pencurian token via XSS | Tanpa innerHTML data tak tepercaya, CSP, sessionStorage, masa berlaku pendek | Tetap mungkin; token bearer |
| IDOR | Cek akses per objek di backend, ID tidak menentukan hak | — |
| Mass assignment | Allowlist field per action; role/owner tidak diterima bebas | — |
| Eskalasi hak | Role dibaca dari Users saat tiap request, bukan dari token | — |
| Kebocoran hash | Repository menghapus `password_*` dari semua respons | — |
| CSV formula injection | Awali `'` pada nilai berawal `= + - @` | — |
| Race condition tulis | LockService pada semua operasi tulis | Kuota lock |
| Penyalahgunaan URL Web App publik | Semua action selain health/login butuh token | URL tidak dianggap rahasia |
| Data pribadi (plat, VIN4, biaya) | Spreadsheet privat, audit log, akses minimum | Pemilik Google account = titik tunggal |
| Hash lemah dibanding Argon2 | Pepper + iterasi tinggi sebisanya | PRODUCTION BLOCKER bila risiko tak diterima |

## 8. Aturan servis

Tidak ada interval Toyota yang ditanam di kode. Semua dari sheet `MaintenanceRules`; `verified_status` ∈ `VERIFIED` | `UNVERIFIED`. Seed demo ditandai `UNVERIFIED` dan sumbernya kosong. Kolom tambahan `due_logic` (`EARLIER`|`LATER`|`TIME_ONLY`|`KM_ONLY`) dan `anchor` (`LAST_SERVICE`|`DELIVERY_DATE`) ditambahkan karena spec meminta konfigurasi cara menghitung jatuh tempo.

## 9. Asumsi dan keterbatasan

- Skala: ratusan kendaraan, puluhan pengguna. Kuota Apps Script (waktu eksekusi 6 menit, ~20.000 pemanggilan URL fetch tidak relevan, lock) membatasi beban tinggi. Migrasi: Cloud SQL/Firestore.
- Notifikasi hanya dalam aplikasi; email/WhatsApp tidak dijanjikan.
- Pengujian: unit test logika murni (`tests/`) dapat dijalankan dengan Node; integrasi GAS harus dijalankan manual.


## Pembaruan implementasi (Fase 2–4)
Status: IMPLEMENTED; TESTED pada mock Apps Script + Chromium (bukan Apps Script nyata).
- `auth.resetPassword` adalah alias `users.resetPassword`; tambahan aksi `reminders.sync`.
- Pengaturan yang dapat diubah hanya zona waktu (superadmin). Ambang status tetap di `REC_THRESHOLDS` (kode).
- Frontend: modul ES per halaman dimuat lazy oleh `assets/js/app.js`; tanpa innerHTML; CSP ketat via meta.
- Uji: `tests/integration.test.js`, `tests/backend.test.js`; `tests/dev-server.js` menjalankan UI terhadap backend tiruan.
- Kekurangan terdokumentasi: lihat README (laporan kesiapan) dan SECURITY.md.
