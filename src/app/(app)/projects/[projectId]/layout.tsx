import type { ReactNode } from "react";

/**
 * The board, plus the slot the intercepted task view renders into. Everything
 * about the layout itself lives in the pages; this exists so a card can open a
 * task over the board without the board unmounting.
 */
export default function ProjectLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
