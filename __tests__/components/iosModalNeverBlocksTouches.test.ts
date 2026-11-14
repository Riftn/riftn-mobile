import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

// iOS presents one modal per presenter. A second one asked for while another
// is up is dropped without telling React: it never appeared, and its empty,
// screen-sized host view then took every touch in the app once the first one
// closed (a new account got the photo sheet and, 20 seconds in, the
// notifications ask).
describe("a modal iOS did not present", () => {
  const patch = readSource("patches/react-native+0.83.10.patch");
  const modal = readSource("node_modules/react-native/Libraries/Modal/Modal.js");

  it("is patched in react-native's Modal, in JavaScript only", () => {
    expect(patch).toContain("a/node_modules/react-native/Libraries/Modal/Modal.js");
    expect(patch).not.toMatch(/^diff --git .*\.(mm|m|h|kt|java)$/m);
  });

  it("never takes touches through its host view", () => {
    expect(modal).toContain("pointerEvents={Platform.OS === 'ios' ? 'none' : undefined}");
  });

  it("asks again until it is up, and when another modal has closed", () => {
    expect(modal).toContain("unshownModals.add(this);");
    expect(modal).toContain("this._presentAgain(true);");
    expect(modal).toContain("presentUnshownModals();");
    expect(modal).toContain("this.props.visible === true && this.state.askingAgain === true");
  });

  it("stops asking once iOS reports it shown", () => {
    const onShow = modal.slice(modal.indexOf("const onShow = (event: any) => {"));
    expect(onShow.indexOf("this._shown = true;")).toBeGreaterThan(-1);
    expect(onShow.indexOf("this._stopWatchingPresentation();")).toBeLessThan(onShow.indexOf("this.props.onShow(event);"));
  });

  it("leaves Android as it was", () => {
    const watch = modal.slice(modal.indexOf("_watchPresentation() {"), modal.indexOf("_schedulePresentCheck() {"));
    expect(watch).toContain("if (Platform.OS !== 'ios') {\n      return;");
  });
});
