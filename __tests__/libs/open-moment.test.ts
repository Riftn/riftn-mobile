import { openMomentById } from '../../libs/open-moment';
import { getStory } from '../../services/stories.service';
import { openStoryViewer } from '../../store/stories.store';

jest.mock('../../services/stories.service', () => ({ getStory: jest.fn() }));
jest.mock('../../store/stories.store', () => ({ openStoryViewer: jest.fn() }));
jest.mock('../../libs/toast', () => ({ toastError: jest.fn() }));

const id = '0123456789abcdef01234567';
const owner = '0xabc';
const get = jest.mocked(getStory);
const open = jest.mocked(openStoryViewer);

function respond(expired: boolean) {
  get.mockResolvedValue({
    author: { address: owner },
    item: {
      id,
      status: 'ready',
      expired,
      expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(),
    },
  } as Awaited<ReturnType<typeof getStory>>);
}

beforeEach(() => jest.clearAllMocks());

it('opens the archived comment thread for its author', async () => {
  respond(true);
  expect(await openMomentById(id, '0xABC', { openComments: true })).toBe(true);
  expect(get).toHaveBeenCalledWith(id, true);
  expect(open).toHaveBeenCalledWith([expect.objectContaining({ own: true })], 0, true, { openComments: true });
});

it('retains the expiry check for other readers and for like or mention taps', async () => {
  respond(true);
  expect(await openMomentById(id, '0xdef', { openComments: true })).toBe(false);
  expect(await openMomentById(id, owner)).toBe(false);
  expect(open).not.toHaveBeenCalled();
});

it('keeps the same authenticated lookup and opens live Moments in the requested mode', async () => {
  respond(false);
  expect(await openMomentById(id, owner)).toBe(true);
  expect(open).toHaveBeenLastCalledWith(expect.any(Array), 0, true, { openComments: false });
  expect(await openMomentById(id, owner, { openComments: true })).toBe(true);
  expect(open).toHaveBeenLastCalledWith(expect.any(Array), 0, true, { openComments: true });
});

it('does not open a thread denied by the server', async () => {
  get.mockRejectedValueOnce(new Error('Moment not found'));
  expect(await openMomentById(id, owner, { openComments: true })).toBe(false);
  expect(open).not.toHaveBeenCalled();
});
