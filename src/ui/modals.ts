import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";

export interface PromptOptions {
  title: string;
  description?: string;
  initial?: string;
  placeholder?: string;
  submitLabel: string;
}

class TextPromptModal extends Modal {
  private opts: PromptOptions;
  private done: (value: string | null) => void;
  private value: string;

  constructor(app: App, opts: PromptOptions, done: (value: string | null) => void) {
    super(app);
    this.opts = opts;
    this.done = done;
    this.value = opts.initial ?? "";
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.title);
    if (this.opts.description) {
      this.contentEl.createEl("p", { text: this.opts.description, cls: "setting-item-description" });
    }
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "bridge-prompt-input",
      attr: { placeholder: this.opts.placeholder ?? "" },
    });
    input.value = this.value;
    input.addEventListener("input", () => (this.value = input.value));
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.submit();
      }
    });

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.opts.submitLabel).setCta().onClick(() => this.submit()));

    window.setTimeout(() => input.focus(), 0);
  }

  private submit(): void {
    this.done(this.value);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(null); // no-op if already submitted
  }
}

/** Resolves with the entered text, or null if cancelled. */
export function promptText(app: App, opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => new TextPromptModal(app, opts, resolve).open());
}

class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private confirmLabel: string;
  private done: (ok: boolean) => void;

  constructor(app: App, title: string, message: string, confirmLabel: string, done: (ok: boolean) => void) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.done = done;
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(this.confirmLabel).setWarning().onClick(() => {
          this.done(true);
          this.close();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(false);
  }
}

export function confirm(
  app: App,
  opts: { title: string; message: string; confirmLabel: string },
): Promise<boolean> {
  return new Promise((resolve) =>
    new ConfirmModal(app, opts.title, opts.message, opts.confirmLabel, resolve).open(),
  );
}

class ListPicker<T> extends FuzzySuggestModal<T> {
  private items: T[];
  private textOf: (item: T) => string;
  private done: (item: T | null) => void;

  constructor(
    app: App,
    items: T[],
    textOf: (item: T) => string,
    placeholder: string,
    done: (item: T | null) => void,
  ) {
    super(app);
    this.items = items;
    this.textOf = textOf;
    this.done = done;
    this.setPlaceholder(placeholder);
  }

  getItems(): T[] {
    return this.items;
  }

  getItemText(item: T): string {
    return this.textOf(item);
  }

  onChooseItem(item: T): void {
    this.done(item);
  }

  onClose(): void {
    super.onClose();
    // SuggestModal closes before it calls onChooseItem; defer so a real choice wins.
    window.setTimeout(() => this.done(null), 0);
  }
}

/** Resolves with the chosen item, or null if dismissed. */
export function pickFromList<T>(
  app: App,
  items: T[],
  textOf: (item: T) => string,
  placeholder: string,
): Promise<T | null> {
  return new Promise((resolve) => new ListPicker(app, items, textOf, placeholder, resolve).open());
}
