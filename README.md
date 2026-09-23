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

- Token dibuat oleh **wallet bot**, tapi hak creator fee dicatat ke **X user ID** (bukan handle, supaya aman kalau ganti username).
- Fee terkumpul di kontrak escrow `TagLongVault`.
- Creator claim lewat `taglong.xyz/claim`: login X (OAuth) → connect wallet → fee di-withdraw ke wallet.
- Setelah claim pertama, user bisa "bind" wallet sehingga fee berikutnya langsung ke wallet tersebut.

Usulan pembagian fee trading (contoh, bisa disesuaikan dengan struktur fee Long.xyz):

| Penerima | Porsi |
|---|---|
| Creator (yang nge-tag) | 50% |
| Protokol Long.xyz | 40% |
| TAGLONG (operasional bot/gas) | 10% |

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
