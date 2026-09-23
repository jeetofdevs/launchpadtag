# TAGLONG — Launch Token Cukup dengan Tag @longdotxyz

> **"Tag it. Long it."**
> Launch token di [Long.xyz](https://app.longxyz.com/) langsung dari X (Twitter), cukup dengan satu tweet yang men-tag **@longdotxyz**. Tanpa buka web, tanpa connect wallet dulu.

---

## 1. Ringkasan Ide

Long.xyz adalah launchpad permissionless di Robinhood Chain di mana setiap token yang di-launch dipasangkan (paired) dengan **Robinhood Stock Token** (NVDA, AAPL, MSFT, GOOGL, TSLA, MU, SPCX) dan diluncurkan lewat *fair auction* tanpa sniper.

**TAGLONG** menambahkan satu jalur baru: **launch by tag**. User cukup nge-tweet:

```
@longdotxyz launch $MOON "Moon Nvidia" paired $NVDA
```

Bot TAGLONG membaca tweet tersebut, membuat token-nya lewat kontrak Long.xyz, lalu membalas tweet itu dengan link token, contract address, dan link auction.

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
 User tweet            TAGLONG Bot                 Long.xyz / Robinhood Chain
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
                     Auction: longxyz.com/t/0x..."
```

Balasan bot contoh:

```
✅ $ROBO "Robo Tesla" sudah LIVE di @longdotxyz
📈 Paired: $TSLA
📜 CA: 0x1234…abcd
⏱ Fair auction berjalan — no snipers
🔗 app.longxyz.com/token/0x1234…abcd
👤 Creator: @username — claim fee di taglong.xyz/claim
```

---

## 4. Creator Fee & Claim

### Wallet operator: **TAGLONG Treasury**

Semua deploy dan claim fee dijalankan dari satu wallet milik operator, disebut **TAGLONG Treasury**:

1. **Deploy** — TAGLONG Treasury memanggil factory Long.xyz, jadi di on-chain yang tercatat sebagai creator token adalah TAGLONG Treasury.
2. **Klaim dari Long.xyz** — bot secara berkala meng-claim creator fee semua token TAGLONG dari Long.xyz ke TAGLONG Treasury.
3. **Pencatatan** — setiap fee yang masuk dicatat di DB per token → per **X user ID** deployer (bukan handle, supaya aman kalau ganti username).
4. **Claim oleh user** — deployer buka `taglong.xyz/claim`, login X (OAuth), connect wallet, lalu TAGLONG Treasury mengirim **80%** dari fee token miliknya ke wallet tersebut. **20%** sisanya tetap di Treasury untuk operasional bot (gas deploy, gas claim, server, X API).

### Pembagian fee

| Penerima | Porsi |
|---|---|
| Deployer (akun X yang nge-tag) | 80% |
| TAGLONG Treasury (operasional bot/gas) | 20% |

> Pembagian ini berlaku untuk creator fee yang diterima TAGLONG Treasury dari Long.xyz. Fee protokol Long.xyz sendiri tetap mengikuti ketentuan Long.xyz.

Contoh: token `$ROBO` menghasilkan 1.000 USDC creator fee → deployer claim **800 USDC**, **200 USDC** tetap di Treasury.

### Transparansi

Karena fee ditahan dulu di wallet operator, user perlu bisa memverifikasi bahwa 80% benar-benar dibayar:

- Alamat TAGLONG Treasury dipublikasikan di bio bot dan di website.
- Halaman publik `taglong.xyz/fees`: per token → total fee yang di-claim dari Long.xyz, jumlah yang sudah dibayar ke deployer, dan tx hash pembayarannya.
- Halaman claim menampilkan rincian: total fee token, 80% bagian deployer, 20% operasional, dan yang sudah pernah di-claim.
- **Roadmap:** pindahkan pembagian 80/20 ke smart contract splitter supaya pembayaran otomatis dan tidak perlu percaya ke operator.

### Keamanan wallet operator

- Private key TAGLONG Treasury disimpan di KMS/HSM atau multisig, bukan di file `.env` server.
- Pisahkan **hot wallet** (gas deploy & kirim claim, saldo kecil) dari **cold wallet** (akumulasi 20% operasional), dan sapu saldo berlebih dari hot ke cold secara berkala.
- Batas maksimal per transaksi claim + alert kalau ada pengeluaran tidak wajar.

---

## 5. Anti-Spam & Keamanan

- **Syarat akun:** umur akun ≥ 30 hari, followers ≥ 50, bukan akun suspended/bot.
- **Rate limit:** maksimal 1 launch / akun / 24 jam (bisa naik untuk akun verified).
- **Ticker filter:** tolak ticker yang sama persis dengan stock asli (`$NVDA`, `$TSLA`, dst.), nama brand besar, dan kata kasar/penipuan.
- **Duplikat:** kalau ticker sudah dipakai dalam 24 jam terakhir, bot balas dengan link token yang sudah ada.
- **Gas sponsor dibatasi:** bot menanggung gas launch dari treasury; kalau treasury tipis, antrean diprioritaskan untuk akun dengan reputasi lebih tinggi.
- **Tidak ada private key di user:** user tidak pernah diminta seed/private key lewat DM. Bot **tidak pernah** DM duluan (edukasi anti-scam di bio bot).
- **Idempotent:** satu tweet ID = maksimal satu token (disimpan di DB), jadi retry/duplikat event tidak bikin token dobel.

---

## 6. Arsitektur Teknis (MVP)

| Komponen | Pilihan |
|---|---|
| Listener | X API v2 — filtered stream / polling mentions `@longdotxyz` (atau akun bot khusus, mis. `@taglongbot`, kalau akun resmi tidak tersedia) |
| Parser | Regex + validasi (lihat di bawah) |
| Queue | Redis / BullMQ — supaya launch diproses berurutan & bisa retry |
| Chain | Robinhood Chain — panggil kontrak factory Long.xyz (viem/ethers) |
| Storage logo | IPFS (Pinata / web3.storage) |
| DB | Postgres: `launches(tweet_id PK, x_user_id, ticker, name, stock, token_address, tx_hash, status)` |
| Claim site | Next.js + X OAuth + wallet connect |
| Wallet operator | TAGLONG Treasury — deploy token, claim fee dari Long.xyz, kirim 80% ke deployer |
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
3. **Fase 2 — Leaderboard:** `taglong.xyz/leaderboard` — creator & token terbaik dari tag, mingguan.
4. **Fase 3 — Perintah lanjutan:**
   - `@longdotxyz buy $TICKER 10` — beli lewat wallet yang sudah di-bind.
   - `@longdotxyz info $TICKER` — bot balas harga, mcap, holder.
   - Integrasi Farcaster/Telegram dengan syntax yang sama.

---

## 8. Nama & Branding

- **Nama:** **TAGLONG**
- **Tagline:** *"Tag it. Long it."*
- **Alternatif nama:** `LongTag`, `Tag2Long`, `@Long It`
- **Hashtag kampanye:** `#TagLong`
- **Contoh tweet peluncuran:**
  > gak perlu buka web lagi. cukup tag @longdotxyz + $TICKER, token lu langsung live, paired ke saham beneran. **Tag it. Long it.** 🟢 #TagLong

---

> ⚠️ Catatan: Ini dokumen ide/konsep. Alamat kontrak, struktur fee, dan API integrasi Long.xyz perlu dikonfirmasi dengan tim @longdotxyz sebelum implementasi.
