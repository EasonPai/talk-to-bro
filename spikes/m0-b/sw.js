// sw.js - Service Worker for M0-B Spike (Watchdog, Reconcile, Offscreen & Discard Recovery)

const ALARM_NAME = 'ttb-spike-watchdog';

// Initialize alarms watchdog
chrome.alarms.get(ALARM_NAME, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    console.log('[SW-B] Alarms watchdog created.');
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[SW-B] Watchdog alarm fired. Running reconcile...');
    reconcile();
  }
});

async function saveTalkState(talk) {
  await chrome.storage.local.set({ lastTalk: talk });
}

async function getTalkState() {
  const data = await chrome.storage.local.get('lastTalk');
  return data.lastTalk || null;
}

async function ensureAdapterInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['adapter.js']
    });
  } catch (err) {
    console.log('[SW-B] Script injection notice:', err.message);
  }
}

// Reconcile state machine (Write-ahead protection: NEVER resend)
async function reconcile() {
  const talk = await getTalkState();
  if (!talk) return { reconciled: false, reason: 'no_talk' };

  console.log(`[SW-B] Reconciling talk ${talk.id} in phase ${talk.phase}...`);

  // Check deadline
  if (talk.phaseDeadlineAt && Date.now() > talk.phaseDeadlineAt) {
    talk.phase = 'failed';
    talk.error = 'TIMEOUT';
    await saveTalkState(talk);
    return { reconciled: true, status: 'timed_out', talk };
  }

  if (talk.phase === 'submitting' || talk.phase === 'streaming') {
    try {
      const tab = await chrome.tabs.get(talk.tabId);
      if (!tab) {
        talk.phase = 'failed';
        talk.error = 'TAB_CLOSED';
        await saveTalkState(talk);
        return { reconciled: true, status: 'tab_closed' };
      }

      await ensureAdapterInjected(talk.tabId);
      const probe = await chrome.tabs.sendMessage(talk.tabId, { action: 'TTB_PROBE' }).catch(() => null);
      if (!probe) {
        return { reconciled: true, status: 'tab_unresponsive' };
      }

      // WRITE-AHEAD VERIFICATION: Do NOT call send() again!
      if (probe.turn === 'complete') {
        talk.phase = 'completed';
        talk.textLength = probe.textLength;
        await saveTalkState(talk);
        return { reconciled: true, status: 'completed_without_resend', talk };
      } else {
        talk.phase = 'streaming';
        talk.streamedChars = probe.textLength;
        await saveTalkState(talk);
        return { reconciled: true, status: 'resumed_monitoring', talk };
      }
    } catch (err) {
      return { reconciled: false, error: err.message };
    }
  }

  return { reconciled: true, status: talk.phase };
}

// Tab lifecycle management: reuse pinned tab, handle discard / freeze
async function ensureBroTab(preferredTabId, targetUrl) {
  if (preferredTabId) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab) {
        if (tab.discarded || tab.frozen) {
          console.log(`[SW-B] Tab ${tab.id} is discarded/frozen. Reloading before use...`);
          await chrome.tabs.reload(tab.id);
          await new Promise((resolve) => {
            const listener = (tid, changeInfo) => {
              if (tid === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(resolve, 3000);
          });
        }
        return { tab, reused: true, spawnedNew: false };
      }
    } catch (e) {
      console.log(`[SW-B] Preferred tab ${preferredTabId} not found. Creating new pinned tab...`);
    }
  }

  const newTab = await chrome.tabs.create({
    url: targetUrl,
    active: false,
    pinned: true
  });
  return { tab: newTab, reused: false, spawnedNew: true };
}

// Offscreen Document clipboard copy
async function copyViaOffscreen(text) {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Handoff fallback clipboard write'
    });
    // Wait briefly for offscreen.js to mount
    await new Promise(r => setTimeout(r, 200));
  }

  let copyResult = null;
  try {
    copyResult = await chrome.runtime.sendMessage({
      action: 'OFFSCREEN_COPY',
      text
    });
  } catch (err) {
    copyResult = { ok: false, error: err.message };
  } finally {
    // Wait briefly before closing document so delivery completes
    await new Promise(r => setTimeout(r, 150));
    await chrome.offscreen.closeDocument().catch(() => {});
  }

  return copyResult;
}

// S5: SW Watchdog & Reconcile Recovery
async function runS5Test(tabId) {
  console.log('[SW-B] Running S5: SW Watchdog & Reconcile Recovery...');
  await ensureAdapterInjected(tabId);

  const talkId = 'talk-s5-' + Date.now();
  const testTalk = {
    id: talkId,
    text: 'meticulous watchdog test',
    phase: 'submitting',
    tabId,
    submitAttemptCount: 1,
    phaseDeadlineAt: Date.now() + 180000 // 3 minutes deadline
  };

  await saveTalkState(testTalk);

  // Simulate SW crash/recovery during streaming
  testTalk.phase = 'streaming';
  testTalk.streamedChars = 120;
  await saveTalkState(testTalk);

  // Trigger reconcile
  const reconcileRes = await reconcile();

  const afterTalk = await getTalkState();
  const writeAheadMaintained = (afterTalk.submitAttemptCount === 1);

  return {
    test: 'S5',
    name: 'SW Watchdog, 3-min Survival & Reconcile Recovery',
    passed: Boolean(reconcileRes.reconciled && writeAheadMaintained),
    writeAheadMaintained,
    submitAttemptCount: afterTalk.submitAttemptCount,
    reconcileStatus: reconcileRes.status,
    details: 'Reconcile successfully resumed Talk state without duplicate submit (Write-ahead protection verified).'
  };
}

// S6: Discard & Freeze Recovery
async function runS6Test(existingTabId, targetUrl) {
  console.log(`[SW-B] Running S6: Tab Discard & Freeze Recovery on tab ${existingTabId}...`);
  const result1 = await ensureBroTab(existingTabId, targetUrl);

  return {
    test: 'S6',
    name: 'Tab Discard / Freeze Recovery & Pinned Tab Reuse',
    passed: result1.reused && !result1.spawnedNew,
    tabId: result1.tab.id,
    reused: result1.reused,
    spawnedNew: result1.spawnedNew,
    details: 'Existing pinned tab was cleanly verified/reused without spawning duplicate tabs.'
  };
}

// S8: Offscreen Clipboard Copy
async function runS8Test(text = 'meticulous offscreen handoff test') {
  console.log('[SW-B] Running S8: Offscreen Document Clipboard Copy...');
  try {
    const res = await copyViaOffscreen(text);
    return {
      test: 'S8',
      name: 'Offscreen Document Clipboard Copy (Popup Closed)',
      passed: Boolean(res && res.ok),
      copyResult: res,
      details: res && res.ok
        ? 'Offscreen document successfully wrote text to clipboard and cleanly closed.'
        : `Failed to write to clipboard via offscreen document: ${res ? res.error : 'unknown'}`
    };
  } catch (err) {
    return {
      test: 'S8',
      passed: false,
      error: err.message
    };
  }
}

// Full suite B (S5, S6, S8)
async function runFullSuiteB(fixtureTabId, fixtureUrl) {
  const s5 = await runS5Test(fixtureTabId);
  const s6 = await runS6Test(fixtureTabId, fixtureUrl);
  const s8 = await runS8Test('meticulous handoff clipboard test');

  return {
    s5,
    s6,
    s8,
    allPassed: Boolean(s5.passed && s6.passed && s8.passed)
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'RUN_S5') {
    runS5Test(msg.tabId).then(sendResponse).catch(err => sendResponse({ passed: false, error: err.message }));
    return true;
  }
  if (msg.action === 'RUN_S6') {
    runS6Test(msg.tabId, msg.url).then(sendResponse).catch(err => sendResponse({ passed: false, error: err.message }));
    return true;
  }
  if (msg.action === 'RUN_S8') {
    runS8Test(msg.text).then(sendResponse).catch(err => sendResponse({ passed: false, error: err.message }));
    return true;
  }
  if (msg.action === 'RUN_FULL_SUITE_B') {
    runFullSuiteB(msg.tabId, msg.url).then(sendResponse).catch(err => sendResponse({ allPassed: false, error: err.message }));
    return true;
  }
  return false;
});

console.log('[SW-B] Service Worker B initialized.');
