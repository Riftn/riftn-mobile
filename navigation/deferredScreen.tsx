import React, { startTransition, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useReducedMotion } from 'react-native-reanimated';
import { RouteTransitionReadyContext } from '../context/RouteTransitionReadyContext';
import { useTransitionSettled } from '../hooks/useTransitionSettled';
import { RouteBusyContext, type RouteBusy } from '../context/RouteBusyContext';
import RouteLoadingShell from './RouteLoadingShell';
import ShellCover from './ShellCover';

/** The dissolve from a page's shell into the page. */
export const SHELL_REVEAL_MS = 220;
/** Longest the shell stays over a page that is still showing its own loader. */
export const SHELL_HOLD_CAP_MS = 900;

const screens = new Map<string, ComponentType<any>>();
const readyRoutes = new Map<string, ComponentType<any>>();
const loadedScreens = new Map<string, ComponentType<any>>();

export interface DeferredScreenOptions {
  /**
   * Draw the shell on the first frame even when the page's module is already
   * loaded, and the page on the next one. Native-stack starts the slide only
   * once the first render commits, so a page whose own first render is slow
   * (a chat: ~0.3s on a Galaxy S24+) held the tap still for that long. With a
   * shell drawn like the page, the slide starts at once and the page builds
   * while it runs.
   */
  shellFirst?: boolean;
}

/**
 * Load a deferred screen's module ahead of time. A screen already loaded
 * renders on its first frame instead of behind the loading shell until the
 * entrance ends, so warm the ones a tap should open instantly.
 */
export function preloadDeferredScreen(key: string, load: () => ComponentType<any>): void {
  if (!loadedScreens.has(key)) loadedScreens.set(key, load());
}

/**
 * Keep getComponent stable, while moving its heavy require past the entrance.
 * `LoadingShell` is what shows until then; the default sketches a page with
 * grey bars. It gets the route's props, so it can draw what it already knows.
 */
export function deferredScreen(
  key: string,
  load: () => ComponentType<any>,
  LoadingShell: ComponentType<any> = RouteLoadingShell,
  options: DeferredScreenOptions = {},
): ComponentType<any> {
  const cached = screens.get(key);
  if (cached) return cached;
  function DeferredScreen(props: any) {
    const routeKey = `${key}:${props.route.key}`;
    const focused = useIsFocused();
    const reducedMotion = useReducedMotion();
    const settled = useTransitionSettled(reducedMotion ? 32 : 600);
    // Theme/error boundaries can remount an existing native route without a
    // new transition. Do not put that already-open page behind a fresh timer.
    const [Content, setContent] = useState<ComponentType<any> | null>(
      () => readyRoutes.get(routeKey) ?? (options.shellFirst ? null : loadedScreens.get(key)) ?? null,
    );
    useEffect(() => {
      if (Content) {
        if (settled && !readyRoutes.has(routeKey)) remember(routeKey, Content);
        return;
      }
      // A loaded page drawn behind its shell comes in on the next frame.
      const loaded = options.shellFirst ? loadedScreens.get(key) : undefined;
      if (loaded) {
        const frame = requestAnimationFrame(() => startTransition(() => setContent(() => loaded)));
        return () => cancelAnimationFrame(frame);
      }
      // Back before the entrance ends must not evaluate a page being left.
      // The simulator check holds a page on its shell to picture it.
      if (focused && settled && !(globalThis as { __holdRouteShell?: boolean }).__holdRouteShell) {
        const component = load();
        loadedScreens.set(key, component);
        remember(routeKey, component);
        startTransition(() => setContent(() => component));
      }
    }, [Content, focused, settled, routeKey]);
    // The shell that was on screen stays over the page it hands to: while the
    // page still shows its own loader (capped), then it dissolves away.
    const [cover, setCover] = useState<'none' | 'hold' | 'fade'>('none');
    const shellShown = useRef(!Content);
    const holds = useRef(0);
    const release = useRef<() => void>(() => undefined);
    const busy = useMemo<RouteBusy>(() => ({
      hold() {
        holds.current += 1;
        let held = true;
        return () => {
          if (!held) return;
          held = false;
          holds.current -= 1;
          if (holds.current === 0) release.current();
        };
      },
    }), []);
    useEffect(() => {
      if (!Content || !shellShown.current) return;
      shellShown.current = false;
      // A shell-first page (a chat) draws its own header as its shell and
      // swaps on the next frame: nothing to dissolve.
      if (reducedMotion || options.shellFirst) return;
      setCover('hold');
      let done = false;
      let frame = 0;
      let timer: ReturnType<typeof setTimeout>;
      const start = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        setCover('fade');
        timer = setTimeout(() => setCover('none'), SHELL_REVEAL_MS + 30);
      };
      release.current = start;
      // The page's first frame shows whether it has anything to wait for.
      frame = requestAnimationFrame(() => { if (holds.current === 0) start(); });
      timer = setTimeout(start, SHELL_HOLD_CAP_MS);
      return () => { done = true; clearTimeout(timer); cancelAnimationFrame(frame); release.current = () => undefined; };
    }, [Content, reducedMotion]);
    // Once mounted, retain the real page and its scroll/draft state on blur.
    return Content ? <RouteTransitionReadyContext.Provider value={settled || readyRoutes.has(routeKey) ? props.route.key : null}>
      <RouteBusyContext.Provider value={busy}>
        <Content {...props} />
      </RouteBusyContext.Provider>
      {cover !== 'none' ? <ShellCover fading={cover === 'fade'} duration={SHELL_REVEAL_MS}>
        <LoadingShell {...props} />
      </ShellCover> : null}
    </RouteTransitionReadyContext.Provider> : <LoadingShell {...props} />;
  }
  screens.set(key, DeferredScreen);
  return DeferredScreen;
}

function remember(routeKey: string, component: ComponentType<any>): void {
  readyRoutes.set(routeKey, component);
  if (readyRoutes.size > 64) readyRoutes.delete(readyRoutes.keys().next().value!);
}
