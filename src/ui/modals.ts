/**
 * Top-bar dialogs: how to play, and where the levels come from.
 *
 * These are dialogs rather than pages because navigating away mid-mission
 * throws the run away — the checkpoint, the timer and the hazard state all go
 * with the page. Opening one suspends the simulation instead.
 *
 * Uses the native `<dialog>` element so focus trapping and Escape-to-close come
 * from the platform, with a plain `open` attribute as the fallback for
 * environments without `showModal()`.
 */

export type ModalName = string;

export class Modals {
  private readonly dialogs = new Map<ModalName, HTMLDialogElement>();
  private onChange: ((open: boolean) => void) | undefined;

  constructor(root: ParentNode = document) {
    for (const dialog of root.querySelectorAll<HTMLDialogElement>("dialog[data-modal]")) {
      const name = dialog.dataset.modal;
      if (!name) continue;
      this.dialogs.set(name, dialog);
      dialog.addEventListener("close", () => this.onChange?.(this.isOpen));
      dialog.addEventListener("cancel", () => this.onChange?.(false));
      for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-close]")) {
        button.addEventListener("click", () => this.close(name));
      }
      // Clicking the backdrop closes: the dialog box itself is the only child
      // that receives clicks, so a click on the element is a click outside it.
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) this.close(name);
      });
    }

    for (const trigger of root.querySelectorAll<HTMLElement>("[data-opens-modal]")) {
      const name = trigger.dataset.opensModal;
      if (name) trigger.addEventListener("click", () => this.open(name));
    }
  }

  /** Notified whenever the open/closed state changes. */
  watch(handler: (open: boolean) => void): void {
    this.onChange = handler;
  }

  get isOpen(): boolean {
    return [...this.dialogs.values()].some((d) => d.open);
  }

  has(name: ModalName): boolean {
    return this.dialogs.has(name);
  }

  open(name: ModalName): void {
    const dialog = this.dialogs.get(name);
    if (!dialog || dialog.open) return;
    for (const [other, node] of this.dialogs) if (other !== name && node.open) this.close(other);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.scrollTop = 0;
    this.onChange?.(true);
  }

  close(name?: ModalName): void {
    const targets = name ? [this.dialogs.get(name)] : [...this.dialogs.values()];
    for (const dialog of targets) {
      if (!dialog?.open) continue;
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    this.onChange?.(this.isOpen);
  }
}

/** True while any dialog on the page is showing. Used to mute game input. */
export function anyDialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("dialog[open]") !== null;
}
