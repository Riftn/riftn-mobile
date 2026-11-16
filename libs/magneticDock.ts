import { perfNote } from './perfTrace';
export type DockTarget = { x: number; y: number; width: number; height: number; tint: string; hide: (hidden: boolean) => void };
type Measure = (done: (target: DockTarget | null) => void) => void;
let active: Measure | null = null;
let registrations = 0;

/** Only an existing account's slow Android process startup owns this effect. */
export function shouldDockLaunch(platform: string, openingLaunch: boolean, signedIn: boolean, elapsedMs: number): boolean {
  return platform === 'android' && openingLaunch && signedIn && elapsedMs >= 400;
}

/** Only the focused header registers; cached screens cannot steal the landing. */
export function registerDockTarget(measure: Measure): () => void {
  active = measure;
  registrations += 1;
  perfNote(`dock target registered (${registrations})`);
  return () => { if (active === measure) { active = null; perfNote("dock target unregistered"); } };
}

export function measureDockTarget(): Promise<DockTarget | null> {
  const measure = active;
  perfNote(`dock target ${measure ? "registered" : "not registered"}, ${registrations} registered so far`);
  if (!measure) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = (target: DockTarget | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(active === measure ? target : null);
    };
    const timer = setTimeout(() => { perfNote("dock target measure timed out"); finish(null); }, 100);
    try { measure(target => { if (!target) perfNote("dock target measured empty"); else if (active !== measure) perfNote("dock target replaced while measuring"); finish(target); }); } catch { finish(null); }
  });
}
