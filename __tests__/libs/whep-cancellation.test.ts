import { subscribeToWhep } from '../../libs/whep';

const mockPeer = {
  addTransceiver: jest.fn(),
  addEventListener: jest.fn(),
  createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'offer' }),
  setLocalDescription: jest.fn().mockResolvedValue(undefined),
  setRemoteDescription: jest.fn(),
  localDescription: { sdp: 'offer' },
  iceGatheringState: 'complete',
  close: jest.fn(),
};
const mockRelease = jest.fn();
jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: function Peer() { return mockPeer; },
  MediaStream: function Stream() { return { release: mockRelease }; },
}));

afterEach(() => jest.restoreAllMocks());

it('releases the native connection before a pending response and deletes its late session', async () => {
  let finishPost!: (response: Response) => void;
  let postStarted!: () => void;
  const started = new Promise<void>((resolve) => { postStarted = resolve; });
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockImplementationOnce(() => new Promise((resolve) => {
      finishPost = resolve;
      postStarted();
    }))
    .mockResolvedValueOnce({} as Response);
  const controller = new AbortController();
  const endpoint = 'https://example.test/live/whep';
  const opened = subscribeToWhep({ endpoint, signal: controller.signal });
  const rejected = expect(opened).rejects.toThrow('WHEP subscription cancelled');
  await started;
  controller.abort();
  expect(mockPeer.close).toHaveBeenCalledTimes(1);
  expect(mockRelease).toHaveBeenCalledWith(false);
  finishPost({
    ok: true,
    headers: { get: () => '/live/whep/old' },
  } as unknown as Response);
  await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith(endpoint + '/old', { method: 'DELETE' });
  expect(mockPeer.setRemoteDescription).not.toHaveBeenCalled();
});
