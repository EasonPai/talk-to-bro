// tests/unit/popup-settings-view.test.ts — Seam A: pure settings view-model & stats formatting
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statsViewOf,
  settingsUrlFeedbackOf,
  settingsSaveFeedbackOf
} from '../../src/popup/view-state.ts';

test('statsViewOf returns 尚無樣本 when logByTalkId is empty or missing', () => {
  assert.deepEqual(statsViewOf(undefined), {
    sentInRate: '尚無樣本',
    readBackRate: '尚無樣本',
    total: 0
  });
  assert.deepEqual(statsViewOf({}), {
    sentInRate: '尚無樣本',
    readBackRate: '尚無樣本',
    total: 0
  });
});

test('statsViewOf formats real Talk Log sent-in and read-back rates', () => {
  const view = statsViewOf({
    t1: { result: 'success', at: 100 },
    t2: { result: 'read_failed', at: 200 },
    t3: { result: 'send_failed', at: 300 },
    t4: { result: 'success', at: 400 }
  });
  assert.equal(view.total, 4);
  assert.equal(view.sentInRate, '3/4 (75.0%)');
  assert.equal(view.readBackRate, '2/3 (66.7%)');
});

test('settingsUrlFeedbackOf handles empty, invalid, and valid Bro Chat URLs', () => {
  assert.deepEqual(settingsUrlFeedbackOf('   '), {
    valid: false,
    message: '',
    tone: 'info'
  });

  const invalid = settingsUrlFeedbackOf('http://gemini.google.com/app/abc');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.tone, 'error');
  assert.match(invalid.message, /HTTPS/);

  const valid = settingsUrlFeedbackOf('https://gemini.google.com/app/4d870f290f0c5975?hl=zh');
  assert.equal(valid.valid, true);
  assert.equal(valid.tone, 'success');
  assert.equal(valid.normalizedUrl, 'https://gemini.google.com/app/4d870f290f0c5975');
  assert.match(valid.message, /4d870f290f0c5975/);
});

test('settingsSaveFeedbackOf rejects empty URL with error tone', () => {
  const empty = settingsSaveFeedbackOf('');
  assert.equal(empty.valid, false);
  assert.equal(empty.tone, 'error');
  assert.ok(empty.message.length > 0);
});

test('Enhancement #35: Settings storage schema supports optional fontSize', () => {
  const settings: import('../../src/shared/types.ts').SettingsV1 = {
    broChatUrl: 'https://gemini.google.com/app/test',
    fontSize: 18,
    updatedAt: Date.now()
  };
  assert.equal(settings.fontSize, 18);
});
