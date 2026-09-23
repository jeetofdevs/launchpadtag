export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Tagged template that escapes interpolations unless they are `raw()`. */
export class Raw {
  constructor(readonly html: string) {}
  toString() {
    return this.html;
  }
}
export const raw = (s: string) => new Raw(s);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.html : esc(x))).join("") : v instanceof Raw ? v.html : esc(v);
    out += part + strings[i + 1];
  });
  return raw(out);
}

const CSS = `
:root{--bg:#0b0d0c;--panel:#141816;--line:#232a26;--text:#e9f1ec;--muted:#8a978f;--accent:#35f28a;--accent-ink:#04200f;--danger:#ff6b6b;--warn:#ffc857}
@media (prefers-color-scheme: light){:root{--bg:#f6f8f7;--panel:#ffffff;--line:#dfe6e2;--text:#0e1511;--muted:#5d6b63;--accent:#0fae57;--accent-ink:#ffffff;--danger:#c62828;--warn:#9a6700}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:60px}
.logo{font-weight:800;letter-spacing:.08em;color:var(--text);text-decoration:none}
.logo span{color:var(--accent)}
nav a{color:var(--muted);text-decoration:none;margin-left:16px;font-size:14px}
nav a:hover{color:var(--text)}
main{padding:32px 0 64px}
h1{font-size:clamp(32px,6vw,52px);line-height:1.05;margin:8px 0 12px;letter-spacing:-.02em}
h2{font-size:20px;margin:32px 0 12px}
.lead{color:var(--muted);font-size:18px;max-width:620px}
.tag{display:inline-block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto;font-size:14px;white-space:pre-wrap;word-break:break-word}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.stat b{display:block;font-size:26px}
.stat small{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
input[type=text]{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;font-family:ui-monospace,monospace;font-size:14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.muted{color:var(--muted)}
.ok{color:var(--accent)}.err{color:var(--danger)}.warn{color:var(--warn)}
.mono{font-family:ui-monospace,monospace;word-break:break-all}
ol.steps{padding-left:20px}ol.steps li{margin:8px 0}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px;padding:20px 0}
`;

export function layout(title: string, body: Raw): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<header><div class="wrap"><a class="logo" href="/">LONG<span>SHOT</span></a>
<nav><a href="/fees">Transparency</a><a href="/claim">Claim</a></nav></div></header>
<main><div class="wrap">${body.html}</div></main>
<footer><div class="wrap">LONGSHOT is an independent bot that launches tokens on Long.xyz on behalf of the person who tags it. Deployers receive 80% of creator fees; 20% covers bot operations. LONGSHOT never DMs first and will never ask for your seed phrase.</div></footer>
</body></html>`;
}
