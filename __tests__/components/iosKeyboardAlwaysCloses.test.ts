import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

// An iPhone has no back button, so a keyboard nothing closes is a dead end:
// it covers the tab bar and the page's own buttons. Number pads have no
// return key at all, and a page that scrolls is where people drag to get the
// keyboard out of the way.
describe("the iPhone keyboard can always be closed", () => {
  const patch = readSource("patches/react-native+0.83.10.patch");
  const textInput = readSource("node_modules/react-native/Libraries/Components/TextInput/TextInput.js");
  const scrollView = readSource("node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js");
  const search = readSource("screens/SearchScreen.tsx");

  it("is patched in JavaScript only", () => {
    expect(patch).toContain("a/node_modules/react-native/Libraries/Components/TextInput/TextInput.js");
    expect(patch).toContain("a/node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js");
    expect(patch).not.toMatch(/^diff --git .*\.(mm|m|h|kt|java)$/m);
  });

  it("gives every number pad a bar with one button that closes it", () => {
    expect(textInput).toContain("? global.__keyboardDoneLabel || 'Done'");
    expect(textInput).toContain("restProps.inputAccessoryViewID == null");
    expect(readSource("i18n/index.ts")).toContain("__keyboardDoneLabel = i18n.t('common.done')");
  });

  it("closes on a drag of an up-and-down list, unless the list says otherwise", () => {
    expect(scrollView).toContain("this.props.keyboardDismissMode ??");
    expect(scrollView).toContain("(Platform.OS === 'ios' && !horizontal ? 'on-drag' : undefined)");
  });

  it("leaves Android as it was", () => {
    expect(textInput).toContain("Platform.OS === 'ios' &&\n        restProps.inputAccessoryViewButtonLabel == null");
  });

  it("has an X in the Explore search pill while the keyboard is up", () => {
    expect(search).toContain('testID="explore-close-keyboard"');
    expect(search).toMatch(/\{inputFocused \? \(\s+<TouchableOpacity\s+testID="explore-close-keyboard"/);
    expect(search).toContain("Keyboard.dismiss();");
  });
});
