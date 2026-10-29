// src/adapter/entry.ts
// Bro Adapter IIFE Entrypoint (injected on-demand into ISOLATED world)

(() => {
  const BUILD_ID = 'ttb-build-0.1.0';
  const guardKey = `__ttb_${BUILD_ID}__`;

  if ((window as any)[guardKey]) {
    return;
  }
  (window as any)[guardKey] = true;

  console.log('[BroAdapter] Adapter initialized with build ID:', BUILD_ID);
})();
