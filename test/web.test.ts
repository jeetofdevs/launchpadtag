import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/web/server.ts";
import { setup } from "./helpers.ts";
test("www redirects to canonical domain; apex serves", async () => {
  const d = setup();
  d.cfg.publicUrl = "https://longshotpad.xyz";
  d.cfg.sessionSecret = "x".repeat(32);
  const app = createApp(d.cfg, d.db, d.long);
  const r = await app.request("https://www.longshotpad.xyz/claim?a=1", { headers: { host: "www.longshotpad.xyz" } });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://longshotpad.xyz/claim?a=1");
  const ok = await app.request("https://longshotpad.xyz/healthz", { headers: { host: "longshotpad.xyz" } });
  assert.equal(ok.status, 200);
  const rw = await app.request("http://x/healthz", { headers: { host: "longshot.up.railway.app" } });
  assert.equal(rw.status, 200);
});
