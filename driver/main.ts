import { validateConfig } from "../Tester/Configuration/config";
import cfgRaw from "../Tester/Configuration/tester.config.json";
import { generatePreplaced } from "../Tester/Board/preplaced";
import { PERMIT_UNLIMITED } from "../Tester/Execution/protocol";
import { Session, type SessionResult } from "../Tester/Execution/session";
import { browserWorkerFactory } from "../Tester/Execution/worker-factory";
import { runS4 } from "./spikes/s4";
import { runS4b } from "./spikes/s4b";

const app = document.getElementById("app")!;
const log = (html: string) => {
  app.insertAdjacentHTML("beforeend", html);
};

async function bootstrap() {
  // Design section 3: Atomics.wait back-pressure needs cross-origin isolation.
  if (!crossOriginIsolated) {
    log(
      '<p class="err">crossOriginIsolated is false. Serve via Vite (npm run dev) so COOP/COEP headers are sent; do not open via file://.</p>',
    );
    return;
  }
  log("<p>crossOriginIsolated: <b>true</b></p>");

  try {
    validateConfig(cfgRaw);
    log("<p>tester.config.json: <b>valid</b></p>");
  } catch (e) {
    log(`<p class="err">${(e as Error).message}</p>`);
    return;
  }

  const res = await fetch("/Solver/dist/manifest.json");
  if (!res.ok) {
    log(
      '<p class="err">Solver/dist/manifest.json not found. Run <code>npm run build:solvers</code> first.</p>',
    );
    return;
  }
  const manifest = await res.json();
  log(
    `<p>Solvers: ${manifest.solvers.map((s: any) => `${s.name}${s.ok ? "" : " (build failed)"}`).join(", ")}</p>`,
  );

  const solvers = manifest.solvers.filter((x: any) => x.ok);
  const inst = generatePreplaced(8, 3, 1);
  log(
    `<p>Instance: N=8, P=3, seed=1, preplaced=${JSON.stringify(inst.queens)}</p>`,
  );

  // Spike S1: Only Show Result (no back-pressure), one fresh worker per solver.
  for (const s of solvers) {
    const result = await new Promise<SessionResult>((resolve) => {
      new Session({
        n: 8,
        preplaced: inst.queens,
        moduleUrl: new URL(s.module, location.origin).href,
        timeoutSeconds: 5,
        recordEvents: false,
        initialPermit: PERMIT_UNLIMITED,
        createWorker: browserWorkerFactory,
        onFinish: resolve,
      }).start();
    });
    log(
      `<h3>S1 ${s.name}: ${result.status}</h3><pre>${JSON.stringify(result, null, 2)}</pre>`,
    );
  }

  // Spike S2: step mode. Permit starts at 1; every flushed batch lets the solver run one event further.
  for (const s of solvers) {
    const small = generatePreplaced(6, 0, 1);
    let produced = 0;
    const result = await new Promise<SessionResult>((resolve) => {
      const session: Session = new Session({
        n: 6,
        preplaced: small.queens,
        moduleUrl: new URL(s.module, location.origin).href,
        timeoutSeconds: 30,
        recordEvents: true,
        initialPermit: 1,
        createWorker: browserWorkerFactory,
        onFinish: resolve,
        onEvents: (ev) => {
          produced += ev.length;
          session.raisePermit(produced + 1);
        },
      });
      session.start();
    });
    log(
      `<h3>S2 ${s.name} (step mode, N=6): ${result.status}</h3><pre>${JSON.stringify({ ...result, finalBoard: undefined }, null, 2)}</pre>`,
    );
  }

  // Spike S4: opt-in lewat ?s4 (memakan ±30 detik)
  if (new URLSearchParams(location.search).has("s4")) {
    const bt = solvers.find((x: any) => x.name === "backtracking");
    if (bt) await runS4(app, bt);
  }

  if (new URLSearchParams(location.search).has("s4b")) {
    const bt = solvers.find((x: any) => x.name === "backtracking");
    if (bt) await runS4b(app, bt);
  }
}

bootstrap();
