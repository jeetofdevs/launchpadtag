# LONGSHOT — Launch Token Cukup dengan Tag @longdotxyz

> **"One tweet. One token."**
> Launch token di [Long.xyz](https://app.long.xyz/) langsung dari X (Twitter), cukup dengan satu tweet yang men-tag **@longdotxyz**. Tanpa buka web, tanpa connect wallet dulu.

> 🚀 **Mau langsung coba?** Lompat ke [Menjalankan LONGSHOT](#9-menjalankan-longshot).
> ☁️ **Deploy ke server?** Ikuti [panduan Railway langkah demi langkah](DEPLOY-RAILWAY.md).

---

## 1. Ringkasan Ide

Long.xyz adalah launchpad permissionless di Robinhood Chain di mana setiap token yang di-launch dipasangkan (paired) dengan **Robinhood Stock Token** (NVDA, AAPL, MSFT, GOOGL, TSLA, MU, SPCX) dan diluncurkan lewat *fair auction* tanpa sniper.

**LONGSHOT** menambahkan satu jalur baru: **launch by tag**. User cukup nge-tweet:

```
@longdotxyz launch $MOON "Moon Nvidia" paired $NVDA
```

Bot LONGSHOT membaca tweet tersebut, membuat token-nya lewat kontrak Long.xyz, lalu membalas tweet itu dengan link token, contract address, dan link auction.

Kenapa ini menarik:
- **Viral by default** — setiap launch otomatis jadi tweet publik + reply bot, jadi distribusi & marketing jalan dari detik pertama.
- **Friksi nol** — narasi/meme muncul di timeline, token-nya bisa langsung lahir di thread yang sama.
- **Creator-first** — fee creator otomatis dialokasikan ke akun X yang nge-tag, bisa di-claim kapan saja.

---

## 2. Format Perintah (Tag Syntax)

```
@longdotxyz launch $<TICKER> "<Nama Token>" [paired $<STOCK>] [+ gambar]
```

| Bagian | Wajib | Keterangan |
|---|---|---|
| `@longdotxyz` | ✅ | Trigger bot |
| `launch` | ✅ | Kata kunci perintah (alias: `deploy`, `long`) |
| `$TICKER` | ✅ | 2–10 karakter, huruf/angka |
| `"Nama Token"` | ❌ | Default = ticker |
| `paired $STOCK` | ❌ | Salah satu: `NVDA`, `AAPL`, `MSFT`, `GOOGL`, `TSLA`, `MU`, `SPCX`. Default: `NVDA` |
| Gambar di tweet | ❌ | Jadi logo token. Kalau tidak ada → pakai avatar user |

**Contoh:**

```
@longdotxyz launch $ROBO "Robo Tesla" paired $TSLA   (+ foto)
@longdotxyz launch $APPLZ
@longdotxyz long $CHIP "Micron Degen" paired $MU
```

**Launch dari reply (meme-jacking):** Kalau user me-reply sebuah tweet viral dengan `@longdotxyz launch $TICKER`, gambar & teks tweet induk dipakai sebagai logo & deskripsi token, dan link tweet induk disimpan sebagai "origin" token.

---

## 3. Alur (Flow)

```
 User tweet            LONGSHOT Bot                 Long.xyz / Robinhood Chain
 ──────────            ───────────                 ──────────────────────────
 "@longdotxyz  ──▶  1. Tangkap mention (X API)
  launch $X"        2. Parse perintah
                    3. Validasi (akun, rate limit,
                       ticker, blacklist)
                    4. Upload logo → IPFS
                    5. Panggil factory/create   ──▶  Token dibuat + pair ke Stock Token
                                                     Fair auction dimulai
                    6. Simpan creator = X handle ◀── tx hash + contract address
 ◀── Reply bot   7. Reply tweet:
                    "✅ $X live! CA: 0x...
                     Auction: app.long.xyz/tokens/0x..."
```

Balasan bot contoh:

```
✅ $ROBO "Robo Tesla" sudah LIVE di @longdotxyz
📈 Paired: $TSLA
📜 CA: 0x1234…abcd
⏱ Fair auction berjalan — no snipers
🔗 app.long.xyz/tokens/0x1234…abcd
👤 Creator: @username — claim fee di longshot.xyz/claim
```

---

## 4. Creator Fee & Claim

### Wallet operator: **LONGSHOT Treasury**

Semua deploy dan claim fee dijalankan dari satu wallet milik operator, disebut **LONGSHOT Treasury**:

1. **Deploy** — LONGSHOT Treasury memanggil factory Long.xyz, jadi di on-chain yang tercatat sebagai creator token adalah LONGSHOT Treasury.
2. **Klaim dari Long.xyz** — bot secara berkala meng-claim creator fee semua token LONGSHOT dari Long.xyz ke LONGSHOT Treasury.
3. **Pencatatan** — setiap fee yang masuk dicatat di DB per token → per **X user ID** deployer (bukan handle, supaya aman kalau ganti username).
4. **Claim oleh user** — deployer buka `longshot.xyz/claim`, login X (OAuth), connect wallet, lalu LONGSHOT Treasury mengirim **80%** dari fee token miliknya ke wallet tersebut. **20%** sisanya tetap di Treasury untuk operasional bot (gas deploy, gas claim, server, X API).

### Pembagian fee

| Penerima | Porsi |
|---|---|
| Deployer (akun X yang nge-tag) | 80% |
| LONGSHOT Treasury (operasional bot/gas) | 20% |

> Pembagian ini berlaku untuk creator fee yang diterima LONGSHOT Treasury dari Long.xyz. Fee protokol Long.xyz sendiri tetap mengikuti ketentuan Long.xyz.

Contoh: token `$ROBO` menghasilkan 1.000 USDC creator fee → deployer claim **800 USDC**, **200 USDC** tetap di Treasury.

### Transparansi

Karena fee ditahan dulu di wallet operator, user perlu bisa memverifikasi bahwa 80% benar-benar dibayar:

- Alamat LONGSHOT Treasury dipublikasikan di bio bot dan di website.
- Halaman publik `longshot.xyz/fees`: per token → total fee yang di-claim dari Long.xyz, jumlah yang sudah dibayar ke deployer, dan tx hash pembayarannya.
- Halaman claim menampilkan rincian: total fee token, 80% bagian deployer, 20% operasional, dan yang sudah pernah di-claim.
- **Roadmap:** pindahkan pembagian 80/20 ke smart contract splitter supaya pembayaran otomatis dan tidak perlu percaya ke operator.

### Keamanan wallet operator

- Private key LONGSHOT Treasury disimpan di KMS/HSM atau multisig, bukan di file `.env` server.
- Pisahkan **hot wallet** (gas deploy & kirim claim, saldo kecil) dari **cold wallet** (akumulasi 20% operasional), dan sapu saldo berlebih dari hot ke cold secara berkala.
- Batas maksimal per transaksi claim + alert kalau ada pengeluaran tidak wajar.

---

## 5. Anti-Spam & Keamanan

- **Syarat akun:** umur akun ≥ 30 hari, followers ≥ 50, bukan akun suspended/bot.
- **Rate limit:** maksimal 1 launch / akun / 24 jam (bisa naik untuk akun verified).
- **Ticker filter:** tolak ticker yang sama persis dengan stock asli (`$NVDA`, `$TSLA`, dst.), nama brand besar, dan kata kasar/penipuan.
- **Ticker reserved (ikut aturan Long.xyz):** ticker yang **pernah** di-launch, baik lewat LONGSHOT maupun langsung di app.long.xyz, ditolak dengan balasan singkat *"❌ $TICKER reserved. Try again using another ticker."* Simbol ke-196 saham Robinhood (AMZN, META, PLTR, dst.) juga reserved. Bot membaca setiap event `LaunchCreated` di kontrak LongLauncher (`src/chain/tickers.ts`) dan mengambil ticker dari `symbol()` token-nya. Sebelum memproses tweet, bot selalu menyamakan data dengan blok terbaru. Kalau pengecekan gagal, tweet ditunda dan tidak ada token yang dibuat. Bawaannya reserved selamanya (`TICKER_COOLDOWN_HOURS=0`); isi misalnya `24` kalau ternyata Long.xyz melepas ticker setelah 24 jam.
- **Gas sponsor dibatasi:** bot menanggung gas launch dari treasury; kalau treasury tipis, antrean diprioritaskan untuk akun dengan reputasi lebih tinggi.
- **Tidak ada private key di user:** user tidak pernah diminta seed/private key lewat DM. Bot **tidak pernah** DM duluan (edukasi anti-scam di bio bot).
- **Idempotent:** satu tweet ID = maksimal satu token (disimpan di DB), jadi retry/duplikat event tidak bikin token dobel.

---

## 6. Arsitektur Teknis (MVP)

| Komponen | Pilihan |
|---|---|
| Listener | X API v2 — filtered stream / polling mentions `@longdotxyz` (atau akun bot khusus, mis. `@longshotbot`, kalau akun resmi tidak tersedia) |
| Parser | Regex + validasi (lihat di bawah) |
| Queue | Redis / BullMQ — supaya launch diproses berurutan & bisa retry |
| Chain | Robinhood Chain — panggil kontrak factory Long.xyz (viem/ethers) |
| Storage logo | IPFS (Pinata / web3.storage) |
| DB | Postgres: `launches(tweet_id PK, x_user_id, ticker, name, stock, token_address, tx_hash, status)` |
| Claim site | Next.js + X OAuth + wallet connect |
| Wallet operator | LONGSHOT Treasury — deploy token, claim fee dari Long.xyz, kirim 80% ke deployer |
| Ledger fee | Postgres: `fees(token_address, x_user_id, amount_in, paid_out, tx_hash)` |

Regex parser sederhana:

```ts
const CMD = /@longdotxyz\s+(launch|deploy|long)\s+\$([A-Za-z0-9]{2,10})(?:\s+"([^"]{1,32})")?(?:\s+paired\s+\$(NVDA|AAPL|MSFT|GOOGL|TSLA|MU|SPCX))?/i;

function parseTag(text: string) {
  const m = text.match(CMD);
  if (!m) return null;
  const ticker = m[2].toUpperCase();
  return {
    ticker,
    name: m[3] ?? ticker,
    stock: (m[4] ?? "NVDA").toUpperCase(),
  };
}
```

---

## 7. Roadmap

1. **Fase 0 — Prototype:** bot jalan di testnet, whitelist 20 akun, reply manual-approve.
2. **Fase 1 — Public beta:** launch by tag terbuka dengan rate limit ketat + halaman claim fee.
3. **Fase 2 — Leaderboard:** `longshot.xyz/leaderboard` — creator & token terbaik dari tag, mingguan.
4. **Fase 3 — Perintah lanjutan:**
   - `@longdotxyz buy $TICKER 10` — beli lewat wallet yang sudah di-bind.
   - `@longdotxyz info $TICKER` — bot balas harga, mcap, holder.
   - Integrasi Farcaster/Telegram dengan syntax yang sama.

---

## 8. Nama & Branding

- **Nama:** **LONGSHOT**
- **Tagline:** *"One tweet. One token."*
- **Hashtag kampanye:** `#LongShot`
- **Contoh tweet peluncuran:**
  > gak perlu buka web lagi. cukup tag @longdotxyz + $TICKER, token lu langsung live, paired ke saham beneran. **One tweet. One token.** 🟢 #LongShot

---

## 9. Menjalankan LONGSHOT

Butuh **Node.js ≥ 22.5** (pakai `node:sqlite` bawaan, tanpa database eksternal).

```bash
npm install
cp .env.example .env
npm run simulate   # simulasi penuh: tweet → launch → reply → harvest fee → claim 80%
npm test           # parser, anti-spam, idempotensi, ledger 80/20, anti double-claim
npm start          # bot + harvester + web di http://localhost:8787
```

Mode default `CHAIN_MODE=mock` memakai Long.xyz tiruan, jadi semuanya bisa dicoba tanpa wallet dan tanpa X API. Di mode mock tanpa OAuth, halaman `/claim` punya tombol *login dev*.

### Struktur kode

| File | Isi |
|---|---|
| `src/parser.ts` | Parse `@longdotxyz launch $TICKER "Nama" paired $STOCK` |
| `src/validate.ts` | Anti-spam: umur akun, followers, rate limit, blacklist ticker, reservasi ticker |
| `src/chain/tickers.ts` | Indexer ticker Long.xyz dari event `LaunchCreated` di LongLauncher |
| `src/bot.ts` | Pipeline satu tweet: validasi → metadata → deploy → reply (idempotent per tweet ID) |
| `src/x/client.ts` | X API: recent search untuk tag, reply dari akun bot |
| `src/chain/onchain.ts` | Transaksi dari **LONGSHOT Treasury** via Doppler SDK: deploy multicurve, klaim fee beneficiary, transfer ERC-20 |
| `src/chain/mock.ts` | Long.xyz tiruan untuk dev/test |
| `src/harvester.ts` | Claim creator fee semua token ke Treasury secara berkala, dibukukan 80/20 |
| `src/ledger.ts` | Ledger fee & payout; reservasi atomik supaya tidak bisa double-claim |
| `src/claim.ts` | Kirim 80% ke wallet deployer |
| `src/web/server.ts` | Landing, `/claim` (login X OAuth2), `/fees` (transparansi), `/meta/:id.json` |

### Integrasi on-chain (hasil riset)

Long.xyz berjalan di atas **[Doppler Protocol](https://github.com/Long-xyz/longxyz-doppler)** di **Robinhood Chain (chain ID 4663)**. Launch di Long.xyz adalah pool *multicurve* Doppler yang dipasangkan ke Stock Token, dan creator fee dialirkan ke alamat **beneficiary** yang ditetapkan saat launch. Pihak ketiga seperti LONGETF sudah memakai pola yang sama: beneficiary-nya vault mereka, bukan wallet creator. Itu persis model LONGSHOT Treasury.

`src/chain/onchain.ts` memakai SDK resmi `@whetstone-research/doppler-sdk`:

- **Deploy**: `MulticurveBuilder` → token dipasangkan ke Stock Token, fee pool 1%, beneficiary = protocol owner Doppler (minimum 5%) + **LONGSHOT Treasury (95%)**, migrasi `noOp` supaya pool tetap terkunci dan fee terus mengalir.
- **Klaim fee**: `getMulticurvePool(token).collectFees()` dari Treasury. Fee masuk dalam **dua aset**: Stock Token pasangannya **dan** token yang di-launch. Keduanya dibukukan 80/20 dan dibayarkan ke deployer.
- Jumlah fee dihitung dari selisih saldo Treasury sebelum/sesudah klaim, dijalankan bergantian dengan payout (mutex) supaya angkanya tidak tercampur.

| Kontrak | Alamat | Sumber |
|---|---|---|
| LongLauncher (Long.xyz) | `0x22e99278308B393ea1260859B181AD7E78f5eeED` | [stock-pair-alerts](https://github.com/Wayakart/stock-pair-alerts), Bitquery |
| Doppler Airlock | `0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862` | Doppler SDK 1.0.43 |
| Doppler DopplerHookInitializer | `0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544` | Doppler SDK 1.0.43 |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | [0xsequence token-directory](https://github.com/0xsequence/token-directory) |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | token-directory |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | token-directory |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | token-directory |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | token-directory |
| MU | `0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD` | token-directory |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` | token-directory |

> ⚠️ **Domain resmi Long.xyz adalah `long.xyz`** (`app.long.xyz`). Hasil pencarian juga memunculkan `app.longxyz.com`, yang tampaknya **bukan** domain resmi. Jangan connect wallet Treasury ke sana.

### Yang belum terverifikasi

1. **Muncul di app.long.xyz?** Token yang dibuat langsung lewat Doppler memakai infrastruktur yang sama dengan Long.xyz, tapi Long.xyz mendata launch dari event `LaunchCreated` di **LongLauncher**. Kalau token harus tampil di feed Long.xyz, deploy perlu lewat LongLauncher. ABI-nya belum publik, jadi cek tab *Contract* di [Blockscout](https://robinhoodchain.blockscout.com/address/0x22e99278308B393ea1260859B181AD7E78f5eeED) atau minta ke tim @longdotxyz. Cukup ganti `createToken()`, klaim fee tetap sama.
2. **Parameter kurva** memakai preset market cap SDK. Sesuaikan dengan parameter launch Long.xyz kalau ingin kurva harga yang sama.
3. Semua alamat di atas diambil dari sumber publik; RPC Robinhood Chain tidak bisa diakses dari environment build ini, jadi **uji dulu dengan dana kecil**.

### Menuju produksi (`CHAIN_MODE=onchain`)

1. **Treasury** — isi `TREASURY_PRIVATE_KEY` dengan hot wallet bersaldo kecil (idealnya dari KMS), isi ETH untuk gas, set `MAX_PAYOUT_PER_CLAIM`, dan pantau log `RECONCILE:` (transaksi terkirim tapi belum terkonfirmasi — saldo dikunci sampai dicek manual).
2. **X API** — plan dengan akses *recent search*, akun bot (mis. `@longshotbot`) untuk reply, dan OAuth 2.0 client untuk login di `/claim`. Set `X_ENABLED=true`.
3. **Deploy** — satu proses Node (`npm start`) + volume persisten untuk `DB_PATH`. Pasang di belakang HTTPS dan set `SESSION_SECRET`.
4. **Uji coba** — launch 1 token dengan akun sendiri, trading kecil, tunggu harvest, lalu claim, sebelum dibuka ke publik.
