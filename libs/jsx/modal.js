/**
 * Android pop-ups and the navigation bar.
 *
 * A Modal with `navigationBarTranslucent` draws edge to edge, and React Native
 * then styles its window's navigation bar from the phone's own light/dark
 * setting, not the app's theme, with a contrast scrim forced on. On a phone in
 * light mode every sheet, menu and dialog therefore laid a white bar with dark
 * buttons under itself, even in the app's dark themes (the long-press menu on
 * Messages, the tip sheet, ...).
 *
 * Every theme but System Light is dark, so on Android those pop-ups now keep
 * an ordinary window: the bar takes the dialog theme's black with light
 * buttons, and the content ends above it. System Light keeps the translucent
 * bar, whose white is right there.
 *
 * Plain JS on purpose: the JSX runtime loads before anything else in the app.
 */
const { isLightToneOn } = require("./tone");

let modal;
let android;

function modalProps(type, props) {
  // Only a Modal asking for a translucent bar is ever touched, so check that
  // before loading anything (tests mock react-native without Platform).
  if (!props || !props.navigationBarTranslucent) return props;
  if (android === undefined) {
    const RN = require("react-native");
    android = !!RN && !!RN.Platform && RN.Platform.OS === "android";
    modal = RN && RN.Modal;
  }
  if (!android || !modal || type !== modal || isLightToneOn()) return props;
  return { ...props, navigationBarTranslucent: false };
}

module.exports = { modalProps };
