// src/options/options.ts
import { validateBroChatUrl } from '../shared/validate';
import { computeStats } from '../shared/stats';
import type { SettingsV1 } from '../shared/types';

document.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('bro-url-input') as HTMLInputElement | null;
  const statusMsg = document.getElementById('url-status') as HTMLDivElement | null;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement | null;
  const checkReadyBtn = document.getElementById('check-ready-btn') as HTMLButtonElement | null;
  const statSentIn = document.getElementById('opt-stat-sent-in') as HTMLElement | null;
  const statReadBack = document.getElementById('opt-stat-read-back') as HTMLElement | null;

  if (!urlInput || !statusMsg || !saveBtn || !checkReadyBtn) {
    console.error('[Options] Required DOM elements missing');
    return;
  }

  function setStatus(text: string, type: 'success' | 'error' | 'info' = 'info') {
    if (!statusMsg) return;
    statusMsg.textContent = text;
    statusMsg.className = `status-msg ${type}`;
  }

  function renderStats(logByTalkId: Record<string, any> | undefined) {
    const stats = computeStats(logByTalkId ?? {});
    if (statSentIn) statSentIn.textContent = stats.formattedSentInRate;
    if (statReadBack) statReadBack.textContent = stats.formattedReadBackRate;
  }

  // 1. Load saved settings & Talk Log stats from chrome.storage.local
  try {
    const data = await chrome.storage.local.get(['settings:v1', 'runtime:v1']);
    const settings = data['settings:v1'] as SettingsV1 | undefined;
    const runtime = data['runtime:v1'];
    renderStats(runtime?.logByTalkId);
    if (settings && settings.broChatUrl) {
      urlInput.value = settings.broChatUrl;
      setStatus('已載入現有設定。', 'info');
    } else {
      setStatus('目前尚未設定 Bro Chat 網址，請輸入上方網址後點擊儲存。', 'info');
    }
  } catch (err: any) {
    setStatus(`讀取設定失敗：${err?.message ?? '未知錯誤'}`, 'error');
  }

  // 2. Real-time validation on input
  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    if (!val) {
      setStatus('', 'info');
      return;
    }
    const res = validateBroChatUrl(val);
    if (!res.valid) {
      setStatus(res.message || '無效的 URL', 'error');
    } else {
      setStatus(`✓ 格式正確 · Chat ID: ${res.ref?.chatId}`, 'success');
    }
  });

  // 3. Save button handler
  saveBtn.addEventListener('click', async () => {
    const rawVal = urlInput.value;
    const res = validateBroChatUrl(rawVal);

    if (!res.valid || !res.normalizedUrl) {
      setStatus(`儲存失敗：${res.message}`, 'error');
      urlInput.focus();
      return;
    }

    const newSettings: SettingsV1 = {
      broChatUrl: res.normalizedUrl,
      updatedAt: Date.now()
    };

    try {
      await chrome.storage.local.set({ 'settings:v1': newSettings });
      urlInput.value = res.normalizedUrl;
      setStatus('✓ 設定已成功儲存至本機，重開瀏覽器亦會保留。', 'success');
    } catch (err: any) {
      setStatus(`儲存至本機時發生錯誤：${err?.message ?? '未知錯誤'}`, 'error');
    }
  });

  // 4. Connection check
  checkReadyBtn.addEventListener('click', async () => {
    const currentVal = urlInput.value;
    const res = validateBroChatUrl(currentVal);
    if (!res.valid || !res.normalizedUrl) {
      setStatus(`無法測試連線：${res.message}`, 'error');
      urlInput.focus();
      return;
    }
    setStatus('正在檢查 Bro Chat 連線狀態⋯', 'info');
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        const matched = tabs.some((t) => typeof t.url === 'string' && t.url.startsWith(res.normalizedUrl!));
        setStatus(
          matched ? '✓ Bro Chat 網址正確，且背景分頁已開啟並就緒。' : '✓ Bro Chat 網址格式正確，已準備就緒。',
          'success'
        );
        return;
      }
    } catch {
      // Fallback to format-verified status
    }
    setStatus('✓ Bro Chat 網址格式正確，已準備就緒。', 'success');
  });
});
