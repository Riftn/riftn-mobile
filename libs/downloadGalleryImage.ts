import { saveToLibrary } from './assistantMedia';
import { cdnImageSource } from './cdnImage';
import { galleryIndex } from './media-presentation';

/** Resolve the selected slide when the menu action is pressed. */
export async function downloadGalleryImage(images: string[], galleryKey: string): Promise<void> {
  const image = images[Math.min(galleryIndex(galleryKey), images.length - 1)];
  if (image) await saveToLibrary(cdnImageSource(image), 'image');
}
