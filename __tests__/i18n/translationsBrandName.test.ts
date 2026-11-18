import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The product was renamed DeHub -> Riftn. English was updated, but older
 * machine translations kept the old name and the dehub.io domain. A
 * translation may only mention DeHub when the English for the same key does.
 */
const OLD_BRAND = /de\s?hub/i;
const DIR = join(__dirname, '../../i18n/locales');

type Tree = { [key: string]: unknown };

const flatten = (tree: Tree, prefix = '', out: Record<string, unknown> = {}) => {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value as Tree, path, out);
    else out[path] = value;
  }
  return out;
};

const read = (file: string) => flatten(JSON.parse(readFileSync(join(DIR, file), 'utf8')));

describe('translations use the Riftn name', () => {
  it('never says DeHub where English does not', () => {
    const en = read('en.json');
    const offenders: string[] = [];
    for (const file of readdirSync(DIR)) {
      if (!file.endsWith('.json') || file === 'en.json') continue;
      for (const [key, value] of Object.entries(read(file))) {
        if (OLD_BRAND.test(JSON.stringify(value)) && !OLD_BRAND.test(JSON.stringify(en[key] ?? ''))) {
          offenders.push(`${file}: ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
