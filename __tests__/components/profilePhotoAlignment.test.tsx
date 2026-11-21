import React from 'react';
import { act, create } from 'react-test-renderer';
import ContainedFeedImage from '../../components/Home/ContainedFeedImage';
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({ View:'View', Text:'Text', useWindowDimensions:()=>({width:390,height:844}) }));
jest.mock('expo-image',()=>({Image:{}}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
jest.mock('../../hooks/useImageAspect',()=>({useImageAspect:()=>({ratio:1,measuredRatio:null,onLoad:jest.fn()})}));
jest.mock('../../hooks/useFeedFrameAspect',()=>({useFeedFrameAspect:(_key:string,aspect:number)=>aspect}));
jest.mock('../../hooks/useSettledAutoplay',()=>({useSettledAutoplay:()=>false}));
jest.mock('../../libs/perfTrace',()=>({usePerfProbe:jest.fn()}));
jest.mock('../../context/ThemeContext',()=>({useAppTheme:()=>({isMinimal:false})}));
jest.mock('../../components/Home/feedBleed',()=>({useFeedBleed:()=>false}));
jest.mock('../../components/common/SmartImage',()=> 'Image');
jest.mock('../../components/Home/AltTextBadge',()=> 'Badge');

it.each([0.35, 1, 1.8])('centres aspect %s in the full-width photo viewer', aspect => {
 let ui!: ReturnType<typeof create>;
 act(()=>{ui=create(<ContainedFeedImage uri="https://example.com/photo.jpg" width={390} fallbackWidth={390} aspect={aspect} postPage />);});
 const [frame,photo]=ui.root.findAll(n=>String(n.type)==='View');
 expect(frame.props.style.alignItems).toBe('center');
 expect(photo.props.style.width).toBeLessThanOrEqual(frame.props.style.width);
 if(aspect<0.5) expect(photo.props.style.width).toBeLessThan(frame.props.style.width);
 expect(photo.props.style.width/photo.props.style.height).toBeCloseTo(aspect,2);
 act(()=>ui.unmount());
});
