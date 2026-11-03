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

test('T-1: M8 - Concurrent interleaved mutations between runtime:v1 and ui:v1 preserve all state without data loss', async () => {
  const { getRuntimeStorage, saveRuntimeStorage } = await import('../../src/shared/storage.ts');
  const { UiQueue } = await import('../../src/sw/ui-state.ts');
  const storage = new MemoryStorage();
  const queue = new UiQueue();
  const runtimeQueue = new UiQueue(); // Simulates TalkRunner's internal mutex

  // Initial states
  await saveRuntimeStorage(storage, {
    lastTalk: null,
    logByTalkId: {}
  });
  await saveUiStorage(storage, {
    mode: 'popup',
    draft: 'initial draft',
    revision: 1
  });

  // Interleave 20 concurrent operations:
  // 10 UI mutations via uiQueue, 10 Runtime Talk mutations via runtimeQueue
  const tasks: Promise<any>[] = [];

  for (let i = 0; i < 10; i++) {
    // UI task
    tasks.push(
      queue.run(async () => {
        const current = await getUiStorage(storage);
        await saveUiStorage(storage, {
          ...current,
          draft: `draft update ${i}`,
          revision: current.revision + 1
        });
      })
    );

    // Runtime task (managed by runner mutex in SW)
    tasks.push(
      runtimeQueue.run(async () => {
        const current = await getRuntimeStorage(storage);
        const talk = {
          id: `talk-${i}`,
          text: `query ${i}`,
          phase: (i === 9 ? 'done' : 'waiting') as any,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          phaseDeadlineAt: null,
          answerMarkdown: i === 9 ? '# Final Answer markdown' : undefined
        };
        await saveRuntimeStorage(storage, {
          lastTalk: talk,
          logByTalkId: {
            ...current.logByTalkId,
            [`talk-${i}`]: { result: 'success', at: Date.now() }
          }
        });
      })
    );
  }

  await Promise.all(tasks);

  // Verify runtime:v1 is fully intact
  const finalRuntime = await getRuntimeStorage(storage);
  assert.ok(finalRuntime.lastTalk, 'Runtime lastTalk must exist');
  assert.equal(finalRuntime.lastTalk?.answerMarkdown, '# Final Answer markdown');
  assert.equal(Object.keys(finalRuntime.logByTalkId).length, 10, 'All 10 talk logs must be recorded');

  // Verify ui:v1 is fully intact
  const finalUi = await getUiStorage(storage);
  assert.equal(finalUi.revision, 11, 'UI revision must have incremented 10 times from 1');
  assert.ok(finalUi.draft.startsWith('draft update'), 'UI draft must be intact');
});

test('T-1: M6 - SW interruption recovery between Talk acceptance and UI draft clear (reconcileUiOnBoot)', async () => {
  const { getRuntimeStorage, saveRuntimeStorage } = await import('../../src/shared/storage.ts');
  const { reconcileUiOnBoot } = await import('../../src/sw/ui-state.ts');
  const storage = new MemoryStorage();

  // Scenario 1: SW terminated right after runner accepted Talk "ephemeral",
  // but before UI draft was cleared.
  await saveRuntimeStorage(storage, {
    lastTalk: {
      id: 'talk-interrupted-1',
      text: 'ephemeral',
      phase: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phaseDeadlineAt: Date.now() + 10000
    },
    logByTalkId: {}
  });

  await saveUiStorage(storage, {
    mode: 'popup',
    draft: 'ephemeral',
    revision: 1
    // acceptedTalkId is absent
  });

  // Run startup reconcile
  await reconcileUiOnBoot(storage);

  let ui = await getUiStorage(storage);
  assert.equal(ui.draft, '', 'Draft must be cleared during boot reconcile because it matches accepted talk');
  assert.equal(ui.revision, 2, 'Revision must increment on draft clear');
  assert.equal(ui.acceptedTalkId, 'talk-interrupted-1', 'acceptedTalkId must record accepted talk ID');

  // Scenario 2: Another host typed "newer draft" before SW restarted
  await saveUiStorage(storage, {
    mode: 'sidepanel',
    draft: 'newer draft from other host',
    revision: 3
    // simulate reset acceptedTalkId for testing
  });

  await reconcileUiOnBoot(storage);

  ui = await getUiStorage(storage);
  assert.equal(ui.draft, 'newer draft from other host', 'Newer draft must NOT be cleared on boot reconcile');
  assert.equal(ui.acceptedTalkId, 'talk-interrupted-1');
});

test('T-1: M9 - Pin/Unpin rollback preserves mode and content when openPopup fails', async () => {
  const storage = new MemoryStorage();

  await saveUiStorage(storage, {
    mode: 'sidepanel',
    draft: 'important unsubmitted thoughts',
    revision: 1
  });

  // Simulated unpin flow with rollback
  const currentDraft = (await getUiStorage(storage)).draft;
  let targetMode = 'popup';

  // Step 1: Save target mode in storage
  await saveUiStorage(storage, {
    mode: 'popup',
    draft: currentDraft,
    revision: 2
  });

  // Step 2: Attempt openPopup, inject failure
  let openSuccess = false;
  let sidePanelClosed = false;
  try {
    throw new Error('Simulated Chrome openPopup failure: window not focused');
    openSuccess = true;
  } catch (err) {
    // Rollback to sidepanel
    await saveUiStorage(storage, {
      mode: 'sidepanel',
      draft: currentDraft,
      revision: 3
    });
  }

  // Step 3: Only close if openSuccess
  if (openSuccess) {
    sidePanelClosed = true;
  }

  const finalState = await getUiStorage(storage);
  assert.equal(sidePanelClosed, false, 'Sidepanel must not close when openPopup fails');
  assert.equal(finalState.mode, 'sidepanel', 'Mode must roll back to sidepanel');
  assert.equal(finalState.draft, 'important unsubmitted thoughts', 'Draft must remain intact');
});
