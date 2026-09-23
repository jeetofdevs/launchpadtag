# Deploy LONGSHOT ke Railway — Langkah demi Langkah

Panduan ini dibagi 2 tahap:

- **Tahap 1 — Mode uji coba (gratis, tanpa uang sungguhan).** Website LONGSHOT online, tapi token dan fee-nya masih pura-pura. Tujuannya memastikan server jalan.
- **Tahap 2 — Mode sungguhan.** Bot membaca tweet asli dan membuat token asli di Robinhood Chain.

Kerjakan Tahap 1 dulu sampai berhasil, baru lanjut ke Tahap 2.

---

## Tahap 1 — Online dalam mode uji coba

### Langkah 1. Buat akun Railway

1. Buka **https://railway.com** lalu klik **Login**.
2. Pilih **Login with GitHub** (pakai akun GitHub yang punya repo `launchpadtag`).
3. Untuk server yang jalan 24 jam, pilih paket **Hobby** (sekitar $5/bulan) di menu **Account → Plans**.

### Langkah 2. Buat project dari repo GitHub

1. Di dashboard Railway, klik **New Project**.
2. Pilih **Deploy from GitHub repo**.
3. Kalau diminta, klik **Configure GitHub App** lalu izinkan Railway mengakses repo **`jeetofdevs/launchpadtag`**.
4. Pilih repo **`launchpadtag`**.
5. Railway otomatis membaca file `Dockerfile` dan `railway.json` di repo, jadi tidak perlu mengatur cara build.

> Kalau Railway menanyakan branch, pilih **`claude/ide-launchpad-by-tag-9brxlq`**.

Deploy pertama kemungkinan **gagal**. Itu normal, karena kita belum mengisi pengaturan (Langkah 4).

### Langkah 3. Tambahkan Volume (tempat menyimpan data)

Tanpa Volume, semua data (daftar token, catatan fee) **hilang setiap kali server restart**.

1. Klik service **launchpadtag** di dalam project.
2. Klik kanan area kosong di canvas project (atau tombol **+ Create**), lalu pilih **Volume**.
3. Hubungkan volume ke service **launchpadtag**.
4. Isi **Mount path** dengan: `/data`

### Langkah 4. Isi pengaturan (Variables)

1. Klik service **launchpadtag**, lalu buka tab **Variables**.
2. Klik **Raw Editor**, lalu tempel ini:

```
PORT=8787
CHAIN_MODE=mock
X_ENABLED=false
ALLOW_DEV_LOGIN=true
DB_PATH=/data/longshot.db
SESSION_SECRET=GANTI_DENGAN_TEKS_ACAK_PANJANG
```

3. Ganti `GANTI_DENGAN_TEKS_ACAK_PANJANG` dengan teks acak minimal 32 karakter. Contoh cara membuatnya: buka https://www.random.org/strings/ atau ketik asal huruf dan angka yang panjang. **Jangan dibagikan ke siapa pun.**
4. Klik **Update Variables**. Railway akan deploy ulang otomatis.

### Langkah 5. Buat alamat website

1. Masih di service **launchpadtag**, buka tab **Settings**.
2. Di bagian **Networking**, klik **Generate Domain**.
3. Kalau ditanya port, isi **8787**.
4. Kamu akan dapat alamat seperti `launchpadtag-production.up.railway.app`.

### Langkah 6. Cek apakah berhasil

1. Buka `https://ALAMAT-KAMU.up.railway.app/healthz`. Kalau muncul `{"ok":true,...}`, **server sudah jalan**. 🎉
2. Buka `https://ALAMAT-KAMU.up.railway.app/` untuk melihat website LONGSHOT.
3. Kalau ada masalah, buka tab **Deployments**, klik deploy terakhir, lalu **View Logs**. Kirim isi log-nya ke Claude.

✅ **Tahap 1 selesai.** Di mode ini belum ada tweet yang dibaca dan belum ada token asli.

---

## Tahap 2 — Mode sungguhan

⚠️ Mulai tahap ini, bot memakai **uang sungguhan**. Siapkan dulu 3 hal berikut.

### A. Wallet LONGSHOT Treasury

1. Di MetaMask, buat **akun baru** khusus untuk bot. Jangan pakai wallet pribadi.
2. Tambahkan jaringan **Robinhood Chain**:
   - Network name: `Robinhood Chain`
   - RPC URL: `https://rpc.mainnet.chain.robinhood.com`
   - Chain ID: `4663`
   - Currency symbol: `ETH`
   - Block explorer: `https://robinhoodchain.blockscout.com`
3. Kirim **sedikit ETH** ke wallet ini untuk biaya gas.
4. Ambil private key-nya: MetaMask → titik tiga → **Account details → Show private key**.
   - Private key hanya ditempel di Railway (langkah D). **Jangan pernah kirim ke chat, termasuk ke Claude.**

### B. Akun X untuk bot

1. Buat akun X baru untuk bot, misalnya `@longshotbot`.
2. Login dengan akun itu di **https://developer.x.com**, lalu daftar developer.
3. Pilih paket yang punya akses **search** (paket **Basic** atau lebih tinggi; paket gratis tidak cukup).
4. Buat **Project** dan **App**, lalu catat:
   - **Bearer Token**
   - **API Key** dan **API Key Secret**
   - **Access Token** dan **Access Token Secret**. Pastikan izinnya **Read and Write**, supaya bot bisa membalas tweet.
5. Di pengaturan App, buka **User authentication settings** dan aktifkan **OAuth 2.0**:
   - Type of App: **Web App**
   - Callback URL: `https://ALAMAT-KAMU.up.railway.app/auth/x/callback`
   - Website URL: `https://ALAMAT-KAMU.up.railway.app`
   - Catat **Client ID** dan **Client Secret**.

### C. Izin dari tim Long.xyz (sangat disarankan)

DM **@longdotxyz**. Tanyakan apakah mereka mengizinkan bot LONGSHOT, dan apakah token buatan bot bisa tampil di app.long.xyz.

### D. Ganti pengaturan di Railway

Buka tab **Variables** → **Raw Editor**, lalu ganti isinya dengan ini (isi bagian yang kosong):

```
PORT=8787
CHAIN_MODE=onchain
DB_PATH=/data/longshot.db
SESSION_SECRET=teks-acak-yang-sama-seperti-tahap-1

TREASURY_PRIVATE_KEY=
MAX_PAYOUT_PER_CLAIM=0

X_ENABLED=true
TRIGGER_HANDLE=longdotxyz
X_BEARER_TOKEN=
X_APP_KEY=
X_APP_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
X_OAUTH_CLIENT_ID=
X_OAUTH_CLIENT_SECRET=
```

Hapus baris `ALLOW_DEV_LOGIN` kalau masih ada. Klik **Update Variables**.

### E. Tes kecil sebelum diumumkan

1. Dari akun X **pribadi** kamu, tweet: `@longdotxyz launch $TESTLS "Test Longshot" paired $NVDA`
2. Tunggu sekitar 1 menit. Bot seharusnya membalas tweet itu dengan alamat token (CA).
3. Beli token itu sedikit supaya ada fee.
4. Tunggu sekitar 15 menit (bot meng-klaim fee secara berkala).
5. Buka `https://ALAMAT-KAMU.up.railway.app/claim`, login dengan X, masukkan wallet pribadi, lalu klik **Claim**.
6. Cek wallet pribadi kamu: 80% fee harus masuk.

Kalau semua berhasil, LONGSHOT siap diumumkan. 🚀

---

## Kalau ada masalah

| Gejala | Kemungkinan penyebab |
|---|---|
| `/healthz` tidak bisa dibuka | Domain belum dibuat (Langkah 5), atau deploy gagal. Cek **View Logs**. |
| Log: `Set SESSION_SECRET` | Variable `SESSION_SECRET` belum diisi. |
| Data hilang setelah restart | Volume belum dipasang di `/data` (Langkah 3). |
| Bot tidak membalas tweet | `X_ENABLED` bukan `true`, paket X API tidak punya akses search, atau izin App bukan *Read and Write*. |
| Log: `TREASURY_PRIVATE_KEY is missing/invalid` | Private key belum diisi atau salah copy (harus 64 karakter, boleh diawali `0x` atau tidak). |
| Log: `RECONCILE:` | Ada transaksi yang terkirim tapi belum terkonfirmasi. Saldo user dikunci supaya aman. Kirim log-nya ke Claude untuk dicek. |

Kirim isi **View Logs** ke Claude kapan saja kalau bingung.
