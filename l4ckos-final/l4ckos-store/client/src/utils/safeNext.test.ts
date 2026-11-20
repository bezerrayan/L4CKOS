import { describe, expect, it } from "vitest";
import { authPageUrl, sanitizeNextPath } from "./safeNext";

describe("sanitizeNextPath", () => {
  it("accepts internal paths, keeping query and hash", () => {
    expect(sanitizeNextPath("/checkout")).toBe("/checkout");
    expect(sanitizeNextPath("/produto/12?cor=preto#frete")).toBe("/produto/12?cor=preto#frete");
    expect(sanitizeNextPath("/meus-pedidos/7")).toBe("/meus-pedidos/7");
  });
  it.each([
    "//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example", "\\evil.example",
    "https://evil.example", "http://evil.example/x", "javascript:alert(1)", "data:text/html,x", "evil.example", "checkout",
    "/%2F%2Fevil.example", "/%5Cevil.example", "/ok\r\nLocation: https://evil.example", "/ok\tTab", "/ok with space", "/\u0000x",
    "/login", "/login?next=/checkout", "/cadastro", "/entrar", "/esqueci-senha", "/redefinir-senha?token=x",
    "", "   ", null, undefined, "/" + "a".repeat(600),
  ])("rejects %j", raw => {
    expect(sanitizeNextPath(raw as never)).toBe("/");
  });
  it("uses the supplied fallback", () => {
    expect(sanitizeNextPath("//evil.example", "/checkout")).toBe("/checkout");
  });
});

describe("authPageUrl", () => {
  it("adds an encoded, validated next", () => {
    expect(authPageUrl("/login", "/checkout")).toBe("/login?next=%2Fcheckout");
    expect(authPageUrl("/cadastro", "/produto/3?a=b")).toBe("/cadastro?next=%2Fproduto%2F3%3Fa%3Db");
  });
  it("omits next when it is the default or unsafe", () => {
    expect(authPageUrl("/login", "/")).toBe("/login");
    expect(authPageUrl("/login", "//evil.example")).toBe("/login");
    expect(authPageUrl("/cadastro", null)).toBe("/cadastro");
  });
});
