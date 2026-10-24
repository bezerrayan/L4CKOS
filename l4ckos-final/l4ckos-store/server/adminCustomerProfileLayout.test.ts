import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss, { type AtRule, type Root } from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const componentPath = resolve(directory, "../client/src/components/admin/customers/AdminCustomersPanel.tsx");
const stylePath = resolve(directory, "../client/src/components/admin/customers/AdminCustomersPanel.css");

function jsxClassName(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  const attributes = node.openingElement.attributes;
  const classAttribute = attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === "className",
  );
  return classAttribute?.initializer && ts.isStringLiteral(classAttribute.initializer)
    ? classAttribute.initializer.text
    : "";
}

function hasCloseButton(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  return node.openingElement.attributes.properties.some(attribute =>
    ts.isJsxAttribute(attribute)
    && attribute.name.getText() === "aria-label"
    && attribute.initializer
    && ts.isStringLiteral(attribute.initializer)
    && attribute.initializer.text === "Fechar detalhes",
  );
}

function findJsxElements(source: ts.SourceFile, className: string) {
  const matches: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && jsxClassName(node).split(/\s+/).includes(className)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

function findMedia(root: Root, contains: string) {
  let match: AtRule | undefined;
  root.walkAtRules("media", rule => {
    if (rule.params.includes(contains)) match = rule;
  });
  return match;
}

function findRule(parent: Root | AtRule, selector: string) {
  let match: postcss.Rule | undefined;
  parent.walkRules(rule => {
    if (rule.parent === parent && rule.selector === selector) match = rule;
  });
  return match;
}

describe("AdminCustomersPanel profile layout", () => {
  it("places the order history inside the activity column beside customer identity", () => {
    const source = ts.createSourceFile(componentPath, readFileSync(componentPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const [header] = findJsxElements(source, "admin-customers__dialog-header");
    expect(header?.children.filter(ts.isJsxElement).some(hasCloseButton)).toBe(true);
    const [profileGrid] = findJsxElements(source, "admin-customers__profile-grid");
    expect(profileGrid).toBeDefined();

    const columns = profileGrid.children.filter(ts.isJsxElement);
    const identity = columns.find(node => jsxClassName(node).split(/\s+/).includes("admin-customers__profile-column--identity"));
    const activity = columns.find(node => jsxClassName(node).split(/\s+/).includes("admin-customers__profile-column--activity"));
    expect(identity).toBeDefined();
    expect(activity).toBeDefined();

    const activityChildren = activity?.children.filter(ts.isJsxElement) ?? [];
    expect(activityChildren.some(node => jsxClassName(node).split(/\s+/).includes("admin-customers__movement"))).toBe(true);
    expect(activityChildren.some(node => jsxClassName(node).split(/\s+/).includes("admin-customers__history-block"))).toBe(true);
    const identityChildren = identity?.children.filter(ts.isJsxElement) ?? [];
    expect(identityChildren.some(node => jsxClassName(node).split(/\s+/).includes("admin-customers__history-block"))).toBe(false);
  });

  it("uses bounded desktop columns and adapts the history rows before they can overflow", () => {
    const root = postcss.parse(readFileSync(stylePath, "utf8"));
    const header = findRule(root, ".admin-customers__dialog-header");
    expect(header?.nodes?.find(node => node.type === "decl" && node.prop === "grid-template-columns")?.value)
      .toBe("minmax(0, 1fr) auto");
    const modal = findRule(root, ".admin-customers__dialog");
    expect(modal?.nodes?.find(node => node.type === "decl" && node.prop === "height")?.value).toBe("auto");
    expect(modal?.nodes?.find(node => node.type === "decl" && node.prop === "max-height")?.value).toBe("calc(100dvh - 32px)");
    const desktopGrid = findRule(root, ".admin-customers__profile-grid");
    expect(desktopGrid?.nodes?.find(node => node.type === "decl" && node.prop === "grid-template-columns")?.value)
      .toContain("minmax(0, .38fr) minmax(0, .62fr)");

    const medium = findMedia(root, "1050px");
    const stackedGrid = medium && findRule(medium, ".admin-customers__profile-grid");
    expect(stackedGrid?.nodes?.find(node => node.type === "decl" && node.prop === "grid-template-columns")?.value)
      .toBe("minmax(0, 1fr)");

    const historyWrap = findRule(root, ".admin-customers__history-table-wrap");
    const historyTable = findRule(root, ".admin-customers__history-table");
    expect(historyWrap?.nodes?.find(node => node.type === "decl" && node.prop === "overflow-x")?.value).toBe("hidden");
    expect(historyTable?.nodes?.find(node => node.type === "decl" && node.prop === "min-width")?.value).toBe("0");

    const compact = findMedia(root, "850px");
    expect(compact && findRule(compact, ".admin-customers__history-table thead")?.nodes?.some(node => node.type === "decl" && node.prop === "display" && node.value === "none")).toBe(true);
    expect(compact && findRule(compact, ".admin-customers__history-table tr")?.nodes?.some(node => node.type === "decl" && node.prop === "display" && node.value === "grid")).toBe(true);
  });
});
