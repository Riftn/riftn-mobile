import React, { useRef } from "react";

/**
 * A sheet, menu or dialog that sits closed on a screen is still rendered every
 * time that screen renders: its hooks run and its rows are built, for nothing
 * anyone can see. This holds one back until the first time it is opened.
 *
 * From then on it stays mounted, so its closing animation, its kept state and
 * its `onDismiss` behave exactly as they did.
 *
 *   <WhenOpened open={tipOpen}>
 *     {() => <TipSheet visible={tipOpen} onClose={closeTip} />}
 *   </WhenOpened>
 */
export function useOpenedOnce(open: boolean): boolean {
  const opened = useRef(open);
  if (open) opened.current = true;
  return opened.current;
}

const WhenOpened: React.FC<{ open: boolean; children: () => React.ReactNode }> = ({ open, children }) =>
  useOpenedOnce(open) ? <>{children()}</> : null;

export default WhenOpened;
