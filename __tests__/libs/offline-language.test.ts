jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
}));

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('restores the saved language and its previous core before the network answers', async () => {
  const storage = require('@react-native-async-storage/async-storage').default;
  await storage.setItem('user-preferred-language', 'tr');
  await storage.setItem('locale-pack:older-version:tr:core', JSON.stringify({
    common: { noInternetTitle: 'İnternet bağlantısı yok' },
  }));
  let finishDownload!: (response: Response) => void;
  const download = new Promise<Response>(resolve => { finishDownload = resolve; });
  const fetchPack = jest.spyOn(global, 'fetch').mockReturnValue(download);

  const { default: i18n, languageReady } = require('../../i18n');
  await languageReady;
  expect(i18n.language).toBe('tr');
  expect(i18n.t('common.noInternetTitle')).toBe('İnternet bağlantısı yok');
  expect(await storage.getItem('user-preferred-language')).toBe('tr');
  expect(fetchPack).toHaveBeenCalledWith(expect.stringMatching(/\/tr\/core\.json$/), expect.anything());

  const added = new Promise<void>(resolve => i18n.store.on('added', resolve));
  finishDownload({
    ok: true,
    json: async () => ({ common: { noInternetTitle: 'Bağlantı yok' } }),
  } as Response);
  await added;
  expect(i18n.t('common.noInternetTitle')).toBe('Bağlantı yok');
  expect(i18n.language).toBe('tr');
});

it('keeps the selected locale if this device has no cached copy and downloads fail', async () => {
  const storage = require('@react-native-async-storage/async-storage').default;
  await storage.setItem('user-preferred-language', 'bn');
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));

  const { default: i18n, languageReady, loadLanguage } = require('../../i18n');
  await languageReady;
  expect(await loadLanguage('bn')).toBe(false);
  expect(i18n.language).toBe('bn');
  expect(await storage.getItem('user-preferred-language')).toBe('bn');
});
