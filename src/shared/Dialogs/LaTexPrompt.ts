/** Visual equation entry with immediate typesetting and a source mode for existing LaTeX. */
import { App, ButtonComponent } from "obsidian";
import type { MathfieldElement } from "mathlive";
import type ExcalidrawPlugin from "src/core/main";
import { t } from "src/lang/helpers";
import { setElementHidden } from "src/utils/htmlUtils";
import { tex2dataURL } from "src/shared/LaTeX";
import { createVisualMathField } from "src/shared/math/VisualMathField";
import { FloatingModal } from "./FloatingModal";

const templates = [
  ["\\frac{#?}{#?}", "a/b"],
  ["#?^{#?}", "xⁿ"],
  ["\\sqrt{#?}", "√"],
  ["\\sum_{i=1}^{n} #?", "∑"],
  ["\\prod_{i=1}^{n} #?", "∏"],
  ["\\int_{a}^{b} #?\\,dx", "∫"],
  ["\\frac{\\partial #?}{\\partial #?}", "∂/∂x"],
  ["\\nabla_{\\boldsymbol{\\theta}} #?", "∇"],
  ["\\mathbf{#?}", "𝐱"],
  ["\\vec{#?}", "x⃗"],
  ["\\begin{bmatrix}#?\\\\#?\\\\#?\\end{bmatrix}", "[x;y]"],
  ["\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}", "[A]"],
  ["\\mathbb{E}_{#?}\\left[#?\\right]", "𝔼"],
  ["\\left\\lVert #?\\right\\rVert_2", "‖x‖"],
  ["#?^{\\mathsf{T}}", "xᵀ"],
  ["\\theta", "θ"],
] as const;

const activePrompts = new WeakMap<ExcalidrawPlugin, Set<LaTexPrompt>>();

export class LaTexPrompt extends FloatingModal {
  public waitForClose: Promise<string>;
  private resolvePromise: (value: string) => void;
  private rejectPromise: (reason?: string) => void;
  private field: MathfieldElement;
  private frame: HTMLIFrameElement;
  private sourceInput: HTMLTextAreaElement;
  private preview: HTMLImageElement;
  private status: HTMLDivElement;
  private submit: ButtonComponent;
  private formula: string;
  private sourceMode = false;
  private closed = false;
  private settled = false;
  private revision = 0;
  private timer: number;
  private validFormula = "";

  private constructor(
    private plugin: ExcalidrawPlugin,
    app: App,
    value: string,
  ) {
    super(app);
    let prompts = activePrompts.get(plugin);
    if (!prompts) {
      prompts = new Set<LaTexPrompt>();
      activePrompts.set(plugin, prompts);
      plugin.register(() => {
        for (const prompt of activePrompts.get(plugin) ?? []) prompt.close();
        activePrompts.delete(plugin);
      });
    }
    prompts.add(this);
    this.formula = value ?? "";
    this.waitForClose = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    this.enableKeyCapture();
    this.titleEl.setText(t("MATH_EDITOR_TITLE"));
    this.modalEl.addClass("excalidraw-math-modal");
    this.open();
  }
  static Prompt(
    plugin: ExcalidrawPlugin,
    app: App,
    _prompt?: string,
    value?: string,
  ): Promise<string> {
    return new this(plugin, app, value).waitForClose;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: t("MATH_EDITOR_HINT"),
      cls: "excalidraw-math-hint",
    });
    const modes = contentEl.createDiv({ cls: "excalidraw-math-modes" });
    const visual = new ButtonComponent(modes)
      .setButtonText(t("MATH_VISUAL"))
      .setCta();
    const source = new ButtonComponent(modes).setButtonText("LaTeX");
    const switchMode = (raw: boolean) => {
      this.sourceMode = raw;
      this.sourceInput.value = this.formula;
      if (this.field) this.field.value = this.formula;
      setElementHidden(this.frame, raw);
      setElementHidden(this.sourceInput, !raw);
      setElementHidden(this.preview, !raw || !this.preview.src);
      visual.buttonEl.toggleClass("mod-cta", !raw);
      source.buttonEl.toggleClass("mod-cta", raw);
      if (raw) this.sourceInput.focus();
      else this.field?.focus();
    };
    visual.onClick(() => switchMode(false));
    source.onClick(() => switchMode(true));
    const toolbar = contentEl.createDiv({ cls: "excalidraw-math-templates" });
    const names = t("MATH_TEMPLATE_NAMES").split("|");
    templates.forEach(([latex, label], index) => {
      const button = new ButtonComponent(toolbar)
        .setButtonText(label)
        .setTooltip(names[index]);
      button.buttonEl.setAttribute("aria-label", names[index]);
      button.onClick(() => {
        if (!this.field) return;
        switchMode(false);
        this.field.insert(latex, { selectionMode: "placeholder" });
        this.changed(this.field.value);
        this.field.focus();
      });
    });
    this.frame = contentEl.createEl("iframe", {
      cls: "excalidraw-math-field",
      attr: { title: t("MATH_VISUAL") },
    });
    this.sourceInput = contentEl.createEl("textarea", {
      cls: "excalidraw-math-source",
      attr: { "aria-label": "LaTeX", spellcheck: "false" },
    });
    this.sourceInput.value = this.formula;
    setElementHidden(this.sourceInput, true);
    this.sourceInput.oninput = () => this.changed(this.sourceInput.value);
    this.sourceInput.onkeydown = (event) => this.keydown(event);
    this.preview = contentEl.createEl("img", {
      cls: "excalidraw-math-preview",
      attr: { alt: t("MATH_PREVIEW") },
    });
    setElementHidden(this.preview, true);
    this.status = contentEl.createDiv({
      cls: "excalidraw-math-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.status.setText(t("MATH_LOADING"));
    const actions = contentEl.createDiv({ cls: "excalidraw-math-actions" });
    new ButtonComponent(actions)
      .setButtonText(t("PROMPT_BUTTON_CANCEL"))
      .onClick(() => this.close());
    this.submit = new ButtonComponent(actions)
      .setButtonText(t("MATH_INSERT"))
      .setCta()
      .setDisabled(true)
      .onClick(() => {
        void this.commit();
      });
    void this.initialize();
  }
  private async initialize() {
    try {
      this.field = await createVisualMathField(this.frame);
      if (this.closed) return;
      this.field.value = this.formula;
      this.field.addEventListener("input", () =>
        this.changed(this.field.value),
      );
      this.frame.contentDocument.addEventListener(
        "keydown",
        (event) => this.keydown(event),
        true,
      );
      if (this.sourceMode) this.sourceInput.focus();
      else this.field.focus();
      this.changed(this.formula);
    } catch (error) {
      if (!this.closed) this.status.setText(String(error));
    }
  }
  private keydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void this.commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }
  private changed(value: string) {
    this.formula = value;
    this.revision++;
    this.validFormula = "";
    this.submit.setDisabled(true);
    this.status.setText(
      value.trim() ? t("MATH_CHECKING") : t("MATH_EDITOR_HINT"),
    );
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.validate();
    }, 70);
  }
  private async validate(): Promise<boolean> {
    const revision = this.revision;
    const formula = this.formula.trim();
    if (!formula || /\\placeholder\b/.test(formula)) {
      if (!this.closed) this.status.setText(t("MATH_FILL_FIELDS"));
      return false;
    }
    try {
      const result = await tex2dataURL(formula, 1, this.plugin, {
        throwOnError: true,
      });
      if (this.closed || revision !== this.revision) return false;
      if (!result) throw new Error(t("MATH_INVALID"));
      this.validFormula = this.formula;
      this.preview.src = result.dataURL;
      setElementHidden(this.preview, !this.sourceMode);
      this.submit.setDisabled(false);
      this.status.setText(t("MATH_READY"));
      return true;
    } catch (error) {
      if (!this.closed && revision === this.revision) {
        this.status.setText(
          error instanceof Error ? error.message : t("MATH_INVALID"),
        );
        this.submit.setDisabled(true);
      }
      return false;
    }
  }
  private async commit() {
    if (this.settled || this.closed) return;
    window.clearTimeout(this.timer);
    if (this.validFormula !== this.formula && !(await this.validate())) return;
    if (this.closed || this.settled || !this.formula.trim()) return;
    this.settled = true;
    this.resolvePromise(this.formula.trim());
    this.close();
  }
  onClose() {
    if (this.closed) return;
    this.closed = true;
    activePrompts.get(this.plugin)?.delete(this);
    window.clearTimeout(this.timer);
    if (!this.settled) this.rejectPromise("Canceled input");
    // Removing the iframe releases MathLive's realm, listeners, and loaded fonts.
    this.contentEl.empty();
    this.field = null;
  }
}
