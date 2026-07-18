import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AffiliateInputError,
  normalizeNewAffiliateCode,
  normalizeNewAffiliatePartner,
  parseCommissionPercent
} from "../src/lib/affiliates-validation.ts";

const page = await readFile(
  new URL("../src/app/(admin)/affiliates/page.tsx", import.meta.url),
  "utf8"
);
const actions = await readFile(
  new URL("../src/app/(admin)/affiliates/actions.ts", import.meta.url),
  "utf8"
);
const data = await readFile(new URL("../src/lib/affiliates.ts", import.meta.url), "utf8");
const ui = await readFile(
  new URL("../src/components/affiliates/affiliate-management.tsx", import.meta.url),
  "utf8"
);

test("affiliate inputs normalize exact basis points and local-only destinations", () => {
  assert.equal(parseCommissionPercent("10"), 1_000);
  assert.equal(parseCommissionPercent("10.25"), 1_025);
  assert.equal(parseCommissionPercent("", true), null);
  assert.throws(() => parseCommissionPercent("100.01"), AffiliateInputError);
  assert.throws(() => parseCommissionPercent("1.234"), AffiliateInputError);

  assert.deepEqual(
    normalizeNewAffiliatePartner({
      publicName: "  Studio   Brik ",
      contactEmail: " PARTNER@EXAMPLE.COM ",
      commissionPercent: "12.5",
      payoutCurrency: "eur",
      termsVersion: "affiliate-v1"
    }),
    {
      publicName: "Studio Brik",
      contactEmail: "partner@example.com",
      commissionBasisPoints: 1_250,
      payoutCurrency: "EUR",
      termsVersion: "affiliate-v1"
    }
  );

  const code = normalizeNewAffiliateCode({
    partnerId: "123e4567-e89b-42d3-a456-426614174000",
    code: " creator_10 ",
    destinationPath: "/shop",
    commissionPercent: ""
  });
  assert.equal(code.code, "CREATOR_10");
  assert.equal(code.destinationPath, "/shop");
  assert.equal(code.commissionBasisPoints, null);
  assert.throws(
    () => normalizeNewAffiliateCode({ ...code, destinationPath: "https://example.com" }),
    AffiliateInputError
  );
  assert.throws(
    () => normalizeNewAffiliateCode({ ...code, destinationPath: "//example.com/path" }),
    AffiliateInputError
  );
});

test("the dedicated affiliate route separates read and manage authorization", () => {
  assert.match(page, /requirePermission\("affiliates\.read"\)/);
  assert.match(page, /hasPermission\(principal, "affiliates\.manage"\)/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.equal((actions.match(/requirePermission\("affiliates\.manage"\)/g) ?? []).length, 4);
  assert.equal((actions.match(/requireTrustedMutation\(\)/g) ?? []).length, 4);
  assert.match(actions, /revalidatePath\(adminSectionRoute\("affiliates"\)\)/);
});

test("affiliate mutations are locked, stale-safe and audited", () => {
  assert.match(data, /withDatabaseRequestContext\("admin", \{ userId: actor\.userId \}/);
  assert.match(data, /FROM pixbrik\.affiliate_partner[\s\S]*FOR UPDATE/);
  const codeToggle = data.slice(data.indexOf("export async function setAffiliateCodeActive"));
  assert.match(codeToggle, /FOR SHARE OF partner/);
  assert.match(codeToggle, /FROM pixbrik\.affiliate_code[\s\S]*FOR UPDATE/);
  assert.ok(
    codeToggle.indexOf("FOR SHARE OF partner") < codeToggle.indexOf("FROM pixbrik.affiliate_code"),
    "code status changes must lock the partner before the code"
  );
  assert.match(data, /before\.updated_at !== versionToken/);
  assert.match(data, /INSERT INTO pixbrik\.audit_event/);
  assert.match(data, /affiliate\.partner_created/);
  assert.match(data, /affiliate\.partner_activated/);
  assert.match(data, /affiliate\.partner_suspended/);
  assert.match(data, /affiliate\.code_created/);
  assert.match(data, /affiliate\.code_enabled/);
  assert.match(data, /affiliate\.code_disabled/);
  assert.match(data, /UPDATE pixbrik\.affiliate_code[\s\S]*SET active = false[\s\S]*partner_id/);
  assert.match(data, /cause: "partner_suspended"/);
  assert.match(data, /partner\.status !== "active"/);
  assert.match(data, /SELECT count\(\*\) FROM pixbrik\.affiliate_attribution/);
  assert.match(data, /totalAttributions: summary\.attribution_count/);
  assert.doesNotMatch(data, /DELETE FROM pixbrik\.affiliate_/);
});

test("partner and code management forms preserve accessible pending and error states", () => {
  assert.match(ui, /useActionState\(createAffiliatePartnerAction/);
  assert.match(ui, /useActionState\(createAffiliateCodeAction/);
  assert.match(ui, /useActionState\(setAffiliatePartnerActiveAction/);
  assert.match(ui, /useActionState\(setAffiliateCodeActiveAction/);
  assert.match(ui, /role=\{state\.status === "error" \? "alert" : "status"\}/);
  assert.match(ui, /name="termsVersion"/);
  assert.match(ui, /name="destinationPath"/);
  assert.match(ui, /Suspend .*disable all of its active codes/);
});
