import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { TwitterApi } from "twitter-api-v2";
import { formatUnits, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { tokenUrl } from "../bot.ts";
import type { LongClient } from "../chain/index.ts";
import { claimAll } from "../claim.ts";
import type { Config } from "../config.ts";
import type { DB } from "../db.ts";
import { balances, feeReport, recentPayouts } from "../ledger.ts";
import { buildMetadata } from "../metadata.ts";
import { html, layout, raw } from "./html.ts";

interface Session {
  uid: string;
  username: string;
}

const SESSION = "ls_session";
const OAUTH = "ls_oauth";
const FLASH = "ls_flash";

export function createApp(cfg: Config, db: DB, long: LongClient) {
  const app = new Hono();
  const secret = cfg.sessionSecret;
  const secureCookie = cfg.publicUrl.startsWith("https://");
  const devLogin = cfg.chain.mode === "mock" && !cfg.x.oauthClientId;

  const csrfFor = (uid: string) => createHmac("sha256", secret).update(`csrf:${uid}`).digest("hex");
  const csrfOk = (uid: string, token: string) => {
    const a = Buffer.from(csrfFor(uid));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function session(c: Context): Promise<Session | null> {
    const v = await getSignedCookie(c, secret, SESSION);
    if (!v) return null;
    try {
      return JSON.parse(v) as Session;
    } catch {
      return null;
    }
  }

  async function login(c: Context, s: Session) {
    await setSignedCookie(c, SESSION, JSON.stringify(s), secret, {
      httpOnly: true, sameSite: "Lax", secure: secureCookie, path: "/", maxAge: 7 * 24 * 3600,
    });
  }

  async function fmt(asset: string, amount: bigint) {
    const { symbol, decimals } = await long.assetInfo(asset as Address);
    return `${formatUnits(amount, decimals)} ${symbol}`;
  }

  async function redirectWithFlash(c: Context, msg: string) {
    await setSignedCookie(c, FLASH, msg, secret, { httpOnly: true, sameSite: "Lax", secure: secureCookie, path: "/claim", maxAge: 60 });
    return c.redirect("/claim");
  }

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  // ── Landing ────────────────────────────────────────────────────────────────
  app.get("/", (c) => {
    const stats = db
      .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT x_user_id) AS u FROM launches WHERE status = 'live'")
      .get() as { n: number; u: number };
    const recent = db
      .prepare("SELECT tweet_id, ticker, name, stock, x_username, token_address FROM launches WHERE status = 'live' ORDER BY created_at DESC LIMIT 10")
      .all() as { tweet_id: string; ticker: string; name: string; stock: string; x_username: string; token_address: string }[];
    const h = cfg.x.triggerHandle;
    return c.html(layout("LONGSHOT", html`
      <span class="tag">Launch by tag · Long.xyz</span>
      <h1>One tweet.<br>One token.</h1>
      <p class="lead">Tag <b>@${h}</b> dengan ticker, dan LONGSHOT langsung launch token kamu di Long.xyz — paired ke saham tokenized Robinhood. Kamu dapat <b>80% creator fee</b>.</p>
      <pre>@${h} launch $ROBO "Robo Tesla" paired $TSLA</pre>
      <div class="grid">
        <div class="stat"><b>${stats.n}</b><small>token live</small></div>
        <div class="stat"><b>${stats.u}</b><small>deployer</small></div>
        <div class="stat"><b>80%</b><small>fee ke deployer</small></div>
      </div>
      <h2>Cara kerja</h2>
      <ol class="steps">
        <li>Tweet <code>@${h} launch $TICKER</code>. Opsional: <code>"Nama Token"</code>, <code>paired $NVDA|AAPL|MSFT|GOOGL|TSLA|MU|SPCX</code>, dan foto sebagai logo.</li>
        <li>LONGSHOT men-deploy token dari wallet <b>LONGSHOT Treasury</b> dan membalas tweet kamu dengan contract address.</li>
        <li>Creator fee di-claim berkala ke Treasury dan dicatat atas nama akun X kamu.</li>
        <li>Buka <a href="/claim">/claim</a>, login X, masukkan wallet — 80% dikirim ke kamu. 20% untuk operasional bot.</li>
      </ol>
      <div class="card"><div class="muted">Alamat LONGSHOT Treasury</div>
        <a class="mono" href="${long.addressUrl(long.treasury)}">${long.treasury}</a></div>
      <h2>Launch terbaru</h2>
      ${recent.length === 0 ? html`<p class="muted">Belum ada token. Jadi yang pertama.</p>` : html`
      <div class="scroll"><table><tr><th>Token</th><th>Paired</th><th>Deployer</th><th>CA</th></tr>
      ${recent.map((r) => html`<tr><td><b>$${r.ticker}</b> <span class="muted">${r.name}</span></td><td>$${r.stock}</td>
        <td><a href="https://x.com/${r.x_username}/status/${r.tweet_id}">@${r.x_username}</a></td>
        <td><a class="mono" href="${tokenUrl(cfg, r.token_address)}">${shortAddr(r.token_address)}</a></td></tr>`)}
      </table></div>`}
    `));
  });

  // ── Token metadata (used when Pinata is not configured) ────────────────────
  app.get("/meta/:file", (c) => {
    const tweetId = c.req.param("file").replace(/\.json$/, "");
    const l = db.prepare("SELECT * FROM launches WHERE tweet_id = ?").get(tweetId) as Parameters<typeof buildMetadata>[0] | undefined;
    if (!l) return c.json({ error: "not found" }, 404);
    return c.json(buildMetadata(l, cfg.publicUrl));
  });

  app.get("/t/:tweetId", (c) => {
    const l = db.prepare("SELECT token_address FROM launches WHERE tweet_id = ? AND status = 'live'").get(c.req.param("tweetId")) as
      | { token_address: string } | undefined;
    return l ? c.redirect(tokenUrl(cfg, l.token_address)) : c.notFound();
  });

  // ── Public transparency ────────────────────────────────────────────────────
  app.get("/fees", async (c) => {
    const report = feeReport(db);
    const payouts = recentPayouts(db);
    const rows = await Promise.all(report.map(async (r) => html`<tr>
      <td><b>$${r.ticker}</b><br><a class="mono muted" href="${long.addressUrl(r.tokenAddress)}">${shortAddr(r.tokenAddress)}</a></td>
      <td>@${r.xUsername}</td>
      <td class="num">${await fmt(r.asset, r.totalFees)}</td>
      <td class="num ok">${await fmt(r.asset, r.deployerShare)}</td>
      <td class="num">${await fmt(r.asset, r.treasuryShare)}</td></tr>`));
    const prow = await Promise.all(payouts.map(async (p) => html`<tr>
      <td>${new Date(p.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
      <td>${p.x_username ? `@${p.x_username}` : "—"}</td>
      <td class="num">${await fmt(p.asset, BigInt(p.amount))}</td>
      <td><a class="mono" href="${long.txUrl(p.tx_hash)}">${shortAddr(p.tx_hash)}</a></td></tr>`));
    return c.html(layout("Transparansi fee · LONGSHOT", html`
      <span class="tag">Transparansi</span>
      <h1>Ke mana fee-nya?</h1>
      <p class="lead">Semua creator fee masuk ke LONGSHOT Treasury, lalu 80% dibayar ke deployer saat claim. Cocokkan setiap angka di bawah dengan explorer.</p>
      <div class="card"><div class="muted">LONGSHOT Treasury</div><a class="mono" href="${long.addressUrl(long.treasury)}">${long.treasury}</a></div>
      <h2>Fee per token</h2>
      ${rows.length === 0 ? html`<p class="muted">Belum ada fee yang di-claim.</p>` : html`
      <div class="scroll"><table><tr><th>Token</th><th>Deployer</th><th class="num">Total fee</th><th class="num">80% deployer</th><th class="num">20% operasional</th></tr>${rows}</table></div>`}
      <h2>Pembayaran ke deployer</h2>
      ${prow.length === 0 ? html`<p class="muted">Belum ada pembayaran.</p>` : html`
      <div class="scroll"><table><tr><th>Waktu (UTC)</th><th>Deployer</th><th class="num">Jumlah</th><th>Tx</th></tr>${prow}</table></div>`}
    `));
  });

  // ── Auth with X (OAuth 2.0 PKCE) ───────────────────────────────────────────
  const callbackUrl = `${cfg.publicUrl}/auth/x/callback`;

  app.get("/auth/x", async (c) => {
    if (!cfg.x.oauthClientId) return c.text("X OAuth belum dikonfigurasi (X_OAUTH_CLIENT_ID).", 503);
    const client = new TwitterApi({ clientId: cfg.x.oauthClientId, clientSecret: cfg.x.oauthClientSecret || undefined });
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(callbackUrl, { scope: ["users.read", "tweet.read"] });
    await setSignedCookie(c, OAUTH, JSON.stringify({ codeVerifier, state }), secret, {
      httpOnly: true, sameSite: "Lax", secure: secureCookie, path: "/auth", maxAge: 600,
    });
    return c.redirect(url);
  });

  app.get("/auth/x/callback", async (c) => {
    const raw_ = await getSignedCookie(c, secret, OAUTH);
    deleteCookie(c, OAUTH, { path: "/auth" });
    const { state, code } = c.req.query();
    if (!raw_ || !state || !code) return c.text("Login gagal, coba lagi.", 400);
    const saved = JSON.parse(raw_) as { codeVerifier: string; state: string };
    if (saved.state !== state) return c.text("State tidak cocok, coba lagi.", 400);
    const client = new TwitterApi({ clientId: cfg.x.oauthClientId, clientSecret: cfg.x.oauthClientSecret || undefined });
    const { client: user } = await client.loginWithOAuth2({ code, codeVerifier: saved.codeVerifier, redirectUri: callbackUrl });
    const { data: me } = await user.v2.me();
    await login(c, { uid: me.id, username: me.username });
    return c.redirect("/claim");
  });

  // Local-only shortcut: pretend to be an X user. Disabled whenever real OAuth or onchain mode is on.
  app.get("/auth/dev", async (c) => {
    if (!devLogin) return c.notFound();
    const { uid, username } = c.req.query();
    if (!uid || !username) return c.text("?uid=&username= wajib", 400);
    await login(c, { uid, username });
    return c.redirect("/claim");
  });

  app.get("/logout", (c) => {
    deleteCookie(c, SESSION, { path: "/" });
    return c.redirect("/");
  });

  // ── Claim ──────────────────────────────────────────────────────────────────
  app.get("/claim", async (c) => {
    const s = await session(c);
    if (!s) {
      return c.html(layout("Claim fee · LONGSHOT", html`
        <span class="tag">Claim</span><h1>Ambil 80% fee kamu</h1>
        <p class="lead">Login dengan akun X yang kamu pakai untuk nge-tag. Fee dicatat berdasarkan ID akun X, jadi aman walau kamu ganti username.</p>
        <p><a class="btn" href="/auth/x">Login dengan X</a></p>
        ${devLogin ? html`<p class="muted">Mode dev: <a href="/auth/dev?uid=1001&username=degen">login sebagai @degen</a></p>` : raw("")}
      `));
    }

    const bals = balances(db, s.uid);
    const tokens = db
      .prepare("SELECT ticker, token_address FROM launches WHERE x_user_id = ? AND status = 'live' ORDER BY created_at DESC")
      .all(s.uid) as { ticker: string; token_address: string }[];
    const rows = await Promise.all(bals.map(async (b) => html`<tr>
      <td>${(await long.assetInfo(b.asset as Address)).symbol}</td>
      <td class="num">${await fmt(b.asset, b.totalFees)}</td>
      <td class="num">${await fmt(b.asset, b.deployerShare)}</td>
      <td class="num">${await fmt(b.asset, b.treasuryShare)}</td>
      <td class="num">${await fmt(b.asset, b.paidOrPending)}</td>
      <td class="num ok"><b>${await fmt(b.asset, b.claimable)}</b></td></tr>`));
    const anyClaimable = bals.some((b) => b.claimable > 0n);
    // Flash lives in a signed cookie (not the URL) so nobody can craft a link with a fake message.
    const flash = await getSignedCookie(c, secret, FLASH);
    if (flash) deleteCookie(c, FLASH, { path: "/claim" });

    return c.html(layout("Claim fee · LONGSHOT", html`
      <div class="row" style="justify-content:space-between"><span class="tag">Claim · @${s.username}</span><a class="muted" href="/logout">Logout</a></div>
      <h1>Fee kamu</h1>
      ${flash ? html`<div class="card">${flash}</div>` : raw("")}
      <p class="muted">Token kamu: ${tokens.length ? tokens.map((t) => html`<a href="${tokenUrl(cfg, t.token_address)}">$${t.ticker}</a> `) : "belum ada"}</p>
      ${rows.length === 0 ? html`<div class="card muted">Belum ada fee yang masuk untuk akun ini. Fee di-claim dari Long.xyz secara berkala.</div>` : html`
      <div class="scroll"><table><tr><th>Aset</th><th class="num">Total fee</th><th class="num">80% kamu</th><th class="num">20% operasional</th><th class="num">Sudah dibayar</th><th class="num">Bisa di-claim</th></tr>${rows}</table></div>`}
      ${anyClaimable ? html`
      <form class="card" method="post" action="/claim">
        <label for="to" class="muted">Wallet penerima (Robinhood Chain / EVM)</label>
        <p><input id="to" type="text" name="to" placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" autocomplete="off"></p>
        <input type="hidden" name="csrf" value="${csrfFor(s.uid)}">
        <button class="btn" type="submit">Claim sekarang</button>
        <p class="muted">Pastikan alamatnya benar — transfer on-chain tidak bisa dibatalkan.</p>
      </form>` : raw("")}
    `));
  });

  app.post("/claim", async (c) => {
    const s = await session(c);
    if (!s) return c.redirect("/claim");
    const form = await c.req.parseBody();
    if (!csrfOk(s.uid, String(form.csrf ?? ""))) return c.text("Sesi tidak valid, muat ulang halaman.", 403);
    const to = String(form.to ?? "").trim();
    if (!isAddress(to) || to.toLowerCase() === zeroAddress) return redirectWithFlash(c, "Alamat wallet tidak valid.");

    const results = await claimAll(db, long, s.uid, getAddress(to), cfg.chain.maxPayoutPerClaim);
    const parts = await Promise.all(results.map(async (r) =>
      r.error ? `${await fmt(r.asset, r.amount)}: ${r.error.slice(0, 160)}` : `✅ ${await fmt(r.asset, r.amount)} terkirim (${r.txHash!.slice(0, 10)}…)`,
    ));
    const msg = parts.length ? parts.join(" · ") : "Tidak ada yang bisa di-claim.";
    return redirectWithFlash(c, msg);
  });

  return app;
}
