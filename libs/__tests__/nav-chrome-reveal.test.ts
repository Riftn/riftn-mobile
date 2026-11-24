import { focusedRouteKey, onRevealNavChrome, revealNavChrome } from '../nav-chrome-reveal';

describe('nav-chrome-reveal', () => {
  it('calls every registered screen and stops after it leaves', () => {
    const a = jest.fn();
    const b = jest.fn(() => { throw new Error('one screen failing'); });
    const offA = onRevealNavChrome(a);
    const offB = onRevealNavChrome(b);
    revealNavChrome();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
    revealNavChrome();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('finds the focused screen through nested navigators', () => {
    const state = {
      index: 1,
      routes: [
        { key: 'root-1', state: { index: 0, routes: [{ key: 'home-1' }] } },
        { key: 'profile-7' },
      ],
    };
    expect(focusedRouteKey(state)).toBe('profile-7');
    expect(focusedRouteKey({ index: 0, routes: [state.routes[0]] })).toBe('home-1');
    expect(focusedRouteKey(undefined)).toBeUndefined();
  });
});
