// tests/unit/validate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBroChatUrl } from '../../src/shared/validate.ts';

test('validateBroChatUrl - valid cases', async (t) => {
  await t.test('standard app chat url', () => {
    const res = validateBroChatUrl('https://gemini.google.com/app/4d870f290f0c5975');
    assert.equal(res.valid, true);
    assert.equal(res.normalizedUrl, 'https://gemini.google.com/app/4d870f290f0c5975');
    assert.equal(res.ref?.chatId, '4d870f290f0c5975');
    assert.equal(res.ref?.accountIndex, undefined);
  });

  await t.test('app chat url with multi-account index /u/1', () => {
    const res = validateBroChatUrl('https://gemini.google.com/u/1/app/4d870f290f0c5975');
    assert.equal(res.valid, true);
    assert.equal(res.normalizedUrl, 'https://gemini.google.com/u/1/app/4d870f290f0c5975');
    assert.equal(res.ref?.chatId, '4d870f290f0c5975');
    assert.equal(res.ref?.accountIndex, 1);
  });

  await t.test('gem chat url with gemId and chatId', () => {
    const res = validateBroChatUrl('https://gemini.google.com/gem/my-custom-translator/chat123_abc');
    assert.equal(res.valid, true);
    assert.equal(res.normalizedUrl, 'https://gemini.google.com/gem/my-custom-translator/chat123_abc');
    assert.equal(res.ref?.gemId, 'my-custom-translator');
    assert.equal(res.ref?.chatId, 'chat123_abc');
  });

  await t.test('gem chat url with multi-account /u/2', () => {
    const res = validateBroChatUrl('https://gemini.google.com/u/2/gem/gem789/chat999');
    assert.equal(res.valid, true);
    assert.equal(res.normalizedUrl, 'https://gemini.google.com/u/2/gem/gem789/chat999');
    assert.equal(res.ref?.accountIndex, 2);
    assert.equal(res.ref?.gemId, 'gem789');
    assert.equal(res.ref?.chatId, 'chat999');
  });

  await t.test('strips query parameters and hashes during normalization', () => {
    const res = validateBroChatUrl('https://gemini.google.com/app/abc123?utm_source=test#heading');
    assert.equal(res.valid, true);
    assert.equal(res.normalizedUrl, 'https://gemini.google.com/app/abc123');
    assert.equal(res.ref?.chatId, 'abc123');
  });

  await t.test('trims surrounding whitespace', () => {
    const res = validateBroChatUrl('   https://gemini.google.com/app/trimmed_chat   \n');
    assert.equal(res.valid, true);
    assert.equal(res.normalizedUrl, 'https://gemini.google.com/app/trimmed_chat');
  });
});

test('validateBroChatUrl - rejection boundaries', async (t) => {
  await t.test('empty input or whitespace', () => {
    assert.equal(validateBroChatUrl('').valid, false);
    assert.equal(validateBroChatUrl('   ').valid, false);
    assert.equal(validateBroChatUrl(null).valid, false);
    assert.equal(validateBroChatUrl(undefined).valid, false);
    assert.equal(validateBroChatUrl('').error, 'EMPTY');
  });

  await t.test('invalid URL string', () => {
    const res = validateBroChatUrl('not-a-valid-url');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'INVALID_URL');
  });

  await t.test('rejects non-https (e.g. http:)', () => {
    const res = validateBroChatUrl('http://gemini.google.com/app/4d870f290f0c5975');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'INVALID_PROTOCOL');
  });

  await t.test('rejects domain spoofing (subdomain evil.com)', () => {
    const res = validateBroChatUrl('https://gemini.google.com.evil.com/app/4d870f290f0c5975');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'INVALID_HOSTNAME');
  });

  await t.test('rejects subdomain on google.com (e.g. mail.google.com)', () => {
    const res = validateBroChatUrl('https://mail.google.com/app/4d870f290f0c5975');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'INVALID_HOSTNAME');
  });

  await t.test('rejects URLs with credentials', () => {
    const res = validateBroChatUrl('https://user:pass@gemini.google.com/app/4d870f290f0c5975');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'HAS_CREDENTIALS');
  });

  await t.test('rejects Gemini homepage without chat ID', () => {
    const res = validateBroChatUrl('https://gemini.google.com/');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'MISSING_CHAT_ID');
  });

  await t.test('rejects /app without chat ID', () => {
    const res = validateBroChatUrl('https://gemini.google.com/app');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'MISSING_CHAT_ID');
  });

  await t.test('rejects non-chat paths like /settings or /help', () => {
    const res = validateBroChatUrl('https://gemini.google.com/settings');
    assert.equal(res.valid, false);
    assert.equal(res.error, 'MISSING_CHAT_ID');
  });
});
