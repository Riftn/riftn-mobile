import { readFileSync } from 'fs';
import { join } from 'path';
import { PULL_REFRESH_THRESHOLD, dragForPull, pullForDrag, pullShouldRefresh } from '../../libs/pill-pull-motion';

const src = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

describe('pull to refresh answers every pull', () => {
  it('dragForPull undoes pullForDrag, so a re-grab carries on from where the pull is', () => {
    for (const drag of [0, 20, 90, 200, 420]) expect(dragForPull(pullForDrag(drag))).toBeCloseTo(drag, 3);
  });

  it('a full pull or a quick shorter flick refreshes; a short slow one does not', () => {
    expect(pullShouldRefresh(PULL_REFRESH_THRESHOLD, 0)).toBe(true);
    expect(pullShouldRefresh(PULL_REFRESH_THRESHOLD * 0.7, 1400)).toBe(true);
    expect(pullShouldRefresh(PULL_REFRESH_THRESHOLD * 0.7, 200)).toBe(false);
    expect(pullShouldRefresh(PULL_REFRESH_THRESHOLD * 0.3, 3000)).toBe(false);
  });

  it('Home never refuses a pull for a running refresh or a spring-back', () => {
    const hook = src('hooks/useHomePullRefresh.ts');
    const down = hook.slice(hook.indexOf('.onTouchesDown'), hook.indexOf('.onTouchesMove'));
    expect(down).not.toMatch(/busy\.value|returning\.value/);
  });

  it('the drawer list keeps its GestureDetector on the scroll view (no RefreshControl wrapper)', () => {
    const drawer = src('components/common/PageDrawer.tsx');
    expect(drawer).not.toMatch(/<RefreshControl/);
    expect(drawer).toContain('refreshControl={undefined}');
    expect(src('components/Feed/PullRefreshArea.tsx')).toContain('refreshControl={undefined}');
  });

  it('Messages pulls through PullRefreshArea, not the hidden native spinner', () => {
    const dm = src('screens/DirectMessagesScreen.tsx');
    expect(dm).toContain('<PullRefreshArea');
    expect(dm).toContain('renderScrollComponent={renderPullScroll}');
    expect(dm).not.toMatch(/<DeHubRefreshControl/);
  });
});
