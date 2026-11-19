
import { confirmDmSend, isUnconfirmedSend, type DmSendPayload, type DmSendTransport } from '../../libs/dm-send-confirmation';

class ChatTransport implements DmSendTransport {
  senderAddress = '0xAlice';
  handlers = new Map<string, Set<(data: any) => void>>();
  emitted: DmSendPayload[] = [];
  on(event: string, handler: (data: any) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => { this.handlers.get(event)!.delete(handler); };
  }
  emit(payload: DmSendPayload) { this.emitted.push(payload); }
  receive(event: string, data: any) { this.handlers.get(event)?.forEach(handler => handler(data)); }
  get listenerCount() { return [...this.handlers.values()].reduce((sum, handlers) => sum + handlers.size, 0); }
}

const payload = { dmId: 'conversation-1', content: 'reply', type: 'msg' };
const echo = { _id: 'saved-1', conversation: payload.dmId, content: 'reply', msgType: 'msg', author: 'me' };
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('persisted DM confirmation', () => {
  it('confirms a saved sender echo without the display-only author field', async () => {
    const transport = new ChatTransport();
    const pending = confirmDmSend(transport, payload);
    transport.receive('sendMessage', { ...echo, author: undefined, sender: { address: '0xBob' } });
    const saved = { ...echo, author: undefined, conversation: undefined,
      conversationId: payload.dmId, sender: { address: '0xALICE' } };
    transport.receive('sendMessage', saved);
    await expect(pending).resolves.toEqual(saved);
    expect(transport.listenerCount).toBe(0);
  });
  it('stays pending beyond the old two-second refresh until the saved echo arrives', async () => {
    const transport = new ChatTransport();
    let saved = false;
    const pending = confirmDmSend(transport, payload).then(message => { saved = true; return message; });
    await jest.advanceTimersByTimeAsync(3000);
    expect(saved).toBe(false);
    expect(transport.emitted).toEqual([payload]);
    transport.receive('sendMessage', echo);
    await expect(pending).resolves.toEqual(echo);
    expect(transport.listenerCount).toBe(0);
  });

  it('does not confirm on an incoming reply, another thread, or another outgoing message', async () => {
    const transport = new ChatTransport();
    let saved = false;
    const pending = confirmDmSend(transport, payload).then(() => { saved = true; });
    transport.receive('sendMessage', { ...echo, author: 'other' });
    transport.receive('sendMessage', { ...echo, conversation: 'conversation-2' });
    transport.receive('sendMessage', { ...echo, content: 'different' });
    await jest.advanceTimersByTimeAsync(1);
    expect(saved).toBe(false);
    transport.receive('sendMessage', echo);
    await pending;
  });

  it('matches encrypted wire content and a populated conversation', async () => {
    const transport = new ChatTransport();
    const content = 'encrypted:nonce:ciphertext';
    const pending = confirmDmSend(transport, { ...payload, content });
    const saved = { ...echo, content, conversation: { _id: payload.dmId } };
    transport.receive('sendMessage', saved);
    await expect(pending).resolves.toEqual(saved);
  });

  it('surfaces the server rejection instead of claiming the reply was sent', async () => {
    const transport = new ChatTransport();
    const pending = confirmDmSend(transport, payload);
    const assertion = expect(pending).rejects.toThrow('Recipient requires a message fee.');
    transport.receive('error', { msg: 'Recipient requires a message fee.', code: 'DM_FEE_REQUIRED' });
    await assertion;
    expect(transport.listenerCount).toBe(0);
  });

  it('rejects a silent server once, without retrying or leaking listeners', async () => {
    const transport = new ChatTransport();
    const assertion = expect(confirmDmSend(transport, payload)).rejects.toThrow(/did not confirm/);
    await jest.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(transport.emitted).toHaveLength(1);
    expect(transport.listenerCount).toBe(0);
  });

  it('reports a disconnect while awaiting confirmation', async () => {
    const transport = new ChatTransport();
    const assertion = expect(confirmDmSend(transport, payload)).rejects.toThrow(/disconnected/);
    transport.receive('disconnected', undefined);
    await assertion;
    expect(transport.listenerCount).toBe(0);
  });

  it('catches a disconnected transport that refuses the emit', async () => {
    const transport = new ChatTransport();
    transport.emit = () => { throw new Error('Not connected'); };
    await expect(confirmDmSend(transport, payload)).rejects.toThrow('Not connected');
    expect(transport.listenerCount).toBe(0);
  });

  it('subscribes before emitting, including an immediate server response', async () => {
    const transport = new ChatTransport();
    transport.emit = () => { transport.receive('sendMessage', echo); };
    await expect(confirmDmSend(transport, payload)).resolves.toEqual(echo);
    expect(transport.listenerCount).toBe(0);
  });

  it('matches a GIF by its URL as well as its caption', async () => {
    const transport = new ChatTransport();
    const gif = 'https://example.test/reply.gif';
    const pending = confirmDmSend(transport, { ...payload, type: 'gif', gif });
    transport.receive('sendMessage', { ...echo, msgType: 'gif', mediaUrls: [{ url: 'other.gif' }] });
    const saved = { ...echo, msgType: 'gif', mediaUrls: [{ url: gif }] };
    transport.receive('sendMessage', saved);
    await expect(pending).resolves.toEqual(saved);
  });
});

describe('send confirmation by the line id', () => {
  const withId = { ...payload, clientId: 'temp-1' };

  it('confirms by the echoed line id even if the stored text was trimmed', async () => {
    const transport = new ChatTransport();
    const pending = confirmDmSend(transport, { ...withId, content: 'reply ' });
    transport.receive('sendMessage', { ...echo, content: 'reply', clientId: 'temp-1' });
    await expect(pending).resolves.toMatchObject({ _id: 'saved-1' });
  });

  it('ignores the echo of another line and errors from other actions', async () => {
    const transport = new ChatTransport();
    let done = false;
    const pending = confirmDmSend(transport, withId).finally(() => { done = true; });
    transport.receive('sendMessage', { ...echo, _id: 'other', clientId: 'temp-2' });
    transport.receive('error', { event: 'markAsRead', msg: 'Failed to mark messages as read.' });
    transport.receive('error', { event: 'sendMessage', clientId: 'temp-2', msg: 'nope' });
    await jest.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    transport.receive('sendMessage', { ...echo, clientId: 'temp-1' });
    await expect(pending).resolves.toMatchObject({ _id: 'saved-1' });
  });

  it('fails on an error for this line, and marks a lost confirmation as resendable', async () => {
    const transport = new ChatTransport();
    const refused = confirmDmSend(transport, withId);
    transport.receive('error', { event: 'sendMessage', clientId: 'temp-1', msg: 'nope' });
    await expect(refused).rejects.toThrow('nope');

    const lost = confirmDmSend(new ChatTransport(), withId).catch(e => e);
    await jest.advanceTimersByTimeAsync(16_000);
    expect(isUnconfirmedSend(await lost)).toBe(true);
  });
});
