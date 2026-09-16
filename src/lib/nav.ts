/**
 * Which rail entry a path belongs to.
 *
 * The plain prefix rule lit "Projetos" for /projects/:id — which is the very
 * screen "Quadro" opens — so clicking Quadro landed on a page where Quadro was
 * dark and Projetos was lit, and the button looked broken. The list is
 * /projects alone; anything under a project id is a board, or a task open over
 * one, and both belong to Quadro.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/board") {
    return pathname === "/board" || pathname.startsWith("/projects/");
  }
  if (href === "/projects") {
    return pathname === "/projects";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
