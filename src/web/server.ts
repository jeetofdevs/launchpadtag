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
import { html, layout, raw, type Raw } from "./html.ts";
import { TOKENOMICS, feeSplit, pct } from "../tokenomics.ts";

interface Session {
  uid: string;
  username: string;
}

const SESSION = "ls_session";
const OAUTH = "ls_oauth";
const FLASH = "ls_flash";

export function createApp(cfg: Config, db: DB, long: LongClient, tickersFresh: () => boolean = () => true) {
  const app = new Hono();
  const secret = cfg.sessionSecret;
  const secureCookie = cfg.publicUrl.startsWith("https://");
  const devLogin = cfg.chain.mode === "mock" && !cfg.x.oauthClientId && cfg.allowDevLogin;

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

  const page = (title: string, body: Raw) => layout(title, body, cfg.x.botHandle);

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  // Send www.<domain> to the canonical domain from PUBLIC_URL.
  const canonicalHost = new URL(cfg.publicUrl).host;
  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (host === `www.${canonicalHost}`) {
      const url = new URL(c.req.url);
      return c.redirect(`${cfg.publicUrl}${url.pathname}${url.search}`, 301);
    }
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true, chain: cfg.chain.mode, x: cfg.x.enabled, tickerIndexFresh: tickersFresh() }));

  // ── Landing ────────────────────────────────────────────────────────────────
  app.get("/", (c) => {
    const stats = db
      .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT x_user_id) AS u FROM launches WHERE status = 'live'")
      .get() as { n: number; u: number };
    const recent = db
      .prepare("SELECT tweet_id, ticker, name, stock, x_username, token_address FROM launches WHERE status = 'live' ORDER BY created_at DESC LIMIT 10")
      .all() as { tweet_id: string; ticker: string; name: string; stock: string; x_username: string; token_address: string }[];
    const h = cfg.x.triggerHandle;
    const fee = feeSplit(cfg.chain);
    const shotUrl = `https://x.com/intent/post?text=${encodeURIComponent(`@${h} launch $TICKER "Token Name" paired $NVDA`)}`;
    return c.html(page("LONGSHOT", html`
      <section class="hero">
        <span class="tag">Take a shot on Long</span>
        <h1>One tweet.<br>One token.</h1>
        <p class="lead">Tag <b>@${h}</b> with a ticker and LONGSHOT launches your token on Long.xyz, paired with a real tokenized stock. <b>You earn ${pct(fee.share.deployer)} of every trading fee — forever.</b></p>
        <div class="row"><a class="btn" href="${shotUrl}" target="_blank" rel="noopener">Take your shot on X →</a><a class="btn ghost" href="#tokenomics">Tokenomics</a></div>
        <pre>@${h} launch $ROBO "Robo Tesla" paired $TSLA</pre>
      </section>
      <div class="grid">
        <div class="stat"><b>${stats.n}</b><small>tokens live</small></div>
        <div class="stat"><b>${stats.u}</b><small>deployers</small></div>
        <div class="stat"><b>${pct(fee.share.deployer)}</b><small>of every trading fee to you</small></div>
      </div>

      <h2>How it works</h2>
      <ol class="steps">
        <li><b>Tweet it.</b> <code>@${h} launch $TICKER</code>. Optional: <code>"Token Name"</code>, <code>paired $NVDA|AAPL|MSFT|GOOGL|TSLA|MU|SPCX</code>, and a photo for the logo.</li>
        <li><b>It's live.</b> LONGSHOT deploys your token and replies with the contract address — usually within a minute.</li>
        <li><b>Get paid.</b> Every buy and sell pays a trading fee — ${pct(fee.share.deployer)} of it is yours.</li>
        <li><b>Claim.</b> Open <a href="/claim">/claim</a>, sign in with X, and withdraw to any wallet.</li>
      </ol>

      <h2 id="tokenomics">Tokenomics</h2>
      <p class="muted">Every token launched with LONGSHOT gets the same fair, fixed setup.</p>
      <div class="tk-grid">
        <div class="tk"><b>1B</b><small>${Number(TOKENOMICS.supply).toLocaleString("en-US")} fixed supply — no minting, ever</small></div>
        <div class="tk"><b>${TOKENOMICS.curvePct}%</b><small>fair launch — every token sold on the curve</small></div>
        <div class="tk"><b>${TOKENOMICS.teamPct}%</b><small>team · ${TOKENOMICS.presalePct}% presale · no insiders</small></div>
        <div class="tk"><b>Locked</b><small>liquidity stays in the pool forever</small></div>
        <div class="tk"><b>Stock-paired</b><small>trades against a real Robinhood Stock Token</small></div>
        <div class="tk"><b>${pct(fee.poolFee)}</b><small>fee on every buy &amp; sell</small></div>
      </div>

      <h2>Creator rewards</h2>
      <div class="reward">
        <div class="reward-big"><b>${pct(fee.share.deployer)}</b><span>of every trading fee goes to the person who launched the token.</span></div>
        <div class="split big" role="img" aria-label="Trading fee split: ${pct(fee.share.deployer)} to you, ${pct(fee.share.platform)} to LONGSHOT">
          <span class="seg s1" style="flex:${fee.share.deployer}">YOU ${pct(fee.share.deployer)}</span><span class="seg s2" style="flex:${fee.share.platform}">${pct(fee.share.platform)}</span>
        </div>
        <ul class="legend">
          <li><i class="dot s1"></i><b>${pct(fee.share.deployer)} → you</b>, the deployer</li>
          <li><i class="dot s2"></i><b>${pct(fee.share.platform)} → LONGSHOT</b>, keeps the bot running<sup>*</sup></li>
        </ul>
        <p class="muted">In dollars: every <b>$100</b> traded pays a $${(fee.poolFee).toFixed(2)} fee, and <b>$${(fee.deployer).toFixed(2)}</b> of it is yours. Rewards arrive in both your token and the paired stock.</p>
        <p class="muted small"><sup>*</sup>LONGSHOT's ${pct(fee.share.platform)} includes the ${pct(fee.share.protocol)} Doppler launch-protocol fee. Your ${pct(fee.share.deployer)} is never reduced.</p>
      </div>

      <h3>What could your token earn?</h3>
      <div class="calc" data-rate="${fee.deployer / 100}">
        <label for="vol" class="muted">Daily trading volume</label>
        <div class="chips">
          <button type="button" data-v="1000">$1K</button><button type="button" data-v="10000" class="on">$10K</button><button type="button" data-v="100000">$100K</button><button type="button" data-v="1000000">$1M</button>
        </div>
        <input id="vol" type="range" min="0" max="1000000" step="1000" value="10000" aria-label="Daily trading volume">
        <div class="calc-out">
          <div><small>Volume / day</small><b data-o="vol">$10,000</b></div>
          <div><small>You earn / day</small><b data-o="day" class="ok">$${Math.round(10_000 * fee.deployer / 100)}</b></div>
          <div><small>/ month</small><b data-o="month">$${(Math.round(10_000 * fee.deployer / 100) * 30).toLocaleString("en-US")}</b></div>
          <div><small>/ year</small><b data-o="year">$${(Math.round(10_000 * fee.deployer / 100 * 365)).toLocaleString("en-US")}</b></div>
        </div>
        <p class="muted small">Illustration only — actual earnings depend entirely on trading volume.</p>
      </div>
      <script>
      (() => {
        const c = document.querySelector(".calc"); if (!c) return;
        const rate = Number(c.dataset.rate), r = c.querySelector("#vol");
        const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
        const set = (v) => {
          r.value = v;
          const day = v * rate;
          c.querySelector('[data-o="vol"]').textContent = usd(v);
          c.querySelector('[data-o="day"]').textContent = usd(day);
          c.querySelector('[data-o="month"]').textContent = usd(Math.round(day) * 30);
          c.querySelector('[data-o="year"]').textContent = usd(day * 365);
          c.querySelectorAll(".chips button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === Number(v)));
        };
        r.addEventListener("input", () => set(Number(r.value)));
        c.querySelectorAll(".chips button").forEach((b) => b.addEventListener("click", () => set(Number(b.dataset.v))));
      })();
      </script>

      <div class="card"><div class="muted">LONGSHOT Treasury address</div>
        <a class="mono" href="${long.addressUrl(long.treasury)}">${long.treasury}</a></div>
      <h2>Latest launches</h2>
      ${recent.length === 0 ? html`<p class="muted">No tokens yet. Be the first.</p>` : html`
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
    return c.html(page("Fee transparency · LONGSHOT", html`
      <span class="tag">Transparency</span>
      <h1>Where do the fees go?</h1>
      <p class="lead">Trading fees are collected into the LONGSHOT Treasury, and the deployer's 80% of every fee is paid out on claim. Every number below can be checked on the explorer.</p>
      <div class="card"><div class="muted">LONGSHOT Treasury</div><a class="mono" href="${long.addressUrl(long.treasury)}">${long.treasury}</a></div>
      <h2>Fees per token</h2>
      ${rows.length === 0 ? html`<p class="muted">No fees collected yet.</p>` : html`
      <div class="scroll"><table><tr><th>Token</th><th>Deployer</th><th class="num">Total fee</th><th class="num">Deployer share</th><th class="num">LONGSHOT share</th></tr>${rows}</table></div>`}
      <h2>Payouts to deployers</h2>
      ${prow.length === 0 ? html`<p class="muted">No payouts yet.</p>` : html`
      <div class="scroll"><table><tr><th>Time (UTC)</th><th>Deployer</th><th class="num">Amount</th><th>Tx</th></tr>${prow}</table></div>`}
    `));
  });

  // ── Auth with X (OAuth 2.0 PKCE) ───────────────────────────────────────────
  const callbackUrl = `${cfg.publicUrl}/auth/x/callback`;

  app.get("/auth/x", async (c) => {
    if (!cfg.x.oauthClientId) return c.text("Sign in with X is not configured yet.", 503);
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
    if (!raw_ || !state || !code) return c.text("Sign-in failed, please try again.", 400);
    const saved = JSON.parse(raw_) as { codeVerifier: string; state: string };
    if (saved.state !== state) return c.text("Sign-in session expired, please try again.", 400);
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
      return c.html(page("Claim fee · LONGSHOT", html`
        <span class="tag">Claim</span><h1>Claim your rewards</h1>
        <p class="lead">Sign in with the X account you tagged from. Fees are tracked by X account ID, so they stay yours even if you change your username.</p>
        <p><a class="btn" href="/auth/x">Sign in with X</a></p>
        ${devLogin ? html`<p class="muted">Test mode: <a href="/auth/dev?uid=1001&username=degen">sign in as @degen</a></p>` : raw("")}
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

    return c.html(page("Claim fee · LONGSHOT", html`
      <div class="row" style="justify-content:space-between"><span class="tag">Claim · @${s.username}</span><a class="muted" href="/logout">Sign out</a></div>
      <h1>Your fees</h1>
      ${flash ? html`<div class="card">${flash}</div>` : raw("")}
      <p class="muted">Your tokens: ${tokens.length ? tokens.map((t) => html`<a href="${tokenUrl(cfg, t.token_address)}">$${t.ticker}</a> `) : "none yet"}</p>
      ${rows.length === 0 ? html`<div class="card muted">No fees for this account yet. Fees are collected from the pools regularly.</div>` : html`
      <div class="scroll"><table><tr><th>Asset</th><th class="num">Total fee</th><th class="num">Your share</th><th class="num">LONGSHOT share</th><th class="num">Paid out</th><th class="num">Claimable</th></tr>${rows}</table></div>`}
      ${anyClaimable ? html`
      <form class="card" method="post" action="/claim">
        <label for="to" class="muted">Receiving wallet (Robinhood Chain / EVM)</label>
        <p><input id="to" type="text" name="to" placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" autocomplete="off"></p>
        <input type="hidden" name="csrf" value="${csrfFor(s.uid)}">
        <button class="btn" type="submit">Claim now</button>
        <p class="muted">Double-check the address — on-chain transfers cannot be reversed.</p>
      </form>` : raw("")}
    `));
  });

  app.post("/claim", async (c) => {
    const s = await session(c);
    if (!s) return c.redirect("/claim");
    const form = await c.req.parseBody();
    if (!csrfOk(s.uid, String(form.csrf ?? ""))) return c.text("Session expired, please reload the page.", 403);
    const to = String(form.to ?? "").trim();
    if (!isAddress(to) || to.toLowerCase() === zeroAddress) return redirectWithFlash(c, "That wallet address is not valid.");

    const results = await claimAll(db, long, s.uid, getAddress(to), cfg.chain.maxPayoutPerClaim);
    const parts = await Promise.all(results.map(async (r) =>
      r.error ? `${await fmt(r.asset, r.amount)}: ${r.error.slice(0, 160)}` : `✅ ${await fmt(r.asset, r.amount)} sent (${r.txHash!.slice(0, 10)}…)`,
    ));
    const msg = parts.length ? parts.join(" · ") : "Nothing to claim.";
    return redirectWithFlash(c, msg);
  });

  return app;
}
