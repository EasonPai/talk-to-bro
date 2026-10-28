// runner.js - UI Dashboard Logic for M0-A Spike

const logEl = document.getElementById('logs');
let activeTestTabId = null;

function log(msg) {
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML += `\n[${time}] ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}

function updateBadge(id, state, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `badge ${state}`;
  el.textContent = text;
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll('button').forEach(b => b.disabled = disabled);
}

document.getElementById('btn-run-s1').addEventListener('click', async () => {
  setButtonsDisabled(true);
  updateBadge('badge-s1', 'pending', '執行中');
  log('正在執行 S1: 背景釘選分頁焦點隔離測試...');

  try {
    const res = await chrome.runtime.sendMessage({ action: 'RUN_S1' });
    if (res.passed) {
      updateBadge('badge-s1', 'pass', 'PASS');
      activeTestTabId = res.createdTabId;
      log(`S1 通過！釘選分頁已開啟 (TabId: ${res.createdTabId})，焦點未被搶奪。`);
      document.getElementById('desc-s1').textContent = res.details;
    } else {
      updateBadge('badge-s1', 'fail', 'FAIL');
      log(`S1 失敗: ${res.details}`);
    }
  } catch (err) {
    updateBadge('badge-s1', 'fail', 'ERROR');
    log(`S1 異常: ${err.message}`);
  } finally {
    setButtonsDisabled(false);
  }
});

document.getElementById('btn-run-s2').addEventListener('click', async () => {
  if (!activeTestTabId) {
    log('請先執行 S1 建立背景分頁！');
    return;
  }
  setButtonsDisabled(true);
  updateBadge('badge-s2', 'pending', '執行中');
  log(`正在執行 S2: 背景分頁 (TabId: ${activeTestTabId}) DOM 插入送出測試...`);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'RUN_S2',
      tabId: activeTestTabId,
      text: 'meticulous'
    });
    if (res.passed) {
      updateBadge('badge-s2', 'pass', 'PASS');
      log('S2 通過！背景未檢視分頁成功接收 DOM 插入並產出合法 user-query。');
      document.getElementById('desc-s2').textContent = res.details;
    } else {
      updateBadge('badge-s2', 'fail', 'FAIL');
      log(`S2 失敗: ${res.error || res.details}`);
    }
  } catch (err) {
    updateBadge('badge-s2', 'fail', 'ERROR');
    log(`S2 異常: ${err.message}`);
  } finally {
    setButtonsDisabled(false);
  }
});

document.getElementById('btn-run-s3').addEventListener('click', async () => {
  if (!activeTestTabId) {
    log('請先執行 S1 建立背景分頁！');
    return;
  }
  setButtonsDisabled(true);
  updateBadge('badge-s3', 'pending', '執行中');
  log(`正在執行 S3 (Go/No-go Gate): 隱藏分頁串流 DOM 採樣...`);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'RUN_S3',
      tabId: activeTestTabId
    });
    if (res.passed) {
      updateBadge('badge-s3', 'pass', 'PASS');
      log(`S3 通過！觀察到 ${res.growthStepCount} 次持續增長步驟，最終字數 ${res.finalTextLength}。`);
      document.getElementById('desc-s3').textContent = res.details;
    } else {
      updateBadge('badge-s3', 'fail', 'FAIL');
      log(`S3 失敗 (Go/No-go Gate 觸發！): ${res.error || res.details}`);
    }
  } catch (err) {
    updateBadge('badge-s3', 'fail', 'ERROR');
    log(`S3 異常: ${err.message}`);
  } finally {
    setButtonsDisabled(false);
  }
});

document.getElementById('btn-run-s4').addEventListener('click', async () => {
  if (!activeTestTabId) {
    log('請先執行 S1 建立背景分頁！');
    return;
  }
  setButtonsDisabled(true);
  updateBadge('badge-s4', 'pending', '執行中 (0/10)');
  log(`正在執行 S4: 10 次連續生命週期與完成訊號可靠性測試...`);

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'RUN_S4',
      tabId: activeTestTabId,
      count: 10
    });
    if (res.passed) {
      updateBadge('badge-s4', 'pass', 'PASS (10/10)');
      log(`S4 通過！10 次連續對話生命週期皆 100% 準確判定，無提早截斷。`);
      document.getElementById('desc-s4').textContent = res.details;
    } else {
      updateBadge('badge-s4', 'fail', `FAIL (${res.runsPassed}/${res.totalRuns})`);
      log(`S4 失敗: ${res.details}`);
    }
  } catch (err) {
    updateBadge('badge-s4', 'fail', 'ERROR');
    log(`S4 異常: ${err.message}`);
  } finally {
    setButtonsDisabled(false);
  }
});

document.getElementById('btn-run-all').addEventListener('click', async () => {
  setButtonsDisabled(true);
  updateBadge('suite-status', 'pending', '執行全套測試中...');
  log('====================================');
  log('開始執行全套 M0-A Spike 自動化驗收...');

  try {
    updateBadge('badge-s1', 'pending', '執行中');
    const res = await chrome.runtime.sendMessage({ action: 'RUN_FULL_SUITE' });
    const s1 = res.s1;
    const s2 = res.s2;
    const s3 = res.s3;
    const s4 = res.s4;

    updateBadge('badge-s1', s1.passed ? 'pass' : 'fail', s1.passed ? 'PASS' : 'FAIL');
    updateBadge('badge-s2', s2.passed ? 'pass' : 'fail', s2.passed ? 'PASS' : 'FAIL');
    updateBadge('badge-s3', s3.passed ? 'pass' : 'fail', s3.passed ? 'PASS' : 'FAIL');
    updateBadge('badge-s4', s4.passed ? 'pass' : 'fail', s4.passed ? 'PASS (10/10)' : 'FAIL');

    if (res.allPassed) {
      updateBadge('suite-status', 'pass', 'ALL PASSED');
      log('🎉 恭喜！M0-A Spike 全項驗收標準 (S1 ~ S4) 100% 通過！');
    } else {
      updateBadge('suite-status', 'fail', 'FAILED');
      log('❌ 測試套件未全部通過，請檢查各單元日誌。');
    }
  } catch (err) {
    updateBadge('suite-status', 'fail', 'ERROR');
    log(`執行全套測試發生例外: ${err.message}`);
  } finally {
    setButtonsDisabled(false);
  }
});
