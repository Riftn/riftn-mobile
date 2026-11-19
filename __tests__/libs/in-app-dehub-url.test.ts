import { inAppDehubUrl } from '../../libs/in-app-dehub-url';

describe('inAppDehubUrl', () => {
  it('keeps app pages in the app', () => {
    expect(inAppDehubUrl('https://riftn.com/app/post/12')).toBe('dehub://app/post/12');
  });

  it('opens a post share link in the app instead of the website', () => {
    expect(inAppDehubUrl('https://riftn.com/newpost/4821?ref=AB12')).toBe('dehub://newpost/4821?ref=AB12');
    expect(inAppDehubUrl('riftn.com/posts/12/b/55')).toBe('dehub://posts/12/b/55');
  });

  it('leaves other sites alone', () => {
    expect(inAppDehubUrl('https://example.com/newpost/1')).toBeNull();
  });
});
