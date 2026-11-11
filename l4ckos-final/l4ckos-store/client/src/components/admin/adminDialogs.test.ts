// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { confirmDialog, promptDialog } from "./adminDialogs";

beforeAll(() => {
  // jsdom has no modal <dialog>; emulate showModal/close (the browser provides focus trap + Esc).
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, value?: string) {
    this.removeAttribute("open"); this.returnValue = value ?? ""; this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => { document.body.innerHTML = ""; });

const dialog = () => document.querySelector("dialog.l4-dialog") as HTMLDialogElement;
const click = (label: RegExp) => ([...dialog().querySelectorAll("button")].find(b => label.test(b.textContent ?? "")) as HTMLButtonElement).click();

describe("admin dialogs (replace window.confirm / window.prompt)", () => {
  it("is labelled and described for assistive technology", async () => {
    const result = confirmDialog({ title: "Excluir destaque", message: "Esta ação não pode ser desfeita.", tone: "danger", confirmLabel: "Excluir" });
    expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)!.textContent).toBe("Excluir destaque");
    expect(document.getElementById(dialog().getAttribute("aria-describedby")!)!.textContent).toBe("Esta ação não pode ser desfeita.");
    click(/Cancelar/);
    await result;
  });
  it("confirm resolves true only on the confirm action; cancel (and Esc) resolve false; the dialog is removed", async () => {
    const yes = confirmDialog({ message: "Continuar?" });
    click(/Confirmar/);
    expect(await yes).toBe(true);
    expect(dialog()).toBeNull();
    const no = confirmDialog({ message: "Continuar?" });
    click(/Cancelar/);
    expect(await no).toBe(false);
    const esc = confirmDialog({ message: "Continuar?" });
    dialog().close(""); // what the browser does on Esc
    expect(await esc).toBe(false);
  });
  it("destructive confirmations start focused on the SAFE action", async () => {
    const result = confirmDialog({ message: "Excluir?", tone: "danger", confirmLabel: "Excluir" });
    expect(document.activeElement).toBe([...dialog().querySelectorAll("button")].find(b => /Cancelar/.test(b.textContent ?? "")));
    click(/Cancelar/);
    await result;
  });
  it("prompt returns the typed value, or null when cancelled", async () => {
    const typed = promptDialog({ label: "Código", message: "Informe", defaultValue: "ABC" });
    const input = dialog().querySelector("input") as HTMLInputElement;
    expect(input.labels?.[0]?.textContent).toContain("Código");
    input.value = "BR999";
    click(/Confirmar/);
    expect(await typed).toBe("BR999");
    const cancelled = promptDialog({ label: "Código", message: "Informe" });
    click(/Cancelar/);
    expect(await cancelled).toBeNull();
  });
});
