/** Dev twin of ./jsx-runtime.js — same passes in front of NativeWind's jsxDEV. */
const base = require("nativewind/jsx-dev-runtime");
const { controlProps } = require("./controls");
const { pressProps } = require("./press");
const { prepare } = require("./surface");
const { readableTextProps } = require("./readability");
const { modalProps } = require("./modal");

module.exports = {
  ...base,
  jsxDEV: function (type, props, ...rest) {
    const [t, p] = prepare(type, controlProps(readableTextProps(type, pressProps(type, modalProps(type, props)))));
    return base.jsxDEV(t, p, ...rest);
  },
  Fragment: base.Fragment,
};
