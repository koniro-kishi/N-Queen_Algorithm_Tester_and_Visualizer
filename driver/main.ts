import { validateConfig } from '../Tester/Configuration/config';
import cfgRaw from '../Tester/Configuration/tester.config.json';

const app = document.getElementById('app')!;
const log = (html: string) => { app.insertAdjacentHTML('beforeend', html); };

async function bootstrap() {
  // Design section 3: Atomics.wait back-pressure needs cross-origin isolation.
  if (!crossOriginIsolated) {
    log('<p class="err">crossOriginIsolated is false. Serve via Vite (npm run dev) so COOP/COEP headers are sent; do not open via file://.</p>');
    return;
  }
  log('<p>crossOriginIsolated: <b>true</b></p>');

  try { validateConfig(cfgRaw); log('<p>tester.config.json: <b>valid</b></p>'); }
  catch (e) { log(`<p class="err">${(e as Error).message}</p>`); return; }

  const res = await fetch('/Solver/dist/manifest.json');
  if (!res.ok) { log('<p class="err">Solver/dist/manifest.json not found. Run <code>npm run build:solvers</code> first.</p>'); return; }
  const manifest = await res.json();
  log(`<p>Solvers: ${manifest.solvers.map((s: any) => `${s.name}${s.ok ? '' : ' (build failed)'}`).join(', ')}</p>`);

  // Spike S1: run each built solver once at N=8 in its own fresh worker.
  for (const s of manifest.solvers.filter((x: any) => x.ok)) {
    const worker = new Worker(new URL('../Tester/Execution/smoke-worker.ts', import.meta.url), { type: 'module' });
    const out: any = await new Promise((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => resolve({ ok: false, error: e.message });
      worker.postMessage({ moduleUrl: new URL(s.module, location.origin).href, n: 8 });
    });
    worker.terminate();
    log(out.ok
      ? `<h3>${s.name}: rc=${out.rc}, ${out.events} events, ${out.ms.toFixed(2)} ms</h3><pre>${out.board.join('\n')}</pre>`
      : `<p class="err">${s.name}: ${out.error}</p>`);
  }
}

bootstrap();
