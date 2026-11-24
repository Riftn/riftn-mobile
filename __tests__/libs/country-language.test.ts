let mockLocales: Array<{ languageCode: string; regionCode?: string }> = [{ languageCode: 'en' }];
jest.mock('expo-localization', () => ({ getLocales: () => mockLocales }));
jest.mock('expo/virtual/env', () => ({ env: process.env }));

import { languageForCountry } from '../../libs/country-language';

const detect = (): string | null => require('../../i18n').detectCountryLanguage();

beforeEach(() => { jest.resetModules(); });

it('maps a country to its one main language', () => {
  expect(languageForCountry('TR')).toBe('tr');
  expect(languageForCountry('br')).toBe('pt');
  expect(languageForCountry('CH')).toBeNull();
  expect(languageForCountry('US')).toBeNull();
  expect(languageForCountry(undefined)).toBeNull();
});

it('starts setup on the country language when the phone is in English', () => {
  mockLocales = [{ languageCode: 'en', regionCode: 'TR' }];
  expect(detect()).toBe('tr');
});

it('keeps a phone set to another shipped language', () => {
  mockLocales = [{ languageCode: 'de', regionCode: 'TR' }];
  expect(detect()).toBeNull();
});

it('keeps English where English is the main language', () => {
  mockLocales = [{ languageCode: 'en', regionCode: 'GB' }];
  expect(detect()).toBeNull();
});
