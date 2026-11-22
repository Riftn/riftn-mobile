import { downloadGalleryImage } from '../../libs/downloadGalleryImage';
import { saveToLibrary } from '../../libs/assistantMedia';
import { rememberGalleryIndex } from '../../libs/media-presentation';

jest.mock('../../libs/assistantMedia', () => ({ saveToLibrary: jest.fn() }));

it('saves the original of the selected slide, including after a gallery is shortened', async () => {
  const original = 'https://cdn.example/second.webp?signature=abc';
  const images = ['https://cdn.example/first.jpg', 'https://dehub.io/cdn-cgi/image/width=480/' + original];
  rememberGalleryIndex('album', 1);
  await downloadGalleryImage(images, 'album');
  expect(saveToLibrary).toHaveBeenLastCalledWith(original, 'image');

  await downloadGalleryImage(images.slice(0, 1), 'album');
  expect(saveToLibrary).toHaveBeenLastCalledWith(images[0], 'image');
  await downloadGalleryImage([], 'album');
  expect(saveToLibrary).toHaveBeenCalledTimes(2);
});
