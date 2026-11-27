import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
jest.mock('../../services/user.service', () => ({}));
jest.mock('../../libs/custom-notifications', () => ({}));
import { mergeFirstPage } from '../../libs/notifications-cache';

const source = readFileSync(resolve(__dirname, '../../screens/NotificationScreen.tsx'), 'utf8');
const code = source.slice(source.indexOf('  const fetchNotifications = useCallback('), source.indexOf('  // Store fetchNotifications in a ref'));
const compiled = ts.transpileModule(code + '\nfetchNotifications', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

it('starts all sources together, paints the API page first, folds in custom rows, and does not wait on badges', async () => {
  let finishCounts!: (value: unknown) => void;
  const api = jest.fn().mockResolvedValueOnce({ result: [{ id: 'list', createdAt: '2026-01-01' }] })
    .mockImplementationOnce(() => new Promise(resolve => { finishCounts = resolve; }));
  const custom = jest.fn().mockResolvedValue([{ id: 'custom', createdAt: '2026-01-02' }]);
  const scope: any = {
    PAGE_SIZE: 15,
    useCallback: (fn: unknown) => fn, fetchGenRef: { current: 0 }, listFetchingRef: { current: false }, pageRef: { current: 1 },
    selectedFilterRef: { current: 'likes' }, walletAddressRef: { current: 'viewer' },
    apiTypesForFilter: () => ['like'], getNotifications: api, fetchCustomNotifications: custom,
    log: { error: jest.fn() }, listedUnreadRef: { current: new Map() },
    markAllReadSettled: () => null, applyMarkedAllRead: (_w: unknown, rows: unknown) => rows, takeInflightFirstPage: () => null, mergeFirstPage, customRowsRef: { current: [] }, lastRefreshAtRef: { current: 0 },
    tabFetchedAtRef: { current: new Map() }, rowsFilterRef: { current: 'all' },
  };
  for (const key of ['setLoadError', 'setNotifications', 'setHasMore', 'setCountsSource', 'setRefreshing', 'setLoading', 'setLoadingMore']) scope[key] = jest.fn();
  const refresh = runInNewContext(compiled, scope);
  const pending = refresh(true);
  expect(api).toHaveBeenCalledTimes(2);
  expect(custom).toHaveBeenCalledTimes(1);
  await new Promise(resolve => setImmediate(resolve));
  expect(scope.setNotifications).toHaveBeenNthCalledWith(1, [{ id: 'list', createdAt: '2026-01-01' }]);
  expect(scope.setNotifications).toHaveBeenNthCalledWith(2, [{ id: 'custom', createdAt: '2026-01-02' }, { id: 'list', createdAt: '2026-01-01' }]);
  expect(scope.lastRefreshAtRef.current).toBeGreaterThan(0);
  // The rows now on screen are filed under their tab, fresh as of now.
  expect(scope.rowsFilterRef.current).toBe('likes');
  expect(scope.tabFetchedAtRef.current.get('likes')).toBeGreaterThan(0);
  expect(scope.setLoading).toHaveBeenCalledWith(false);
  expect(scope.setCountsSource).not.toHaveBeenCalled();
  finishCounts({ result: [{ id: 'all' }] });
  await pending;
  expect(scope.setCountsSource).toHaveBeenCalledWith([{ id: 'all' }, { id: 'custom', createdAt: '2026-01-02' }]);
  expect(custom).toHaveBeenCalledTimes(1);
});

it('an unfiltered refresh reuses the warm-up fetch instead of asking again', async () => {
  const api = jest.fn();
  const custom = jest.fn();
  const scope: any = {
    PAGE_SIZE: 15,
    useCallback: (fn: unknown) => fn, fetchGenRef: { current: 0 }, listFetchingRef: { current: false }, pageRef: { current: 1 },
    selectedFilterRef: { current: 'all' }, walletAddressRef: { current: 'viewer' },
    apiTypesForFilter: () => undefined, getNotifications: api, fetchCustomNotifications: custom,
    log: { error: jest.fn() }, listedUnreadRef: { current: new Map() },
    markAllReadSettled: () => null, applyMarkedAllRead: (_w: unknown, rows: unknown) => rows, takeInflightFirstPage: () => Promise.resolve({ api: [{ _id: 'a', createdAt: '2026-01-01' }], custom: [] }),
    mergeFirstPage, customRowsRef: { current: [] }, lastRefreshAtRef: { current: 0 },
    tabFetchedAtRef: { current: new Map() }, rowsFilterRef: { current: 'all' },
  };
  for (const key of ['setLoadError', 'setNotifications', 'setHasMore', 'setCountsSource', 'setRefreshing', 'setLoading', 'setLoadingMore']) scope[key] = jest.fn();
  const refresh = runInNewContext(compiled, scope);
  await refresh(true);
  expect(api).not.toHaveBeenCalled();
  expect(custom).not.toHaveBeenCalled();
  expect(scope.setNotifications).toHaveBeenCalledWith([{ _id: 'a', createdAt: '2026-01-01' }]);
  expect(scope.setCountsSource).toHaveBeenCalledWith([{ _id: 'a', createdAt: '2026-01-01' }]);
});

it('keeps loaded pages visible until their refresh is ready and continues pagination at the next page', async () => {
  const newest = { _id: 'new', createdAt: '2026-01-04' };
  const first = { _id: 'first', createdAt: '2026-01-03' };
  const second = { _id: 'second', createdAt: '2026-01-02' };
  const older = { _id: 'older', createdAt: '2026-01-01' };
  let finishSecondPage!: (value: unknown) => void;
  const api = jest.fn().mockResolvedValueOnce({ result: [newest, first] })
    .mockImplementationOnce(() => new Promise(resolve => { finishSecondPage = resolve; }))
    .mockResolvedValueOnce({ result: [] });
  const scope = {
    PAGE_SIZE: 2,
    useCallback: (fn: unknown) => fn,
    fetchGenRef: { current: 0 }, listFetchingRef: { current: false }, pageRef: { current: 2 },
    selectedFilterRef: { current: 'all' }, walletAddressRef: { current: 'viewer' },
    apiTypesForFilter: () => undefined, getNotifications: api, fetchCustomNotifications: jest.fn().mockResolvedValue([]),
    log: { error: jest.fn() }, listedUnreadRef: { current: new Map() },
    markAllReadSettled: () => null, applyMarkedAllRead: (_w: unknown, rows: unknown) => rows,
    takeInflightFirstPage: () => null, mergeFirstPage, customRowsRef: { current: [] }, lastRefreshAtRef: { current: 0 },
    tabFetchedAtRef: { current: new Map() }, rowsFilterRef: { current: 'all' },
    setLoadError: jest.fn(), setNotifications: jest.fn(), setHasMore: jest.fn(), setCountsSource: jest.fn(),
    setRefreshing: jest.fn(), setLoading: jest.fn(), setLoadingMore: jest.fn(),
  };
  const refresh = runInNewContext(compiled, scope);
  const pending = refresh(true);
  await new Promise(resolve => setImmediate(resolve));
  expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  expect(scope.setNotifications).not.toHaveBeenCalled();
  finishSecondPage({ result: [second, older] });
  await pending;
  expect(scope.setNotifications).toHaveBeenCalledTimes(1);
  expect(scope.setNotifications).toHaveBeenCalledWith([newest, first, second, older]);
  expect(scope.setCountsSource).toHaveBeenCalledWith([newest, first]);
  expect(scope.setHasMore).toHaveBeenCalledWith(true);
  await refresh(false);
  expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
});

it('pages Requests by the last wallet-scoped row and rebuilds the loaded window on refresh', async () => {
  const newest = { _id: 'custom-new', createdAt: '2026-01-03' };
  const first = { _id: 'custom-first', createdAt: '2026-01-02' };
  const older = { _id: 'custom-older', createdAt: '2026-01-01' };
  const rows = { current: [] as typeof first[] };
  const features = ['feature_request_reply'];
  const requestPage = jest.fn()
    .mockResolvedValueOnce([first])
    .mockResolvedValueOnce([older])
    .mockResolvedValueOnce([newest])
    .mockResolvedValueOnce([first]);
  const scope = {
    PAGE_SIZE: 1,
    useCallback: (fn: unknown) => fn,
    fetchGenRef: { current: 0 }, listFetchingRef: { current: false }, pageRef: { current: 1 },
    selectedFilterRef: { current: 'features' }, walletAddressRef: { current: 'original-wallet' },
    FILTER_TYPE_MAP: { features }, notificationsRef: rows, fetchRequestNotificationPage: requestPage,
    apiTypesForFilter: () => undefined, getNotifications: jest.fn(), fetchCustomNotifications: jest.fn(),
    log: { error: jest.fn() }, listedUnreadRef: { current: new Map() },
    markAllReadSettled: () => null, applyMarkedAllRead: (_wallet: unknown, items: unknown) => items,
    takeInflightFirstPage: jest.fn(), customRowsRef: { current: [] }, lastRefreshAtRef: { current: 0 },
    tabFetchedAtRef: { current: new Map() }, rowsFilterRef: { current: 'all' },
    setNotifications: (next: typeof rows.current | ((previous: typeof rows.current) => typeof rows.current)) => {
      rows.current = typeof next === 'function' ? next(rows.current) : next;
    },
    setLoadError: jest.fn(), setHasMore: jest.fn(), setCountsSource: jest.fn(),
    setRefreshing: jest.fn(), setLoading: jest.fn(), setLoadingMore: jest.fn(),
  };
  const refresh = runInNewContext(compiled, scope);
  await refresh(true, { skipCounts: true });
  await refresh(false);
  expect(rows.current).toEqual([first, older]);
  await refresh(true, { skipCounts: true });
  expect(rows.current).toEqual([newest, first]);
  expect(requestPage.mock.calls).toEqual([
    ['original-wallet', features, 1, undefined],
    ['original-wallet', features, 1, first],
    ['original-wallet', features, 1, undefined],
    ['original-wallet', features, 1, newest],
  ]);
  expect(scope.getNotifications).not.toHaveBeenCalled();
  expect(scope.fetchCustomNotifications).not.toHaveBeenCalled();
  expect(scope.takeInflightFirstPage).not.toHaveBeenCalled();
});
