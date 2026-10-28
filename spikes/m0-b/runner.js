// runner.js - Dashboard logic & DOM Golden test runner for M0-B Spike
import { htmlToMarkdown } from './markdown.js';

const logEl = document.getElementById('logs');

function log(msg) {
  const time = new Date().toLocaleTimeString();
  if (logEl) {
    logEl.innerHTML += `\n[${time}] ${msg}`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(`[Runner-B] ${msg}`);
}

function updateBadge(id, state, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `badge ${state}`;
  el.textContent = text;
}

window.runS7Test = function(goldens) {
  log('正在執行 S7: Markdown Extraction Golden 測試...');
  const results = [];

  for (const item of goldens) {
    const converted = htmlToMarkdown(item.html);
    const expected = item.expectedMarkdown.trim();
    const passed = (converted === expected);

    results.push({
      caseName: item.name,
      passed,
      actualLength: converted.length,
      expectedLength: expected.length,
      diff: passed ? null : { actual: converted, expected }
    });
  }

  const allPassed = results.every(r => r.passed);
  const summary = {
    test: 'S7',
    name: 'Markdown Extraction Fidelity (5 Goldens)',
    passed: allPassed,
    passedCount: results.filter(r => r.passed).length,
    totalCount: results.length,
    cases: results,
    details: allPassed
      ? 'All 5 golden cases (tables, nested lists, bold/italic, code blocks, citations) passed with 100% fidelity.'
      : 'Some golden test cases showed divergence.'
  };

  updateBadge('badge-s7', allPassed ? 'pass' : 'fail', allPassed ? 'PASS (5/5)' : 'FAIL');
  log(summary.details);
  return summary;
};

log('M0-B Runner 就緒。');
