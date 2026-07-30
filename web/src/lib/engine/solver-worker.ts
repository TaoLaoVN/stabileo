/**
 * Web Worker for parallel 3D structural solving.
 * Each worker loads its own WASM instance and solves independently.
 *
 * Messages:
 *   { type: 'init', wasmModule: WebAssembly.Module }  → initialize WASM (pre-compiled module, structured-cloned)
 *   { type: 'solve3d', id: number, input: object } → solve and return results (plain objects, structured-cloned)
 */

import { assertFiniteWire } from './wasm-solver';

let initSync: ((moduleOrBytes: any) => void) | null = null;
let solve_3d: ((input: any) => any) | null = null;
let ready = false;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      // Dynamic import so the build doesn't fail when WASM files are absent
      const wasm = await import(/* @vite-ignore */ '../wasm/dedaliano_engine.js');
      initSync = wasm.initSync;
      solve_3d = wasm.solve_3d;

      initSync({ module: msg.wasmModule });
      ready = true;
      self.postMessage({ type: 'ready' });
    } catch (err: any) {
      self.postMessage({ type: 'error', message: `Worker init failed: ${err.message}` });
    }
    return;
  }

  if (msg.type === 'solve3d') {
    if (!ready || !solve_3d) {
      self.postMessage({ type: 'result', id: msg.id, error: 'Worker not initialized' });
      return;
    }
    try {
      // solve_3d takes and returns plain JS objects — structured clone both ways.
      // The finiteness guard preserves the old JSON-boundary semantics (NaN/Inf rejected).
      assertFiniteWire(msg.input);
      const result = solve_3d(msg.input);
      self.postMessage({ type: 'result', id: msg.id, result });
    } catch (err: any) {
      self.postMessage({ type: 'result', id: msg.id, error: err.message });
    }
    return;
  }
};
