import { parseMomentReply, parseSharedMoment } from '../../libs/moment-reply';
const id = '6b0099334a6e07719f5908d3';
const link = `https://riftn.com/moment/${id}`;
it('keeps the original reply text and resolves old translated app links', () => {
  expect(parseMomentReply(`Anına yanıt verdi: Today: a photo!\nSecond line\n${link}`)).toEqual({ id, text: 'Today: a photo!\nSecond line' });
  expect(parseMomentReply(`Replied to your moment: nice\nhttps://dehub.io/app/moment/${id}`)).toEqual({ id, text: 'nice' });
});
it('recognizes new reply links from senders using a different language', () => {
  expect(parseMomentReply(`Risposto: Ciao\n${link}?reply=1`)).toEqual({ id, text: 'Ciao' });
});
it('leaves unrelated DM text and lookalike URLs untouched', () => {
  for (const content of [link, `Meet at: noon\n${link}`, `Replied to your moment: nice\n${link.replace('riftn.com', 'riftn.com.evil.test')}`,
    `Replied to your moment: nice\nhttps://riftn.com@evil.test/moment/${id}`, `Replied to your moment: nice\n${link}/another/path`]) {
    expect(parseMomentReply(content)).toBeNull();
  }
});

it('shows authorized Moment links with optional DM text and excludes unrelated links', () => {
  const id = '0123456789abcdef01234567';
  const url = 'https://riftn.com/app/moment/' + id;
  expect(parseSharedMoment(url)).toEqual({ id, text: '', shared: true });
  expect(parseSharedMoment('Watch this\n' + url)).toEqual({ id, text: 'Watch this', shared: true });
  expect(parseSharedMoment(url + '?reply=1')).toBeNull();
  expect(parseSharedMoment(url.replace('riftn.com', 'external.example'))).toBeNull();
});
