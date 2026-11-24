/**
 * The typing line in System Light.
 *
 * Text fields never set their own caret colour, so Android drew the theme's
 * default line, which nearly vanished on System Light's white page: people
 * editing a comment, a reply or a live chat line could not see where they
 * were typing.
 *
 * While System Light is on, a field that names no caret colour is handed the
 * dark themes' white here, before the colour pass (./tone.js) runs. That pass
 * turns it to ink on the light page and leaves it white on a picture or a
 * live video (`dark-surface`), so the line always matches the words. iPhone
 * keeps its own blue line, which already shows on white. Dark themes are left
 * exactly as they were.
 *
 * Plain JS on purpose: the JSX runtime loads before anything else in the app.
 */
const { isLightToneOn } = require("./tone");

let fields;
let android;

function isField(type) {
  if (!fields) {
    fields = new Set();
    const add = (load) => {
      try {
        const t = load();
        if (t) fields.add(t);
      } catch (_) {
        // Not in this build or test.
      }
    };
    add(() => require("react-native").TextInput);
    add(() => require("react-native-gesture-handler").TextInput);
  }
  return fields.has(type);
}

function caretProps(type, props) {
  if (!props || props.cursorColor !== undefined || !isLightToneOn()) return props;
  if (android === undefined) {
    const RN = require("react-native");
    android = !!RN && !!RN.Platform && RN.Platform.OS === "android";
  }
  if (!android || !isField(type)) return props;
  return { ...props, cursorColor: "#FFFFFF" };
}

module.exports = { caretProps };
