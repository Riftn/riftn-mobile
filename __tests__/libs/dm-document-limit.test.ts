import { validateAttachment } from '../../libs/attachments';

jest.mock('../../i18n/copy', () => ({ translateCopy: (_key: string, options: { defaultValue: string }) => options.defaultValue }));

it('accepts a 200 MiB document and rejects anything larger from the file picker', () => {
  const file = { uri: 'file:///report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 200 * 1024 * 1024 };
  expect(validateAttachment(file).ok).toBe(true);
  expect(validateAttachment({ ...file, size: file.size + 1 }).ok).toBe(false);
});
