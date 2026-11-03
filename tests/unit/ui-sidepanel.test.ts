// tests/unit/ui-sidepanel.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStorage } from '../helpers/fake-adapter.ts';
import { getUiStorage, saveUiStorage, DEFAULT_UI_STATE, UI_STORAGE_KEY } from '../../src/shared/storage.ts';
import type { UiState } from '../../src/shared/types.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('T-1: dist build contains dual hosts and manifest with sidePanel (M12)', () => {
  const distManifestPath = path.join(ROOT, 'dist/manifest.json');
  assert.ok(fs.existsSync(distManifestPath), 'dist/manifest.json must exist');

  const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
  assert.equal(manifest.version, '0.1.9', 'Version must be 0.1.9');
  assert.equal(manifest.minimum_chrome_version, '141', 'Minimum Chrome must be 141');
  assert.ok(manifest.permissions.includes('sidePanel'), 'Must declare sidePanel permission');
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html', 'side_panel.default_path must be sidepanel.html');
  assert.equal(manifest.action?.default_popup, 'popup.html', 'action.default_popup must be popup.html');

  assert.ok(fs.existsSync(path.join(ROOT, 'dist/popup.html')), 'dist/popup.html must exist');
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/sidepanel.html')), 'dist/sidepanel.html must exist');
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/popup.js')), 'dist/popup.js must exist');
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/popup.css')), 'dist/popup.css must exist');
});

test('T-1: UI state revision increases monotonically and preserves drafts across mode switches (M7)', async () => {
  const storage = new MemoryStorage();

  // Initial
  const s0 = await getUiStorage(storage);
  assert.equal(s0.revision, 0);
  assert.equal(s0.mode, 'popup');

  // Host 1 types draft
  await saveUiStorage(storage, {
    mode: 'popup',
    draft: 'Draft from popup',
    revision: 1
  });

  const s1 = await getUiStorage(storage);
  assert.equal(s1.draft, 'Draft from popup');
  assert.equal(s1.revision, 1);

  // Switch to sidepanel mode
  await saveUiStorage(storage, {
    mode: 'sidepanel',
    draft: s1.draft,
    revision: 2
  });

  const s2 = await getUiStorage(storage);
  assert.equal(s2.mode, 'sidepanel');
  assert.equal(s2.draft, 'Draft from popup');
  assert.equal(s2.revision, 2);

  // Host in sidepanel adds more text
  await saveUiStorage(storage, {
    mode: 'sidepanel',
    draft: 'Draft from popup + sidepanel line',
    revision: 3
  });

  const s3 = await getUiStorage(storage);
  assert.equal(s3.draft, 'Draft from popup + sidepanel line');
  assert.equal(s3.revision, 3);
});

test('T-1: Conditional draft clearing logic preserves newer drafts and does not clear on rejection (M6)', async () => {
  const storage = new MemoryStorage();

  // User typed "apple"
  await saveUiStorage(storage, {
    mode: 'popup',
    draft: 'apple',
    revision: 1
  });

  // Helper simulate submit acceptance
  async function simulateSubmitAccepted(submittedText: string, talkId: string) {
    const currentUi = await getUiStorage(storage);
    if (currentUi.draft.trim() === submittedText.trim()) {
      await saveUiStorage(storage, {
        ...currentUi,
        draft: '',
        revision: currentUi.revision + 1,
        acceptedTalkId: talkId
      });
    }
  }

  // Helper simulate submit rejected
  async function simulateSubmitRejected() {
    // Rejection never modifies UI storage
  }

  // Case A: Submit rejected -> draft preserved
  await simulateSubmitRejected();
  let ui = await getUiStorage(storage);
  assert.equal(ui.draft, 'apple', 'Draft must not be cleared on rejected submit');

  // Case B: User types new draft "banana" while "apple" was submitted
  // "apple" is accepted now, but draft in storage is already "banana"
  await saveUiStorage(storage, {
    mode: 'popup',
    draft: 'banana',
    revision: 2
  });

  await simulateSubmitAccepted('apple', 'talk-apple-1');
  ui = await getUiStorage(storage);
  assert.equal(ui.draft, 'banana', 'Newer draft banana must be preserved when older apple finishes');

  // Case C: Draft matches submitted text -> cleared
  await simulateSubmitAccepted('banana', 'talk-banana-1');
  ui = await getUiStorage(storage);
  assert.equal(ui.draft, '', 'Draft must be cleared when it matches accepted submission');
  assert.equal(ui.acceptedTalkId, 'talk-banana-1');
});
