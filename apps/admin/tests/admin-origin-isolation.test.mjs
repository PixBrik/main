import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const buyerVercelConfig = JSON.parse(
  await readFile(new URL("../../mobile/vercel.json", import.meta.url), "utf8")
);
const adminNextConfig = await readFile(
  new URL("../next.config.ts", import.meta.url),
  "utf8"
);

test("the public backoffice entry redirects to an isolated admin origin", () => {
  const backofficeRedirects = buyerVercelConfig.redirects.filter(
    (rule) => rule.source === "/backoffice" || rule.source === "/backoffice/:path*"
  );

  assert.equal(backofficeRedirects.length, 2);
  for (const rule of backofficeRedirects) {
    assert.match(rule.destination, /^https:\/\/pixbrik-backoffice\.vercel\.app\/backoffice/);
    assert.equal(rule.permanent, false);
  }
  assert.equal(
    buyerVercelConfig.rewrites.some(
      (rule) => rule.source === "/backoffice" || rule.source === "/backoffice/:path*"
    ),
    false
  );
});

test("admin Server Actions do not trust the buyer-site origin", () => {
  assert.doesNotMatch(adminNextConfig, /allowedOrigins/);
  assert.doesNotMatch(adminNextConfig, /www\.pixbrik\.com/);
});
