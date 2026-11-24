import React from "react";

jest.mock("react-native-css-interop/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({ Text: "Text" }));

import { Text } from "react-native";
import { applyBold, stripBold } from "./bold-markup";

const flat = (nodes: React.ReactNode[]): string =>
  nodes.map((n) => {
    if (typeof n === "string") return n;
    const el = n as React.ReactElement<{ style?: { fontWeight?: string }; children?: React.ReactNode }>;
    const inner = flat(React.Children.toArray(el.props.children));
    return el.type === Text && el.props.style?.fontWeight ? `[b:${inner}]` : inner;
  }).join("");

describe("applyBold", () => {
  it("bolds a pair and hides the stars", () => {
    expect(flat(applyBold(["hello **big** world"]))).toBe("hello [b:big] world");
  });
  it("leaves unpaired stars alone", () => {
    expect(flat(applyBold(["2**3 and 4**5, just **one, ** loose **"]))).toBe("2**3 and 4**5, just **one, ** loose **");
  });
  it("wraps a mention element", () => {
    expect(flat(applyBold(["hi **", <Text key="m">@bob</Text>, "**"]))).toBe("hi [b:@bob]");
  });
  it("goes heavier inside heavy text", () => {
    const [node] = applyBold(["**x**"], { heavy: true }) as React.ReactElement<{ style: { fontWeight: string } }>[];
    expect(node.props.style.fontWeight).toBe("900");
  });
});

describe("stripBold", () => {
  it("drops only paired stars", () => {
    expect(stripBold("hello **big** world")).toBe("hello big world");
    expect(stripBold("2**3 **yes**")).toBe("2**3 yes");
  });
});
