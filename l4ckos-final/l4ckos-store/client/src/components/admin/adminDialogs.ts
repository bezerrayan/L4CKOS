/**
 * Accessible, branded replacements for window.confirm / window.prompt in the admin. Built on the native <dialog> element
 * (showModal): focus is trapped, the page behind is inert, Esc cancels and focus returns to the opener on close.
 * Same synchronous-looking contract as the originals, but Promise based (callers `await`).
 */
type DialogTone = "default" | "danger";

type BaseOptions = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: DialogTone };

let serial = 0;

function open<T>(options: BaseOptions & { input?: { defaultValue: string; label: string } }, read: (form: HTMLFormElement, accepted: boolean) => T): Promise<T> {
  return new Promise(resolve => {
    const id = `l4-dialog-${++serial}`;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement("dialog");
    dialog.className = `l4-dialog l4-dialog--${options.tone ?? "default"}`;
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.setAttribute("aria-describedby", `${id}-message`);
    const form = document.createElement("form");
    form.method = "dialog";
    form.noValidate = true;

    const title = document.createElement("h2");
    title.id = `${id}-title`;
    title.textContent = options.title ?? (options.input ? "Informe o valor" : "Confirmar ação");
    const message = document.createElement("p");
    message.id = `${id}-message`;
    message.className = "l4-dialog-message";
    message.textContent = options.message;
    form.append(title, message);

    let field: HTMLInputElement | null = null;
    if (options.input) {
      const label = document.createElement("label");
      label.className = "l4-dialog-field";
      label.htmlFor = `${id}-input`;
      label.textContent = options.input.label;
      field = document.createElement("input");
      field.id = `${id}-input`;
      field.type = "text";
      field.value = options.input.defaultValue;
      field.autocomplete = "off";
      label.append(field);
      form.append(label);
    }

    const actions = document.createElement("div");
    actions.className = "l4-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "l4-btn l4-btn--ghost";
    cancel.textContent = options.cancelLabel ?? "Cancelar";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = `l4-btn ${options.tone === "danger" ? "l4-btn--danger" : "l4-btn--primary"}`;
    confirm.textContent = options.confirmLabel ?? "Confirmar";
    actions.append(cancel, confirm);
    form.append(actions);
    dialog.append(form);

    let accepted = false;
    cancel.addEventListener("click", () => dialog.close("cancel"));
    form.addEventListener("submit", event => {
      event.preventDefault();
      accepted = true;
      dialog.close("ok");
    });
    dialog.addEventListener("close", () => {
      const result = read(form, accepted);
      dialog.remove();
      opener?.focus?.({ preventScroll: true });
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    // Destructive confirmations start on the SAFE action; prompts start in the field.
    (field ?? (options.tone === "danger" ? cancel : confirm)).focus();
    field?.select();
  });
}

export function confirmDialog(options: BaseOptions): Promise<boolean> {
  return open(options, (_form, accepted) => accepted);
}

/** Resolves with the typed text, or null when cancelled (same contract as window.prompt). */
export function promptDialog(options: BaseOptions & { label: string; defaultValue?: string }): Promise<string | null> {
  return open({ ...options, input: { label: options.label, defaultValue: options.defaultValue ?? "" } }, (form, accepted) =>
    accepted ? (form.querySelector("input") as HTMLInputElement).value : null);
}
