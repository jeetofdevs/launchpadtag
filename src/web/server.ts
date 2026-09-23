import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { TwitterApi } from "twitter-api-v2";
import { formatUnits, getAddress, isAddress, zeroAddress, type Address } from "viem";
import { tokenUrl } from "../bot.ts";
import type { LongClient } from "../chain/index.ts";
import { claimAll } from "../claim.ts";
import { BURN_ADDRESS, STOCKS, type Config } from "../config.ts";
import { CATALOG, LONG_MARKET_CATEGORIES, POPULAR_STOCKS, marketLabel, type Stock } from "../stocks.ts";
import type { DB } from "../db.ts";
import { balances, feeReport, recentPayouts, rewardTotals, type RewardTotals } from "../ledger.ts";
import { buildMetadata } from "../metadata.ts";
import { html, layout, raw, type Raw } from "./html.ts";
import { createLogoResolver, letterLogo } from "./logos.ts";
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

  /** Render a page with the signed-in user (if any) shown in the header. */
  const render = async (c: Context, title: string, body: Raw, description?: string) =>
    layout(title, body, { botHandle: cfg.x.botHandle, user: await session(c), description, publicUrl: cfg.publicUrl });

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

  // ── Brand assets (logo, X profile/header, share image) ────────────────────
  const BRAND_FILES = new Set(["longshot-logo.svg", "longshot-mark.svg", "longshot-logo-1000.png", "x-profile-400.png", "x-header-1500x500.png", "og-1200x630.png"]);
  app.get("/brand/:file", async (c) => {
    const file = c.req.param("file");
    if (!BRAND_FILES.has(file)) return c.notFound();
    const body = await readFile(new URL(`../../brand/${file}`, import.meta.url));
    c.header("Content-Type", file.endsWith(".svg") ? "image/svg+xml" : "image/png");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(body);
  });

  // ── Market logos ──────────────────────────────────────────────────────────
  const logoOf = createLogoResolver(cfg.chain.explorerUrl, (sym) => cfg.chain.stockTokens[sym as Stock]);
  /** Bump when a market logo changes so browsers fetch the new one instead of a cached image. */
  const LOGO_VERSION = "2";
  /** Market logos shipped in brand/markets/ (for markets without a public logo). */
  const LOCAL_MARKET_LOGOS: Record<string, string> = { AI: "ai.jpg" };
  app.get("/logo/:sym", async (c) => {
    const sym = c.req.param("sym").replace(/\.(png|svg)$/i, "").toUpperCase();
    if (!CATALOG[sym]) return c.notFound();
    // Logos we ship ourselves (brand/markets/<sym>.jpg|png) win over any looked-up one.
    const own = LOCAL_MARKET_LOGOS[sym];
    if (own && !c.req.query("letter")) {
      c.header("Content-Type", own.endsWith(".png") ? "image/png" : "image/jpeg");
      c.header("Cache-Control", "public, max-age=86400");
      return c.body(await readFile(new URL(`../../brand/markets/${own}`, import.meta.url)));
    }
    const url = c.req.query("letter") ? null : await logoOf(sym);
    // Looked-up logos can change, so browsers only keep them for an hour.
    c.header("Cache-Control", "public, max-age=3600");
    if (url) return c.redirect(url, 302);
    c.header("Content-Type", "image/svg+xml");
    return c.body(letterLogo(sym));
  });

  // Names only (never values) of the bot's X keys that are still empty, so setup problems are visible.
  const X_BOT_KEYS = { X_BEARER_TOKEN: cfg.x.bearerToken, X_APP_KEY: cfg.x.appKey, X_APP_SECRET: cfg.x.appSecret, X_ACCESS_TOKEN: cfg.x.accessToken, X_ACCESS_SECRET: cfg.x.accessSecret };
  const xMissing = Object.entries(X_BOT_KEYS).filter(([, v]) => !v.trim()).map(([k]) => k);
  /** Most recent launch that failed on-chain (ticker, short reason, time), to debug without reading logs. */
  const lastFailed = () => {
    const r = db.prepare("SELECT ticker, reason, created_at FROM launches WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1").get() as
      | { ticker: string; reason: string | null; created_at: number } | undefined;
    return r ? { ticker: r.ticker, error: (r.reason ?? "").replace(/(0x)?[0-9a-fA-F]{64,}/g, "[…]").slice(0, 400), at: new Date(r.created_at).toISOString() } : null;
  };
  app.get("/healthz", (c) => c.json({
    ok: true, chain: cfg.chain.mode, x: cfg.x.enabled, xMissing, listening: cfg.x.enabled ? `@${cfg.x.triggerHandle}` : null,
    xLogin: Boolean(cfg.x.oauthClientId && cfg.x.oauthClientSecret), publicUrl: cfg.publicUrl, tickerIndexFresh: tickersFresh(),
    lastFailedLaunch: lastFailed(),
  }));

  /** "🎁 fees → @receiver" under the creator, shown when the creator sent the fees to another account. */
  const feesTo = (u: string | null) => (u ? html`<div class="small muted nowrap">🎁 fees → <a href="https://x.com/${u}" target="_blank" rel="noopener">@${u}</a></div>` : raw(""));

  /** Small round market logo; falls back to the letter badge if the image can't load. */
  const logo = (sym: string, cls = "slogo") => html`<img class="${cls}" src="/logo/${sym}?v=${LOGO_VERSION}" alt="" loading="lazy" width="22" height="22" onerror="this.onerror=null;this.src='/logo/${sym}?letter=1'">`;

  // ── Landing ────────────────────────────────────────────────────────────────
  app.get("/", async (c) => {
    // Headline rewards are shown in the paired Stock Tokens; rewards in launched tokens are counted separately.
    const stockAssets = new Set(STOCKS.map((st) => long.stockToken(st).toLowerCase()));
    const totals = rewardTotals(db);
    const stockTotals = totals.filter((t) => stockAssets.has(t.asset));
    const tokenAssets = totals.filter((t) => !stockAssets.has(t.asset) && (t.claimed > 0n || t.unclaimed > 0n)).length;
    const amounts = async (pick: (t: RewardTotals) => bigint) => {
      const rows = stockTotals.filter((t) => pick(t) > 0n);
      if (!rows.length) return html`<b>0</b>`;
      return html`${await Promise.all(rows.map(async (t) => html`<b>${await fmt(t.asset, pick(t))}</b>`))}`;
    };
    const claimedHtml = await amounts((t) => t.claimed);
    const burns = totals.filter((t) => !stockAssets.has(t.asset) && t.burned > 0n).sort((a, b) => (b.burned > a.burned ? 1 : -1));
    const burnedHtml = burns.length
      ? html`${await Promise.all(burns.slice(0, 3).map(async (t) => html`<b>${await fmt(t.asset, t.burned)}</b>`))}${burns.length > 3 ? html`<small>+ ${burns.length - 3} more tokens</small>` : raw("")}`
      : html`<b>0</b>`;
    const unclaimedHtml = await amounts((t) => t.unclaimed);
    const stats = db
      .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT x_user_id) AS u FROM launches WHERE status = 'live'")
      .get() as { n: number; u: number };
    const recent = db
      .prepare("SELECT tweet_id, ticker, name, stock, x_username, fee_username, token_address FROM launches WHERE status = 'live' ORDER BY created_at DESC LIMIT 10")
      .all() as { tweet_id: string; ticker: string; name: string; stock: string; x_username: string; fee_username: string | null; token_address: string }[];
    const h = cfg.x.triggerHandle;
    const fee = feeSplit(cfg.chain);
    const shotUrl = `https://x.com/intent/post?text=${encodeURIComponent(`@${h} launch $TICKER "Token Name" paired $NVDA`)}`;
    const stocksCount = STOCKS.length;
    return c.html(await render(c, "LONGSHOT — One tweet. One token.", html`
      <section class="hero2">
        <div>
          <span class="tag">Take a shot on Long</span>
          <h1>One tweet.<br>One token.</h1>
          <p class="lead">Tag <b>@${h}</b> with a ticker and LONGSHOT launches your token on Long.xyz — paired with a real tokenized stock. <b>You earn ${pct(fee.share.deployer)} of every trading fee, forever.</b></p>
          <div class="row"><a class="btn" href="${shotUrl}" target="_blank" rel="noopener">Take your shot on X →</a><a class="btn ghost" href="#how">How it works</a></div>
          <div class="chipline"><span class="chip">No wallet needed to launch</span><span class="chip">Free to launch</span><a class="chip" href="/stocks">${stocksCount} stocks &amp; ETFs to pair</a><span class="chip">Claim &amp; Burn</span></div>
        </div>
        <div aria-label="Example: a launch tweet and LONGSHOT's automatic reply">
          <div class="tweet">
            <div class="tw-head"><span class="av alt">D</span><span class="tw-name">degen.eth<small>@degen · now</small></span></div>
            <div class="tw-body"><span class="m">@${h}</span> launch $ROBO "Robo Tesla" paired $TSLA</div>
          </div>
          <div class="tweet">
            <div class="tw-head"><span class="av">LS</span><span class="tw-name">LONGSHOT<small>@${cfg.x.botHandle} · automated</small></span></div>
            <div class="tw-body">✅ $ROBO "Robo Tesla" is LIVE on Long.xyz
📈 Paired: $TSLA
📜 CA: 0x7b6c…dc9a
💰 <span class="m">@degen</span> earns ${pct(fee.share.deployer)} of every trading fee</div>
          </div>
        </div>
      </section>

      <div class="band">
        <div class="stat"><b>${stats.n}</b><small>tokens launched</small></div>
        <div class="stat"><b>${stats.u}</b><small>deployers</small></div>
        <div class="stat"><b>${pct(fee.share.deployer)}</b><small>of every fee to the creator</small></div>
        <div class="stat"><b>${stocksCount}</b><small>real stocks &amp; ETFs to pair with</small></div>
      </div>

      <section class="section" id="how">
        <h2>How it works</h2>
        <p class="sub">From tweet to live token in about a minute. No website, no wallet, no gas.</p>
        <div class="steps4">
          <div class="step"><b>Tweet it</b><p>Post <code>@${h} launch $TICKER</code>. Add <code>"Name"</code>, <code>paired $TSLA</code> (any of <a href="/stocks">${stocksCount} stocks</a>) and a photo for the logo if you like.</p></div>
          <div class="step"><b>We launch it</b><p>LONGSHOT checks the ticker is free, deploys your token on Long.xyz and pays the gas.</p></div>
          <div class="step"><b>Auto reply</b><p><b>@${cfg.x.botHandle}</b> replies under your tweet with the contract address and trade link.</p></div>
          <div class="step"><b>Get paid</b><p>Every buy and sell pays you ${pct(fee.share.deployer)} of the fee. Sign in with X to claim — or claim &amp; burn.</p></div>
        </div>
      </section>

      <section class="section">
        <h2>Why LONGSHOT</h2>
        <p class="sub">Built for creators who move fast — and for holders who want a fair start.</p>
        <div class="features">
          <div class="feat"><i>📈</i><b>Stock-paired</b><p>Pair with any of ${stocksCount} Robinhood Stock Tokens on Long.xyz — ${POPULAR_STOCKS.slice(0, 6).map((s) => `$${s}`).join(", ")} and <a href="/stocks">many more</a>.</p></div>
          <div class="feat"><i>⚖️</i><b>100% fair launch</b><p>1B fixed supply, all on the curve. No team allocation, no presale, no insiders.</p></div>
          <div class="feat"><i>💰</i><b>${pct(fee.share.deployer)} creator rewards</b><p>The person who tweets earns most of every trading fee — forever, claimable any time.</p></div>
          <div class="feat"><i>🔥</i><b>Claim &amp; Burn</b><p>Burn the rewards paid in your own token to shrink supply — recorded on-chain and on our Transparency page.</p></div>
          <div class="feat"><i>🛡️</i><b>No copycat tickers</b><p>Tickers already used on Long.xyz, and every Robinhood stock symbol, are reserved automatically.</p></div>
          <div class="feat"><i>🔍</i><b>Open treasury</b><p>Every fee collected and every payout is listed with its transaction — check it yourself.</p></div>
        </div>
      </section>

      <section class="section" id="tokenomics">
        <h2>Tokenomics</h2>
        <p class="sub">Every token launched with LONGSHOT gets the same fair, fixed setup.</p>
        <div class="tk-grid">
          <div class="tk"><b>1B</b><small>${Number(TOKENOMICS.supply).toLocaleString("en-US")} fixed supply — no minting, ever</small></div>
          <div class="tk"><b>${TOKENOMICS.curvePct}%</b><small>fair launch — every token sold on the curve</small></div>
          <div class="tk"><b>${TOKENOMICS.teamPct}%</b><small>team · ${TOKENOMICS.presalePct}% presale · no insiders</small></div>
          <div class="tk"><b>Locked</b><small>liquidity stays in the pool forever</small></div>
          <div class="tk"><b>Stock-paired</b><small>trades against a real Robinhood Stock Token</small></div>
          <div class="tk"><b>${pct(fee.poolFee)}</b><small>fee on every buy &amp; sell</small></div>
        </div>

        <h3>Creator rewards</h3>
        <div class="reward">
          <div class="reward-big"><b>${pct(fee.share.deployer)}</b><span>of every trading fee goes to the person who launched the token.</span></div>
          <div class="split big" role="img" aria-label="Trading fee split: ${pct(fee.share.deployer)} to you, ${pct(fee.share.platform)} to LONGSHOT">
            <span class="seg s1" style="flex:${fee.share.deployer}">YOU ${pct(fee.share.deployer)}</span><span class="seg s2" style="flex:${fee.share.platform}">${pct(fee.share.platform)}</span>
          </div>
          <ul class="legend">
            <li><i class="dot s1"></i><b>${pct(fee.share.deployer)} → you</b>, the deployer</li>
            <li><i class="dot s2"></i><b>${pct(fee.share.platform)} → LONGSHOT</b>, keeps the bot running<sup>*</sup></li>
          </ul>
          <p class="muted">Rewards arrive in both your token and the paired stock.</p>
          <p class="muted small"><sup>*</sup>LONGSHOT's ${pct(fee.share.platform)} includes the ${pct(fee.share.protocol)} Doppler launch-protocol fee. Your ${pct(fee.share.deployer)} is never reduced.</p>
        </div>

        <h3>Rewards so far</h3>
        <div class="rewards-now">
          <div class="rn"><small>Claimed by deployers</small>${claimedHtml}</div>
          <div class="rn"><small>Unclaimed — ready to withdraw</small>${unclaimedHtml}</div>
          <div class="rn burn"><small>🔥 Burned by deployers</small>${burnedHtml}</div>
        </div>
        ${tokenAssets > 0 ? html`<p class="muted small">Plus rewards paid in ${tokenAssets} launched token${tokenAssets === 1 ? "" : "s"}. Full breakdown on <a href="/fees">Transparency</a>.</p>` : html`<p class="muted small">Live totals across every LONGSHOT token. Full breakdown on <a href="/fees">Transparency</a>.</p>`}
      </section>

      <section class="section">
        <h2>Latest launches <a class="more" href="/launches">View all →</a></h2>
        ${recent.length === 0 ? html`<p class="muted">No tokens yet. Be the first — <a href="${shotUrl}" target="_blank" rel="noopener">take your shot</a>.</p>` : html`
        <div class="scroll"><table><tr><th>Token</th><th>Paired</th><th>Deployer</th><th>CA</th></tr>
        ${recent.map((r) => html`<tr><td><a href="/t/${r.tweet_id}"><b>$${r.ticker}</b></a> <span class="muted">${r.name}</span></td><td class="nowrap">${logo(r.stock)}$${marketLabel(r.stock)}</td>
          <td><a href="https://x.com/${r.x_username}/status/${r.tweet_id}" target="_blank" rel="noopener">@${r.x_username}</a>${feesTo(r.fee_username)}</td>
          <td><a class="mono" href="${tokenUrl(cfg, r.token_address)}" target="_blank" rel="noopener">${shortAddr(r.token_address)}</a></td></tr>`)}
        </table></div>`}
      </section>

      <section class="section">
        <h2>Roadmap</h2>
        <p class="sub">What's shipped and what's next.</p>
        <div class="road">
          <div class="phase"><span class="st live">Live</span><b>Phase 1 — Launch by tag</b><ul><li>Launch from a tweet</li><li>Automatic reply with CA</li><li>80% creator rewards &amp; claim</li><li>Claim &amp; Burn</li><li>Reserved tickers &amp; open treasury</li></ul></div>
          <div class="phase"><span class="st">Next</span><b>Phase 2 — Discovery</b><ul><li>Creator leaderboard</li><li>Token pages with charts</li><li>Launch alerts on X</li><li>Referral rewards</li></ul></div>
          <div class="phase"><span class="st">Later</span><b>Phase 3 — Everywhere</b><ul><li>Launch from Farcaster &amp; Telegram</li><li>Buy &amp; info commands by tag</li><li>On-chain fee splitter</li></ul></div>
        </div>
      </section>

      <section class="section faq" id="faq">
        <h2>FAQ</h2>
        <details><summary>What is LONGSHOT?</summary><p>A bot that launches tokens on Long.xyz for you. Tweet <code>@${h} launch $TICKER</code> and LONGSHOT deploys the token, replies with the contract address, and pays you ${pct(fee.share.deployer)} of every trading fee.</p></details>
        <details><summary>Is LONGSHOT part of Long.xyz?</summary><p>No. LONGSHOT is an independent project built on the same launch infrastructure. The only official LONGSHOT account is <a href="https://x.com/${cfg.x.botHandle}" target="_blank" rel="noopener">@${cfg.x.botHandle}</a>.</p></details>
        <details><summary>What does it cost to launch?</summary><p>Nothing. LONGSHOT pays the gas. It's funded by its ${pct(fee.share.platform)} share of trading fees.</p></details>
        <details><summary>Who can launch?</summary><p>Any X account at least ${cfg.rules.minAccountAgeDays} days old with ${cfg.rules.minFollowers}+ followers. Each account can launch ${cfg.rules.launchesPerDay} token per 24 hours.</p></details>
        <details><summary>Why did the bot say my ticker is reserved?</summary><p>That ticker was ${cfg.rules.tickerCooldownHours > 0 ? `launched on Long.xyz (or via LONGSHOT) in the last ${Math.round(cfg.rules.tickerCooldownHours / 24)} days` : "already launched on Long.xyz (or via LONGSHOT)"}, or it's a real Robinhood stock symbol. Pick another ticker, or try again once the ticker is free.</p></details>
        <details><summary>How do I claim my rewards?</summary><p>Open <a href="/claim">Claim</a>, sign in with the X account you tweeted from, enter any EVM wallet and press <b>Claim fees</b> — or <b>Claim &amp; burn supply</b> to burn the rewards paid in your own token. Rewards are tracked by your X account ID, so renaming your account is safe.</p></details>
        ${cfg.rules.sendFeesEnabled
          ? html`<details><summary>Can I send the fees to someone else?</summary><p>Yes. Add <code>fees @username</code> to your tweet, e.g. <code>@${h} launch $GIFT "Gift" paired $NVDA fees @friend</code>. That account receives the ${pct(fee.share.deployer)} creator share and claims it here with its own X login. You still count as the creator, and the choice is permanent for that token.</p></details>`
          : html`<details><summary>Can I send the fees to someone else?</summary><p><b>Coming soon.</b> You'll be able to add <code>fees @username</code> to your launch tweet so another X account receives the ${pct(fee.share.deployer)} creator share.</p></details>`}
        <details><summary>What is Claim &amp; burn supply?</summary><p>One of the two claim buttons. Your stock rewards go to your wallet, while the rewards paid in your own token are sent to the burn address and destroyed forever — shrinking your token's supply.</p></details>
        <details><summary>How do I know the fees are paid fairly?</summary><p>The <a href="/fees">Transparency</a> page lists every fee collected per token and every payout or burn with its on-chain transaction. The Treasury address is <a class="mono" href="${long.addressUrl(long.treasury)}" target="_blank" rel="noopener">${shortAddr(long.treasury)}</a>.</p></details>
        <details><summary>Will LONGSHOT ever DM me?</summary><p>Never. We don't DM first and will never ask for your seed phrase or private key. Anyone who does is a scammer.</p></details>
      </section>

      <section class="cta">
        <h2>Take your shot.</h2>
        <p>One tweet is all it takes.</p>
        <div class="row"><a class="btn" href="${shotUrl}" target="_blank" rel="noopener">Launch on X →</a><a class="btn ghost" href="/claim">Claim rewards</a></div>
      </section>
    `));
  });

  // ── Supported stocks ──────────────────────────────────────────────────────
  app.get("/stocks", async (c) => {
    const q = (c.req.query("q") ?? "").replace(/^\$/, "").trim().toUpperCase().slice(0, 40);
    const all = STOCKS.map((s) => ({ symbol: s, name: CATALOG[s].name, address: cfg.chain.stockTokens[s] })); // real Robinhood Chain addresses, even in test mode
    const rows = q ? all.filter((r) => r.symbol.startsWith(q) || r.name.toUpperCase().includes(q)) : all;
    type Row = (typeof all)[number];
    // Group like app.long.xyz; symbols added via PAIR_MARKETS that aren't in a category go under "More".
    const groups = (list: Row[]) => {
      const bySym = new Map(list.map((r) => [r.symbol, r]));
      const out = LONG_MARKET_CATEGORIES.map((c) => ({ name: c.name, description: c.description, rows: c.symbols.filter((x) => bySym.has(x)).map((x) => bySym.get(x)!) }));
      const placed = new Set(LONG_MARKET_CATEGORIES.flatMap((c) => c.symbols as Stock[]));
      out.push({ name: "More", description: "", rows: list.filter((r) => !placed.has(r.symbol)) });
      return out.filter((g) => g.rows.length);
    };
    const example = (s: string) => `https://x.com/intent/post?text=${encodeURIComponent(`@${cfg.x.triggerHandle} launch $TICKER "Token Name" paired $${s}`)}`;
    return c.html(await render(c, "Stocks you can pair with · LONGSHOT", html`
      <span class="tag">${STOCKS.length} stocks &amp; ETFs</span>
      <h1>Pick your pair</h1>
      <p class="lead">Every Robinhood Stock Token used on Long.xyz. Add <code>paired $SYMBOL</code> to your tweet — no pair means $${cfg.chain.defaultStock}.</p>
      <div class="chipline">${POPULAR_STOCKS.map((s) => html`<a class="chip" href="${example(s)}" target="_blank" rel="noopener">${logo(s)}$${marketLabel(s)}</a>`)}</div>
      <form class="search" method="get" action="/stocks"><input type="search" name="q" value="${q}" placeholder="Search symbol or company" aria-label="Search stocks"><button class="btn" type="submit">Search</button></form>
      ${rows.length === 0 ? html`<p class="muted">No matches.</p>` : groups(rows).map((g) => html`
      <h3>${g.name} <span class="muted small">· ${g.rows.length} market${g.rows.length === 1 ? "" : "s"}</span></h3>
      ${g.description ? html`<p class="muted small" style="margin-top:-6px">${g.description}</p>` : raw("")}
      <div class="scroll"><table><tr><th>Symbol</th><th>Name</th><th>Token</th><th></th></tr>
      ${g.rows.map((r) => html`<tr><td class="nowrap">${logo(r.symbol)}<b>$${marketLabel(r.symbol)}</b></td><td>${r.name}</td>
        <td><a class="mono" href="${cfg.chain.explorerUrl}/address/${r.address}" target="_blank" rel="noopener">${shortAddr(r.address)}</a></td>
        <td><a class="btn sm ghost nowrap" href="${example(marketLabel(r.symbol))}" target="_blank" rel="noopener">Launch →</a></td></tr>`)}
      </table></div>`)}
    `, `Launch a token paired with any of ${STOCKS.length} Robinhood Stock Tokens on Long.xyz.`));
  });

  // ── Sign in ───────────────────────────────────────────────────────────────
  app.get("/login", (c) => c.redirect(cfg.x.oauthClientId ? "/auth/x" : "/claim"));

  // ── All launches ──────────────────────────────────────────────────────────
  app.get("/launches", async (c) => {
    const q = (c.req.query("q") ?? "").replace(/^\$/, "").trim().toUpperCase().slice(0, 10);
    const rows = (q
      ? db.prepare("SELECT tweet_id, ticker, name, stock, x_username, fee_username, token_address, created_at FROM launches WHERE status = 'live' AND (ticker LIKE ? OR UPPER(x_username) LIKE ?) ORDER BY created_at DESC LIMIT 200").all(`${q}%`, `${q}%`)
      : db.prepare("SELECT tweet_id, ticker, name, stock, x_username, fee_username, token_address, created_at FROM launches WHERE status = 'live' ORDER BY created_at DESC LIMIT 200").all()
    ) as { tweet_id: string; ticker: string; name: string; stock: string; x_username: string; fee_username: string | null; token_address: string; created_at: number }[];
    return c.html(await render(c, "Launches · LONGSHOT", html`
      <span class="tag">Launches</span>
      <h1>Every LONGSHOT token</h1>
      <form class="search" method="get" action="/launches"><input type="search" name="q" value="${q}" placeholder="Search ticker or @creator" aria-label="Search"><button class="btn" type="submit">Search</button></form>
      ${rows.length === 0 ? html`<p class="muted">${q ? "No matches." : "No tokens yet."}</p>` : html`
      <div class="scroll"><table><tr><th>Token</th><th>Paired</th><th>Creator</th><th>Launched</th><th>CA</th></tr>
      ${rows.map((r) => html`<tr><td><a href="/t/${r.tweet_id}"><b>$${r.ticker}</b></a> <span class="muted">${r.name}</span></td><td class="nowrap">${logo(r.stock)}$${marketLabel(r.stock)}</td>
        <td><a href="https://x.com/${r.x_username}" target="_blank" rel="noopener">@${r.x_username}</a>${feesTo(r.fee_username)}</td>
        <td class="nowrap">${new Date(r.created_at).toISOString().slice(0, 10)}</td>
        <td><a class="mono" href="${tokenUrl(cfg, r.token_address)}" target="_blank" rel="noopener">${shortAddr(r.token_address)}</a></td></tr>`)}
      </table></div>`}
    `, "Every token launched with LONGSHOT on Long.xyz."));
  });

  // ── Token metadata (used when Pinata is not configured) ────────────────────
  app.get("/meta/:file", (c) => {
    const tweetId = c.req.param("file").replace(/\.json$/, "");
    const l = db.prepare("SELECT * FROM launches WHERE tweet_id = ?").get(tweetId) as Parameters<typeof buildMetadata>[0] | undefined;
    if (!l) return c.json({ error: "not found" }, 404);
    return c.json(buildMetadata(l, cfg.publicUrl));
  });

  app.get("/t/:tweetId", async (c) => {
    const l = db.prepare("SELECT * FROM launches WHERE tweet_id = ? AND status = 'live'").get(c.req.param("tweetId")) as
      | { tweet_id: string; ticker: string; name: string; stock: string; x_username: string; fee_username: string | null; token_address: string; tx_hash: string; created_at: number; image_url: string | null }
      | undefined;
    if (!l) return c.notFound();
    const fees = feeReport(db).filter((r) => r.tokenAddress.toLowerCase() === l.token_address.toLowerCase());
    const burned = rewardTotals(db).find((t) => t.asset === l.token_address.toLowerCase())?.burned ?? 0n;
    const feeRows = await Promise.all(fees.map(async (r) => html`<tr><td>${(await long.assetInfo(r.asset as Address)).symbol}</td>
      <td class="num">${await fmt(r.asset, r.totalFees)}</td><td class="num ok">${await fmt(r.asset, r.deployerShare)}</td></tr>`));
    return c.html(await render(c, `$${l.ticker} · ${l.name} · LONGSHOT`, html`
      <div class="tokhead">
        ${l.image_url?.startsWith("https://") ? html`<img class="av" src="${l.image_url}" alt="" style="object-fit:cover">` : html`<span class="av">${l.ticker.slice(0, 2)}</span>`}
        <div><span class="tag">Paired with ${logo(l.stock)}$${marketLabel(l.stock)}</span><h1 style="margin:4px 0 0">$${l.ticker}</h1><div class="muted">${l.name}</div>${l.fee_username ? html`<div class="feesto">🎁 Creator fees go to <a href="https://x.com/${l.fee_username}" target="_blank" rel="noopener">@${l.fee_username}</a></div>` : raw("")}</div>
      </div>
      <div class="row" style="margin-top:18px"><a class="btn" href="${tokenUrl(cfg, l.token_address)}" target="_blank" rel="noopener">Trade on Long.xyz →</a><a class="btn ghost" href="https://x.com/${l.x_username}/status/${l.tweet_id}" target="_blank" rel="noopener">Launch tweet</a></div>
      <div class="kv">
        <div><small>Creator</small><a href="https://x.com/${l.x_username}" target="_blank" rel="noopener">@${l.x_username}</a></div>
        ${l.fee_username ? html`<div><small>🎁 Fees go to</small><a href="https://x.com/${l.fee_username}" target="_blank" rel="noopener">@${l.fee_username}</a></div>` : raw("")}
        <div><small>Launched</small>${new Date(l.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</div>
        <div><small>Supply</small>1,000,000,000</div>
        <div><small>Contract</small><a class="mono" href="${long.addressUrl(l.token_address)}" target="_blank" rel="noopener">${shortAddr(l.token_address)}</a></div>
        <div><small>Launch tx</small><a class="mono" href="${long.txUrl(l.tx_hash)}" target="_blank" rel="noopener">${shortAddr(l.tx_hash)}</a></div>
        <div><small>🔥 Burned by creator</small>${burned > 0n ? await fmt(l.token_address, burned) : "0"}</div>
      </div>
      <h3>Creator rewards</h3>
      ${feeRows.length ? html`<div class="scroll"><table><tr><th>Asset</th><th class="num">Fees collected</th><th class="num">Creator's share</th></tr>${feeRows}</table></div>` : html`<p class="muted">No fees collected yet — fees are collected from the pool regularly.</p>`}
    `, `$${l.ticker} (${l.name}) — launched by @${l.x_username} with LONGSHOT, paired with $${marketLabel(l.stock)}.`));
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
      <td>${p.x_username ? `@${p.x_username}` : "—"}${p.to_address.toLowerCase() === BURN_ADDRESS.toLowerCase() ? html` <span class="burn-tag">🔥 burned</span>` : raw("")}</td>
      <td class="num">${await fmt(p.asset, BigInt(p.amount))}</td>
      <td><a class="mono" href="${long.txUrl(p.tx_hash)}">${shortAddr(p.tx_hash)}</a></td></tr>`));
    return c.html(await render(c, "Fee transparency · LONGSHOT", html`
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
      return c.html(await render(c, "Claim fee · LONGSHOT", html`
        <span class="tag">Claim</span><h1>Claim your rewards</h1>
        <p class="lead">Sign in with the X account you tagged from. Fees are tracked by X account ID, so they stay yours even if you change your username.</p>
        <p><a class="btn" href="/auth/x">Sign in with X</a></p>
        ${devLogin ? html`<p class="muted">Test mode: <a href="/auth/dev?uid=1001&username=degen">sign in as @degen</a></p>` : raw("")}
      `));
    }

    const bals = balances(db, s.uid);
    const tokens = db
      .prepare("SELECT ticker, token_address FROM launches WHERE COALESCE(fee_user_id, x_user_id) = ? AND status = 'live' ORDER BY created_at DESC")
      .all(s.uid) as { ticker: string; token_address: string }[]; // tokens whose creator fees go to this account
    const sentAway = db
      .prepare("SELECT ticker, fee_username FROM launches WHERE x_user_id = ? AND fee_user_id IS NOT NULL AND fee_user_id != x_user_id AND status = 'live' ORDER BY created_at DESC")
      .all(s.uid) as { ticker: string; fee_username: string }[];
    const rows = await Promise.all(bals.map(async (b) => html`<tr>
      <td>${(await long.assetInfo(b.asset as Address)).symbol}</td>
      <td class="num">${await fmt(b.asset, b.totalFees)}</td>
      <td class="num">${await fmt(b.asset, b.deployerShare)}</td>
      <td class="num">${await fmt(b.asset, b.treasuryShare)}</td>
      <td class="num">${await fmt(b.asset, b.paidOrPending)}</td>
      <td class="num ok"><b>${await fmt(b.asset, b.claimable)}</b></td></tr>`));
    const anyClaimable = bals.some((b) => b.claimable > 0n);
    const ownTokens = new Set(tokens.map((t) => t.token_address.toLowerCase()));
    const burnable = bals.filter((b) => b.claimable > 0n && ownTokens.has(b.asset));
    const burnList = await Promise.all(burnable.map((b) => fmt(b.asset, b.claimable)));
    // Flash lives in a signed cookie (not the URL) so nobody can craft a link with a fake message.
    const flash = await getSignedCookie(c, secret, FLASH);
    if (flash) deleteCookie(c, FLASH, { path: "/claim" });

    return c.html(await render(c, "Claim fee · LONGSHOT", html`
      <div class="row" style="justify-content:space-between"><span class="tag">Claim · @${s.username}</span><a class="muted" href="/logout">Sign out</a></div>
      <h1>Your fees</h1>
      ${flash ? html`<div class="card">${flash}</div>` : raw("")}
      <p class="muted">Tokens earning for you: ${tokens.length ? tokens.map((t) => html`<a href="${tokenUrl(cfg, t.token_address)}">$${t.ticker}</a> `) : "none yet"}</p>
      ${sentAway.length ? html`<p class="muted small">🎁 Fees you sent away: ${sentAway.map((t) => html`$${t.ticker} → @${t.fee_username} `)}</p>` : raw("")}
      ${rows.length === 0 ? html`<div class="card muted">No fees for this account yet. Fees are collected from the pools regularly.</div>` : html`
      <div class="scroll"><table><tr><th>Asset</th><th class="num">Total fee</th><th class="num">Your share</th><th class="num">LONGSHOT share</th><th class="num">Paid out</th><th class="num">Claimable</th></tr>${rows}</table></div>`}
      <form method="post" action="/claim" class="claim-form">
        <div class="card">
          <label for="to" class="muted">Receiving wallet (Robinhood Chain / EVM)</label>
          <p><input id="to" type="text" name="to" placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" autocomplete="off" ${anyClaimable ? "" : raw("disabled")}></p>
          <input type="hidden" name="csrf" value="${csrfFor(s.uid)}">
          <p class="muted small">Double-check the address — on-chain transfers cannot be reversed.</p>
        </div>
        <div class="claim-options">
          <div class="opt">
            <b>Claim fees</b>
            <p>Send all your rewards — the paired stock and your own token — to your wallet.</p>
            <button class="btn" type="submit" name="mode" value="claim" ${anyClaimable ? "" : raw("disabled")}>Claim fees</button>
          </div>
          <div class="opt burn">
            <b>Claim &amp; burn supply 🔥</b>
            <p>Your stock rewards go to your wallet. Your rewards paid in your own token${burnable.length ? html` (${burnList.join(", ")})` : raw("")} are burned forever at <span class="mono nowrap">${shortAddr(BURN_ADDRESS)}</span>, shrinking your token's supply. Cannot be undone.</p>
            <button class="btn burn-btn" type="submit" name="mode" value="burn" ${burnable.length ? "" : raw("disabled")}>Claim &amp; burn supply</button>
            ${burnable.length ? raw("") : html`<p class="muted small">Nothing to burn yet — appears once your token earns fees in its own token.</p>`}
          </div>
        </div>
        ${anyClaimable ? raw("") : html`<p class="muted">Nothing to claim yet. Fees are collected from the pools regularly.</p>`}
      </form>
    `));
  });

  app.post("/claim", async (c) => {
    const s = await session(c);
    if (!s) return c.redirect("/claim");
    const form = await c.req.parseBody();
    if (!csrfOk(s.uid, String(form.csrf ?? ""))) return c.text("Session expired, please reload the page.", 403);
    const to = String(form.to ?? "").trim();
    if (!isAddress(to) || to.toLowerCase() === zeroAddress) return redirectWithFlash(c, "That wallet address is not valid.");
    // Paying to the Treasury itself or the burn address would mark the rewards as paid while the user gets nothing.
    if (to.toLowerCase() === long.treasury.toLowerCase() || to.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
      return redirectWithFlash(c, "Enter your own wallet address. To burn, use the Claim & burn supply button.");
    }

    const burn = String(form.mode ?? "") === "burn";
    const results = await claimAll(db, long, s.uid, getAddress(to), cfg.chain.maxPayoutPerClaim, { burn });
    const parts = await Promise.all(results.map(async (r) =>
      r.error
        ? `${await fmt(r.asset, r.amount)}: ${r.error.slice(0, 160)}`
        : r.burned
          ? `🔥 ${await fmt(r.asset, r.amount)} burned (${r.txHash!.slice(0, 10)}…)`
          : `✅ ${await fmt(r.asset, r.amount)} sent (${r.txHash!.slice(0, 10)}…)`,
    ));
    const msg = parts.length ? parts.join(" · ") : "Nothing to claim.";
    return redirectWithFlash(c, msg);
  });

  return app;
}
