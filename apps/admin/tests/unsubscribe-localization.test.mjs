import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const unsubscribe = await readFile(
  new URL("../src/lib/email/unsubscribe.ts", import.meta.url),
  "utf8"
);
const page = await readFile(
  new URL("../src/app/unsubscribe/[token]/page.tsx", import.meta.url),
  "utf8"
);
const actions = await readFile(
  new URL("../src/app/unsubscribe/[token]/actions.ts", import.meta.url),
  "utf8"
);

test("unsubscribe confirmation copy covers every supported storefront language", () => {
  assert.match(unsubscribe, /UNSUBSCRIBE_LOCALES = \["en", "fr", "es", "it", "ar"\]/);
  for (const locale of ["en", "fr", "es", "it", "ar"]) {
    assert.match(unsubscribe, new RegExp(`\\n  ${locale}: \\{`));
  }
  assert.match(unsubscribe, /normalizeUnsubscribeLocale/);
  assert.match(unsubscribe, /split\(\/\[-_\]\//);
  assert.match(unsubscribe, /: "en"/);
});

test("the preference page derives language from the contact without exposing the address", () => {
  assert.match(unsubscribe, /SELECT email, status, locale_code/);
  assert.match(unsubscribe, /localeCode: normalizeUnsubscribeLocale\(contact\.locale_code\)/);
  assert.match(page, /lang=\{locale\}/);
  assert.match(page, /dir=\{locale === "ar" \? "rtl" : "ltr"\}/);
  assert.match(page, /<bdi dir="ltr">\{contact\.maskedEmail\}<\/bdi>/);
  assert.match(page, /const unusable = !contact && !loadFailed/);
  assert.doesNotMatch(page, /contact\.email/);
});

test("unsubscribe failures stay on the confirmation page with a retry path", () => {
  assert.match(actions, /\?result=\$\{result\}/);
  assert.match(actions, /\? "done" : "invalid"/);
  assert.match(actions, /catch \{/);
  assert.match(actions, /result = "failed"/);
  assert.match(page, /const showFailure = failed \|\| loadFailed/);
  assert.match(page, /const confirmed = inactive/);
  assert.doesNotMatch(page, /resultValue === "done"|doneValue/);
  assert.match(page, /role="alert"/);
  assert.match(page, /showFailure \? copy\.retryButton : copy\.confirmButton/);
});
