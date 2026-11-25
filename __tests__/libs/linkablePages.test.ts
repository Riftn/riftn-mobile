import en from '../../i18n/locales/en.json';
import { LINKABLE_PAGES, linkablePageFor } from '../../libs/linkablePages';
import { appPageFor } from '../../libs/app-page-paths';
import { parseDehubLink } from '../../libs/dehub-links';

const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);

describe('pages you can link to', () => {
  it('cards every page the @ list can type', () => {
    for (const page of LINKABLE_PAGES) {
      expect(appPageFor(page.path)).not.toBeNull();
      const link = parseDehubLink(`https://riftn.com${page.path}`);
      expect(link?.kind).toBe('page');
      expect(linkablePageFor(link!.pagePath!)?.path).toBe(page.path);
    }
  });

  it('names every page with a real string', () => {
    for (const page of LINKABLE_PAGES) {
      expect(typeof lookup(page.labelKey)).toBe('string');
    }
  });

  it('cards an item as the page it sits on', () => {
    expect(linkablePageFor('/packs/starter')?.path).toBe('/packs');
    expect(linkablePageFor('/arcade/kings-gambit')?.labelKey).toBe('nav.arcade');
  });
});
