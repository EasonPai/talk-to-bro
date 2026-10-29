// src/sw/index.ts
// Background Service Worker for Talk To Bro Personally (MV3)

const ALARM_NAME = 'ttb-watchdog';

// Initialize alarms watchdog
chrome.alarms.get(ALARM_NAME, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    console.log('[SW] Watchdog alarm created.');
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[SW] Watchdog alarm tick.');
  }
});

// Message hub
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'PING') {
    sendResponse({ ok: true, version: '0.1.0' });
    return true;
  }
  if (msg.action === 'GET_SETTINGS') {
    chrome.storage.local.get('settings:v1').then((res) => {
      sendResponse({ ok: true, settings: res['settings:v1'] || null });
    });
    return true;
  }
  if (msg.action === 'SET_SETTINGS') {
    chrome.storage.local.set({ 'settings:v1': msg.settings }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

console.log('[SW] Talk To Bro Personally Service Worker initialized.');
