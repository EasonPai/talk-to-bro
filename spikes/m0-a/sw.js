// sw.js - Service Worker & Test Orchestrator for M0-A Spike

const DEFAULT_FIXTURE_URL = chrome.runtime.getURL('fixtures/mock-gemini.html');

async function ensureAdapterInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['adapter.js']
    });
  } catch (err) {
    console.log('[SW] Script injection check:', err.message);
  }
}

async function runS1Test(targetUrl = DEFAULT_FIXTURE_URL) {
  console.log('[SW] Starting S1 Test: Background tab focus isolation...');
  const [initialActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const initialTabId = initialActiveTab ? initialActiveTab.id : null;

  // Create pinned background tab
  const newTab = await chrome.tabs.create({
    url: targetUrl,
    active: false,
    pinned: true
  });

  // Wait 500ms to allow browser window manager to process
  await new Promise(r => setTimeout(r, 500));

  const [afterActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const afterTabId = afterActiveTab ? afterActiveTab.id : null;

  const focusMaintained = (initialTabId === afterTabId);

  return {
    test: 'S1',
    name: 'Background Pinned Tab Focus Isolation',
    passed: focusMaintained,
    initialActiveTabId: initialTabId,
    afterActiveTabId: afterTabId,
    createdTabId: newTab.id,
    pinned: newTab.pinned,
    active: newTab.active,
    details: focusMaintained
      ? 'Active tab was not changed. Focus remained on initial tab.'
      : `Focus stolen! Initial tab ${initialTabId} switched to ${afterTabId}`
  };
}

async function runS2Test(tabId, text = 'meticulous') {
  console.log(`[SW] Starting S2 Test on tab ${tabId}: Text insertion & submit...`);
  await ensureAdapterInjected(tabId);

  // Check ready
  const ready = await chrome.tabs.sendMessage(tabId, { action: 'TTB_CHECK_READY' });
  if (!ready || !ready.ok) {
    return { test: 'S2', passed: false, error: `Tab not ready: ${JSON.stringify(ready)}` };
  }

  // Insert and send
  const sendRes = await chrome.tabs.sendMessage(tabId, {
    action: 'TTB_INSERT_AND_SEND',
    text
  });

  return {
    test: 'S2',
    name: 'Background Input Insertion & User Turn Verification',
    passed: Boolean(sendRes && sendRes.ok && sendRes.userTurnVerified),
    sendResult: sendRes,
    details: sendRes && sendRes.ok
      ? 'Programmatic insertion succeeded and new user-query verified in background DOM.'
      : 'Failed to insert or verify new user-query.'
  };
}

async function runS3Test(tabId, words = 'meticulous, persistent, elaborate, profound, ubiquitous, resilient, versatile, subtle, coherent, pragmatic') {
  console.log(`[SW] Starting S3 Test (Go/No-go Gate) on tab ${tabId}...`);
  await ensureAdapterInjected(tabId);

  // Send input
  const sendRes = await chrome.tabs.sendMessage(tabId, {
    action: 'TTB_INSERT_AND_SEND',
    text: words
  });

  if (!sendRes || !sendRes.ok) {
    return { test: 'S3', passed: false, error: 'Failed to submit prompt for S3 test.' };
  }

  const samples = [];
  const startTime = Date.now();
  let completed = false;

  // Poll probe every 100ms
  while (Date.now() - startTime < 15000) {
    const probe = await chrome.tabs.sendMessage(tabId, { action: 'TTB_PROBE' });
    samples.push({
      elapsedMs: Date.now() - startTime,
      textLength: probe.textLength,
      generating: probe.generating,
      turn: probe.turn,
      visibility: probe.visibility
    });

    if (probe.turn === 'complete' && !probe.generating) {
      completed = true;
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  // Verify monotonic growth
  let grewCount = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].textLength > samples[i - 1].textLength) {
      grewCount++;
    }
    if (samples[i].textLength < samples[i - 1].textLength) {
      return {
        test: 'S3',
        passed: false,
        error: 'textLength decreased during stream!',
        samples
      };
    }
  }

  const passed = completed && (grewCount >= 3) && (samples[samples.length - 1].textLength > 50);

  return {
    test: 'S3',
    name: 'Streaming DOM Updates in Hidden Tab (Go/No-go Gate)',
    passed,
    growthStepCount: grewCount,
    totalSamples: samples.length,
    finalTextLength: samples.length > 0 ? samples[samples.length - 1].textLength : 0,
    samples,
    details: passed
      ? `Streaming DOM updated continuously (${grewCount} growth steps observed, final len: ${samples[samples.length - 1].textLength}). rAF/Timer throttling does NOT freeze stream.`
      : `Streaming failed to update continuously or complete in time. (Steps: ${grewCount}, completed: ${completed})`
  };
}

async function runS4Test(tabId, runCount = 10) {
  console.log(`[SW] Starting S4 Test: 10 consecutive turn lifecycle reliability on tab ${tabId}...`);
  await ensureAdapterInjected(tabId);

  const testWords = [
    'meticulous', 'persistent', 'elaborate', 'profound', 'ubiquitous',
    'resilient', 'versatile', 'subtle', 'coherent', 'pragmatic'
  ];

  const results = [];

  for (let i = 0; i < runCount; i++) {
    const word = testWords[i % testWords.length] + ` [run-${i + 1}]`;
    const t0 = Date.now();

    // 1. Submit
    const sendRes = await chrome.tabs.sendMessage(tabId, {
      action: 'TTB_INSERT_AND_SEND',
      text: word
    });

    if (!sendRes || !sendRes.ok) {
      results.push({ run: i + 1, word, passed: false, error: 'Send failed' });
      continue;
    }

    let t1_generating = null;
    let t2_stop_gone = null;
    let t3_model_done = null;
    let stableProbes = 0;
    let lastLength = -1;
    let finalLength = 0;

    const runStartTime = Date.now();
    let prematureDone = false;

    while (Date.now() - runStartTime < 10000) {
      const probe = await chrome.tabs.sendMessage(tabId, { action: 'TTB_PROBE' });

      if (probe.generating && !t1_generating) {
        t1_generating = Date.now() - t0;
      }

      if (t1_generating && !probe.generating && !t2_stop_gone) {
        t2_stop_gone = Date.now() - t0;
      }

      if (probe.hasDoneAction && !t3_model_done) {
        t3_model_done = Date.now() - t0;
      }

      if (probe.turn === 'complete' && !t1_generating && probe.textLength === 0) {
        prematureDone = true;
        break;
      }

      if (!probe.generating && probe.hasDoneAction && probe.textLength > 0) {
        if (probe.textLength === lastLength) {
          stableProbes++;
        } else {
          stableProbes = 0;
          lastLength = probe.textLength;
        }
      }

      if (stableProbes >= 2) {
        finalLength = probe.textLength;
        break;
      }

      await new Promise(r => setTimeout(r, 100));
    }

    const runPassed = Boolean(
      !prematureDone &&
      t1_generating !== null &&
      t2_stop_gone !== null &&
      t3_model_done !== null &&
      finalLength > 30
    );

    results.push({
      run: i + 1,
      word,
      passed: runPassed,
      t1_generating_ms: t1_generating,
      t2_stop_gone_ms: t2_stop_gone,
      t3_model_done_ms: t3_model_done,
      finalLength,
      durationMs: Date.now() - t0
    });

    // Small delay between runs
    await new Promise(r => setTimeout(r, 300));
  }

  const allPassed = results.every(r => r.passed);

  return {
    test: 'S4',
    name: 'Bro Completion Signal Reliability (10 Runs)',
    passed: allPassed,
    runsPassed: results.filter(r => r.passed).length,
    totalRuns: runCount,
    runs: results,
    details: allPassed
      ? `All ${runCount} consecutive runs observed correct generating -> stopButton -> modelDone lifecycle without premature completion.`
      : `Some runs failed completion lifecycle.`
  };
}

// Full suite orchestration
async function runFullSuite(targetUrl = DEFAULT_FIXTURE_URL) {
  const suiteResults = {};

  // Step 1: Run S1
  const s1 = await runS1Test(targetUrl);
  suiteResults.s1 = s1;
  const testTabId = s1.createdTabId;

  if (!s1.passed) {
    return { ok: false, error: 'S1 failed: Focus was stolen!', results: suiteResults };
  }

  // Wait 1 second for background tab to initialize
  await new Promise(r => setTimeout(r, 1000));

  // Step 2: Run S2
  const s2 = await runS2Test(testTabId, 'meticulous');
  suiteResults.s2 = s2;

  // Step 3: Run S3
  const s3 = await runS3Test(testTabId);
  suiteResults.s3 = s3;

  // Step 4: Run S4
  const s4 = await runS4Test(testTabId, 10);
  suiteResults.s4 = s4;

  suiteResults.allPassed = Boolean(s1.passed && s2.passed && s3.passed && s4.passed);

  return suiteResults;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'RUN_S1') {
    runS1Test(msg.url).then(sendResponse);
    return true;
  }
  if (msg.action === 'RUN_S2') {
    runS2Test(msg.tabId, msg.text).then(sendResponse);
    return true;
  }
  if (msg.action === 'RUN_S3') {
    runS3Test(msg.tabId, msg.words).then(sendResponse);
    return true;
  }
  if (msg.action === 'RUN_S4') {
    runS4Test(msg.tabId, msg.count).then(sendResponse);
    return true;
  }
  if (msg.action === 'RUN_FULL_SUITE') {
    runFullSuite(msg.url).then(sendResponse);
    return true;
  }
});

console.log('[SW] Service Worker initialized successfully.');
