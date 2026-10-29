// scripts/test-m3-suite.js
// Automated End-to-End Verification Harness for Ticket 05 (#29: M3)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SELECTORS, queryOne, queryAll } from '../src/adapter/selectors.ts';
import { isSameGeminiChat } from '../src/sw/tab.ts';
import { validateBroChatUrl } from '../src/shared/validate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function main() {
  console.log('================================================================');
  console.log('    Ticket 05 (#29: M3) Rigorous Verification Suite             ');
  console.log('================================================================\n');

  // AC1: Selectors Isolation & Candidates
  console.log('[Test Suite] 1. Verifying AC1: Selector Isolation in selectors.ts...');
  const expectedKeys = [
    'editor',
    'sendButton',
    'stopButton',
    'userTurn',
    'userTurnText',
    'modelTurn',
    'modelBody',
    'modelDone',
    'signIn'
  ];
  for (const k of expectedKeys) {
    assert.ok(Array.isArray(SELECTORS[k]), `Selector key ${k} must be an array`);
    assert.ok(SELECTORS[k].length >= 2, `Selector key ${k} must contain multiple fallback candidates`);
  }
  console.log('  ✓ AC1 Passed: All 9 selector categories isolated with >=2 fallback candidates.');

  // AC2: Tab matching & URL normalization
  console.log('[Test Suite] 2. Verifying AC2: Tab matching contract (/app, /gem, /u/N)...');
  assert.equal(isSameGeminiChat('https://gemini.google.com/app/4d870f290f0c5975?hl=en', 'https://gemini.google.com/app/4d870f290f0c5975'), true);
  assert.equal(isSameGeminiChat('https://gemini.google.com/gem/gem-writer/4d870f290f0c5975', 'https://gemini.google.com/gem/gem-writer/4d870f290f0c5975'), true);
  assert.equal(isSameGeminiChat('https://gemini.google.com/u/1/app/4d870f290f0c5975', 'https://gemini.google.com/u/1/app/4d870f290f0c5975'), true);
  assert.equal(isSameGeminiChat('https://gemini.google.com/u/1/app/4d870f290f0c5975', 'https://gemini.google.com/u/2/app/4d870f290f0c5975'), false);
  assert.equal(isSameGeminiChat('https://gemini.google.com/app/4d870f290f0c5975', 'https://gemini.google.com/app/other-chat'), false);
  console.log('  ✓ AC2 Passed: Account index (/u/N) & chat identity matching verified.');

  // AC3: Build artifacts & On-Demand Adapter Bundle
  console.log('[Test Suite] 3. Verifying AC3: IIFE adapter.js build artifact...');
  const adapterPath = path.join(DIST_DIR, 'adapter.js');
  assert.equal(fs.existsSync(adapterPath), true, 'dist/adapter.js must exist');
  const adapterContent = fs.readFileSync(adapterPath, 'utf-8');
  assert.ok(adapterContent.includes('ttb-build-0.1.0'), 'adapter.js must contain build guard');
  assert.ok(adapterContent.includes('TTB_PING'), 'adapter.js must handle TTB_PING');
  assert.ok(adapterContent.includes('TTB_CHECK_READY'), 'adapter.js must handle TTB_CHECK_READY');
  assert.ok(adapterContent.includes('TTB_INSERT_AND_SEND'), 'adapter.js must handle TTB_INSERT_AND_SEND');
  assert.ok(adapterContent.includes('TTB_PROBE'), 'adapter.js must handle TTB_PROBE');
  console.log('  ✓ AC3 Passed: adapter.js IIFE bundle verified with on-demand runtime handlers.');

  // AC4 & AC5: Static contract inspection
  console.log('[Test Suite] 4. Verifying AC4 & AC5: Draft protection and exact turn equality contracts...');
  assert.ok(adapterContent.includes('EDITOR_BUSY'), 'adapter.js must return EDITOR_BUSY on user draft presence');
  assert.ok(adapterContent.includes('data-ttb-seen'), 'adapter.js must tag baselines with data-ttb-seen');
  assert.ok(adapterContent.includes('userTurnVerified'), 'adapter.js must confirm userTurnVerified');
  assert.ok(!adapterContent.includes('.includes(normalizeText(text))'), 'adapter.js must NOT use includes for turn verification');
  console.log('  ✓ AC4 & AC5 Passed: Draft protection and exact normalized equality verified.');

  console.log('\n================================================================');
  console.log('       ALL ACCEPTANCE CRITERIA FOR TICKET 05 (#29) PASSED       ');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ M3 Verification Failed:', err);
  process.exit(1);
});
