/**
 * Makes everything except `keep` (and the ancestors leading to it) inert, so assistive tech and
 * keyboard cannot reach the page behind an open dialog while the kept elements stay operable.
 * Returns a function that restores the previous state.
 */
export function inertOutside(keep: Array<Element | null | undefined>): () => void {
  const targets = keep.filter((el): el is Element => Boolean(el));
  const ancestors = new Set<Element>();
  for (const target of targets) {
    for (let node = target.parentElement; node && node !== document.body; node = node.parentElement) ancestors.add(node);
  }
  const changed: Element[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (targets.includes(child)) continue;
      if (ancestors.has(child)) {
        walk(child);
      } else if (!child.hasAttribute("inert") && !["SCRIPT", "STYLE", "LINK"].includes(child.tagName)) {
        child.setAttribute("inert", "");
        changed.push(child);
      }
    }
  };
  walk(document.body);
  return () => changed.forEach(el => el.removeAttribute("inert"));
}
