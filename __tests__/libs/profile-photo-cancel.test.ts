import i18next from 'i18next';
import { toastError } from '../../libs/toast';
jest.unmock('../../libs/toast');
jest.mock('react-native-css-interop',()=>({createInteropElement:jest.requireActual('react').createElement}));
import { toast } from 'sonner-native';
import en from '../../i18n/locales/en.json';
import tr from '../../i18n/locales/tr.json';
import itLocale from '../../i18n/locales/it.json';
jest.mock('sonner-native',()=>({toast: Object.assign(jest.fn(), { custom:jest.fn(), dismiss:jest.fn() })}));
jest.mock('../../components/ui/GlassToast',()=>()=>null);
jest.mock('../../libs/storage-full',()=>({isStorageFullError:()=>false}));
beforeAll(async()=>{await i18next.init({fallbackLng:'en',resources:{en:{translation:en},tr:{translation:tr},it:{translation:itLocale}}});});
async function shown(lang: string,error: unknown) {
  await i18next.changeLanguage(lang);
  (toast.custom as jest.Mock).mockClear();toastError(error);
  return (toast.custom as jest.Mock).mock.calls[0][0].props;
}
it('localizes cancellation by native code or the original picker message',async()=>{
  expect(await shown('tr',Object.assign(new Error('picker dismissed'),{code:'E_PICKER_CANCELLED'}))).toMatchObject({type:'info',title:'Fotoğraf seçimi iptal edildi'});
  expect(await shown('en',new Error('User cancelled image selection'))).toMatchObject({type:'info',title:'Photo selection cancelled'});
  expect(await shown('it',new Error('User canceled image selection'))).toMatchObject({title:itLocale.dm.photo+' · '+itLocale.planned.cancelled});
  expect(await shown('tr',new Error('Upload error'))).toMatchObject({type:'error',title:'Upload error'});
});
