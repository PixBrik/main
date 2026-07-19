import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSourceUrl = new URL('../src/screens/ContactScreen.tsx', import.meta.url);
const copySourceUrl = new URL('../src/legal/legalContent.ts', import.meta.url);

test('contact form exposes every customer-editable input and topic to assistive technology', async () => {
  const source = await readFile(screenSourceUrl, 'utf8');
  const inputs = Array.from(source.matchAll(/<TextInput\b([\s\S]*?)\/>/g), (match) => match[1]);
  const visibleInputs = inputs.filter((input) => !/accessibilityElementsHidden/.test(input));

  assert.equal(inputs.length, 5, 'expected four customer inputs and one bot trap');
  assert.equal(visibleInputs.length, 4, 'only the four customer inputs may be exposed');
  for (const input of visibleInputs) {
    assert.match(input, /accessibilityLabel=\{copy\.[A-Za-z]+Label\}/);
  }

  assert.match(source, /accessibilityLabel=\{copy\.topics\[topicOption\]\}/);
  assert.match(source, /accessibilityLabel=\{copy\.topicLabel\}[\s\S]*?accessibilityRole="radiogroup"/);
  assert.match(source, /accessibilityRole="radio"/);
  assert.match(source, /accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(source, /accessibilityLabel=\{status === 'sending' \? copy\.sendingLabel : copy\.sendLabel\}/);
});

test('contact honeypot stays in the payload but cannot receive keyboard or screen-reader focus', async () => {
  const source = await readFile(screenSourceUrl, 'utf8');
  const honeypot = Array.from(source.matchAll(/<TextInput\b([\s\S]*?)\/>/g), (match) => match[1])
    .find((input) => /setCompanyWebsite/.test(input));

  assert.ok(honeypot, 'honeypot input is missing');
  assert.match(honeypot, /accessible=\{false\}/);
  assert.match(honeypot, /accessibilityElementsHidden/);
  assert.match(honeypot, /aria-hidden/);
  assert.match(honeypot, /focusable=\{false\}/);
  assert.match(honeypot, /importantForAccessibility="no-hide-descendants"/);
  assert.match(honeypot, /pointerEvents="none"/);
  assert.match(honeypot, /showSoftInputOnFocus=\{false\}/);
  assert.match(honeypot, /tabIndex=\{-1\}/);
});

test('localized validation identifies message length, privacy, name and order requirements', async () => {
  const [screen, copy] = await Promise.all([
    readFile(screenSourceUrl, 'utf8'),
    readFile(copySourceUrl, 'utf8'),
  ]);

  const requiredMessages = Array.from(
    copy.matchAll(/requiredMessage:\s*'([^'\r\n]+)'/g),
    (match) => match[1],
  );
  assert.equal(requiredMessages.length, 5, 'every supported locale needs complete fallback validation');
  for (const message of requiredMessages) {
    assert.match(message, /20/);
    assert.match(message, /5[.,\s]?000/);
  }

  for (const key of [
    'invalidNameMessage',
    'invalidOrderMessage',
    'messageLengthHelp',
    'messageLengthMessage',
    'privacyNoticeErrorMessage',
  ]) {
    assert.equal(
      Array.from(copy.matchAll(new RegExp(`${key}:\\s*'`, 'g'))).length,
      5,
      `${key} must be translated into EN, FR, ES, IT and AR`,
    );
  }

  assert.match(screen, /setFeedbackKey\('invalidName'\)/);
  assert.match(screen, /setFeedbackKey\('messageLength'\)/);
  assert.match(screen, /setFeedbackKey\('invalidOrder'\)/);
  assert.match(screen, /error\.field === 'privacyNoticeVersion'/);
  assert.match(screen, /error\.field === 'privacyNoticePresentedAt'/);
  assert.match(screen, /setFeedbackKey\('privacyNoticeError'\)/);
  assert.match(screen, /\{copy\.messageLengthHelp\}/);
});

test('visible feedback is resolved from the active locale instead of storing stale copy', async () => {
  const source = await readFile(screenSourceUrl, 'utf8');

  assert.match(source, /const \[feedbackKey, setFeedbackKey\]/);
  assert.match(source, /invalidName: copy\.invalidNameMessage/);
  assert.match(source, /sent: copy\.sentMessage/);
  assert.doesNotMatch(source, /useState\(''\).*feedback/);
});
