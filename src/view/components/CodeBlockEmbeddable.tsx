import {
  autocompletion,
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completeFromList,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import type { Mutable } from "@zsviczian/excalidraw/types/common/src/utility-types";
import type { ExcalidrawEmbeddableElement } from "@zsviczian/excalidraw/types/element/src/types";
import type { UIAppState } from "@zsviczian/excalidraw/types/excalidraw/types";
import { tags } from "@lezer/highlight";
import chroma from "chroma-js";
import * as React from "react";
import { mountCodeBlockArrowOverlay } from "src/utils/codeBlockArrowOverlay";
import { mountCodeBlockWheelForwarding } from "src/utils/codeBlockWheel";
import { t } from "src/lang/helpers";
import type ExcalidrawView from "src/view/ExcalidrawView";
import {
  getCodeBlockData,
  type CodeBlockData,
  type CodeBlockLanguage,
} from "src/utils/elementCustomDataUtils";

export const CODE_BLOCK_LINK = "excalidraw-codeblock://editor";

const sceneUpdate = Annotation.define<boolean>();

interface CodeBlockEmbeddableProps {
  appState: UIAppState;
  element: ExcalidrawEmbeddableElement;
  view: ExcalidrawView;
}

interface SystemVerilogState {
  blockComment: boolean;
  indentLevel: number;
  indentUnit: number;
}

const systemVerilogKeywords = new Set(
  (
    "always always_comb always_ff always_latch assign automatic begin break " +
    "case casex casez class clocking const constraint continue cover covergroup " +
    "default disable do else end endcase endclass endclocking endfunction " +
    "endgenerate endgroup endinterface endmodule endpackage endprogram endproperty " +
    "endsequence endtask enum event export extends extern final for foreach forever " +
    "fork function generate genvar if iff import initial inout input inside interface join join_any join_none " +
    "local localparam modport module new package packed parameter priority program " +
    "property protected pure rand randc ref repeat return sequence static struct task " +
    "this typedef union unique virtual wait while with"
  ).split(/\s+/u),
);

const systemVerilogTypes = new Set(
  (
    "bit byte chandle int integer logic longint real realtime reg shortint shortreal " +
    "signed string time unsigned var void wire"
  ).split(/\s+/u),
);

const systemVerilogBlockOpeners = new Set(
  (
    "begin case casex casez class clocking covergroup fork function generate " +
    "interface module package program property sequence task"
  ).split(/\s+/u),
);

const systemVerilogBlockClosers = new Set(
  (
    "end endcase endclass endclocking endfunction endgenerate endgroup join " +
    "join_any join_none endinterface endmodule endpackage endprogram endproperty " +
    "endsequence endtask"
  ).split(/\s+/u),
);

const systemVerilog = StreamLanguage.define<SystemVerilogState>({
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
    indentOnInput: /^\s*(?:end\w*|join(?:_any|_none)?)\b/u,
    autocomplete: completeFromList([
      ...Array.from(systemVerilogKeywords, (label) => ({
        label,
        type: "keyword",
      })),
      ...Array.from(systemVerilogTypes, (label) => ({ label, type: "type" })),
    ]),
  },
  startState: (indentUnit) => ({
    blockComment: false,
    indentLevel: 0,
    indentUnit,
  }),
  indent(state, textAfter) {
    const startsWithCloser = /^(?:end\w*|join(?:_any|_none)?)\b/u.test(
      textAfter.trimStart(),
    );
    return (
      Math.max(0, state.indentLevel - (startsWithCloser ? 1 : 0)) *
      state.indentUnit
    );
  },
  token(stream: StringStream, state: SystemVerilogState): string | null {
    if (state.blockComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.blockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (stream.eatSpace()) {
      return null;
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = true;
      return "comment";
    }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const character = stream.next();
        if (character === '"' && !escaped) {
          break;
        }
        escaped = character === "\\" && !escaped;
        if (character !== "\\") {
          escaped = false;
        }
      }
      return "string";
    }
    if (stream.match(/`[A-Za-z_][\w$]*/u)) {
      return "meta";
    }
    if (
      stream.match(
        /(?:(?:\d[\d_]*)?'[sS]?[bBoOdDhH][0-9a-fA-F_xXzZ?]+)|(?:'[01xXzZ])|(?:\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?)/u,
      )
    ) {
      return "number";
    }
    if (stream.match(/\$[A-Za-z_][\w$]*/u)) return "meta";
    if (stream.match(/\\\S+/u)) return "variableName";
    if (stream.match(/[A-Za-z_][\w$]*/u)) {
      const word = stream.current();
      if (systemVerilogBlockClosers.has(word)) {
        state.indentLevel = Math.max(0, state.indentLevel - 1);
      } else if (systemVerilogBlockOpeners.has(word)) {
        state.indentLevel += 1;
      }
      if (systemVerilogKeywords.has(word)) {
        return "keyword";
      }
      if (systemVerilogTypes.has(word)) {
        return "typeName";
      }
      if (word === "true" || word === "false" || word === "null") {
        return "bool";
      }
      return "variableName";
    }
    if (stream.match(/[+\-*/%=&|^~!<>?:]+/u)) {
      return "operator";
    }
    stream.next();
    return null;
  },
});

const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.name,
      tags.content,
      tags.literal,
      tags.punctuation,
      tags.bracket,
    ],
    class: "excalidraw-code-token-foreground",
  },
  { tag: tags.comment, class: "excalidraw-code-token-comment" },
  {
    tag: [tags.keyword, tags.definitionKeyword, tags.operatorKeyword],
    class: "excalidraw-code-token-keyword",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    class: "excalidraw-code-token-type",
  },
  {
    tag: [tags.function(tags.variableName), tags.definition(tags.variableName)],
    class: "excalidraw-code-token-function",
  },
  { tag: tags.string, class: "excalidraw-code-token-string" },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    class: "excalidraw-code-token-value",
  },
  { tag: tags.meta, class: "excalidraw-code-token-meta" },
  {
    tag: tags.operator,
    class: "excalidraw-code-token-foreground",
  },
  { tag: tags.variableName, class: "excalidraw-code-token-foreground" },
]);

const codeEditorBaseTheme = EditorView.theme({
  "&": {
    color: "var(--excalidraw-code-foreground)",
    backgroundColor: "transparent",
  },
  ".cm-content, .cm-line": {
    color: "var(--excalidraw-code-foreground)",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    color: "var(--excalidraw-code-foreground) !important",
    backgroundColor: "var(--excalidraw-code-active-line)",
  },
});

type CodeBlockThemeStyle = React.CSSProperties &
  Record<`--excalidraw-code-${string}`, string>;

function parseColor(value: string | undefined, fallback: string): string {
  if (!value || value === "transparent") {
    return fallback;
  }
  try {
    const color = chroma(value);
    return chroma.mix(fallback, color, color.alpha(), "rgb").hex();
  } catch {
    return fallback;
  }
}

function ensureContrast(
  preferred: string,
  background: string,
  minimum = 4.5,
): string {
  const foreground = chroma(preferred);
  if (chroma.contrast(foreground, background) >= minimum) {
    return foreground.hex();
  }

  const target =
    chroma.contrast("#ffffff", background) >=
    chroma.contrast("#000000", background)
      ? "#ffffff"
      : "#000000";
  for (let amount = 0.15; amount <= 1; amount += 0.05) {
    const candidate = chroma.mix(foreground, target, amount, "rgb");
    if (chroma.contrast(candidate, background) >= minimum) {
      return candidate.hex();
    }
  }
  return target;
}

function createCodeBlockTheme(
  element: ExcalidrawEmbeddableElement,
  appState: UIAppState,
): CodeBlockThemeStyle {
  const fallbackBackground = parseColor(
    appState.viewBackgroundColor,
    appState.theme === "dark" ? "#1e1e1e" : "#ffffff",
  );
  const background = parseColor(element.backgroundColor, fallbackBackground);
  const isDark = chroma(background).luminance() < 0.42;
  const preferredForeground = parseColor(
    element.strokeColor,
    isDark ? "#f0f3f6" : "#24292f",
  );
  const foreground = ensureContrast(preferredForeground, background);
  const mixTarget = isDark ? "#ffffff" : "#000000";
  const surface = chroma.mix(background, mixTarget, 0.075, "rgb").hex();
  const activeLine = chroma.mix(background, mixTarget, 0.11, "rgb").hex();
  const border = chroma.mix(background, foreground, 0.32, "rgb").hex();
  const muted = ensureContrast(
    chroma.mix(foreground, background, 0.38, "rgb").hex(),
    background,
    3,
  );
  const palette = isDark
    ? {
        comment: "#a8b3c2",
        keyword: "#ff7b72",
        type: "#d2a8ff",
        function: "#79c0ff",
        string: "#a5d6ff",
        value: "#79c0ff",
        meta: "#ffa657",
      }
    : {
        comment: "#57606a",
        keyword: "#cf222e",
        type: "#8250df",
        function: "#0550ae",
        string: "#0a3069",
        value: "#0550ae",
        meta: "#953800",
      };

  return {
    "--excalidraw-code-background": background,
    "--excalidraw-code-contrast-background": background,
    "--excalidraw-code-foreground": foreground,
    "--excalidraw-code-surface": surface,
    "--excalidraw-code-active-line": activeLine,
    "--excalidraw-code-border": border,
    "--excalidraw-code-muted": muted,
    "--excalidraw-code-selection": chroma
      .mix(background, isDark ? "#388bfd" : "#54aeff", 0.45, "rgb")
      .hex(),
    "--excalidraw-code-comment": ensureContrast(palette.comment, background),
    "--excalidraw-code-keyword": ensureContrast(
      palette.keyword,
      background,
      4.5,
    ),
    "--excalidraw-code-type": ensureContrast(palette.type, background),
    "--excalidraw-code-function": ensureContrast(
      palette.function,
      background,
      4.5,
    ),
    "--excalidraw-code-string": ensureContrast(palette.string, background),
    "--excalidraw-code-value": ensureContrast(palette.value, background),
    "--excalidraw-code-meta": ensureContrast(palette.meta, background),
  };
}

function languageExtension(language: CodeBlockLanguage): Extension {
  switch (language) {
    case "cpp":
      return cpp();
    case "systemverilog":
      return systemVerilog;
    case "json":
      return json();
    case "python":
    default:
      return python();
  }
}

/** Recognizes the live editor independently of the link label. */
export function isCodeBlockElement(
  element: ExcalidrawEmbeddableElement,
): boolean {
  return element.link === CODE_BLOCK_LINK || Boolean(getCodeBlockData(element));
}

/** Live CodeMirror editor rendered as an Excalidraw embeddable element. */
export function CodeBlockEmbeddable({
  appState,
  element,
  view,
}: CodeBlockEmbeddableProps): React.JSX.Element {
  const initialData = getCodeBlockData(element) ?? {
    autocomplete: true,
    code: "",
    language: "python",
    version: 1,
  };
  const [language, setLanguage] = React.useState<CodeBlockLanguage>(
    initialData.language,
  );
  const [autocompleteEnabled, setAutocompleteEnabled] = React.useState(
    initialData.autocomplete,
  );
  const initialDataRef = React.useRef(initialData);
  const languageRef = React.useRef(initialData.language);
  const autocompleteRef = React.useRef(initialData.autocomplete);
  const blockRef = React.useRef<HTMLDivElement>(null);
  const editorHostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<EditorView | null>(null);
  const languageCompartmentRef = React.useRef(new Compartment());
  const completionCompartmentRef = React.useRef(new Compartment());
  const themeStyle = createCodeBlockTheme(element, appState);

  React.useEffect(() => {
    if (!blockRef.current) return;
    return mountCodeBlockWheelForwarding(blockRef.current);
  }, []);

  React.useEffect(() => {
    if (!editorHostRef.current || !view.excalidrawAPI) return;
    return mountCodeBlockArrowOverlay(
      editorHostRef.current,
      element.id,
      view.excalidrawAPI,
      view.packages.excalidrawLib,
    );
  }, [element.id, view]);

  const persist = React.useCallback(
    (
      nextCode: string,
      nextLanguage: CodeBlockLanguage,
      nextAutocomplete: boolean,
    ) => {
      const liveElement = view.excalidrawAPI
        ?.getSceneElements()
        .find((candidate) => candidate.id === element.id) as
        | Mutable<ExcalidrawEmbeddableElement>
        | undefined;
      if (!liveElement) {
        return;
      }
      const saved = getCodeBlockData(liveElement);
      if (
        saved?.code === nextCode &&
        saved.language === nextLanguage &&
        saved.autocomplete === nextAutocomplete
      )
        return;
      view.excalidrawAPI.mutateElement(liveElement, {
        customData: {
          ...(liveElement.customData ?? {}),
          codeBlock: {
            autocomplete: nextAutocomplete,
            code: nextCode,
            language: nextLanguage,
            version: 1,
          } satisfies CodeBlockData,
        },
      });
    },
    [element.id, view],
  );

  React.useEffect(() => {
    const host = editorHostRef.current;
    if (!host) {
      return;
    }

    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDataRef.current.code,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          indentUnit.of("    "),
          bracketMatching(),
          closeBrackets(),
          completionCompartmentRef.current.of(
            initialDataRef.current.autocomplete
              ? autocompletion({ activateOnTyping: true })
              : [],
          ),
          codeEditorBaseTheme,
          syntaxHighlighting(codeHighlightStyle),
          languageCompartmentRef.current.of(
            languageExtension(initialDataRef.current.language),
          ),
          EditorState.allowMultipleSelections.of(true),
          highlightActiveLine(),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            { key: "Tab", run: acceptCompletion },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": t("CODE_BLOCK_EDITOR_ARIA"),
            autocapitalize: "off",
            autocomplete: "off",
            spellcheck: "false",
          }),
          EditorView.domEventHandlers({
            // Keep clipboard events inside CodeMirror while allowing its
            // built-in handlers to copy, cut, and paste the code selection.
            copy(event) {
              event.stopPropagation();
            },
            cut(event) {
              event.stopPropagation();
            },
            paste(event) {
              event.stopPropagation();
            },
            keydown(event) {
              if (event.key === "Escape" && !event.defaultPrevented) {
                event.preventDefault();
                editor.contentDOM.blur();
                view.updateScene({ appState: { activeEmbeddable: null } });
                view.excalidrawAPI?.setActiveTool({ type: "selection" });
                view.excalidrawContainer?.focus();
              }
              event.stopPropagation();
            },
            pointerdown(event) {
              event.stopPropagation();
            },
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(sceneUpdate),
              )
            ) {
              // Scene mutation is synchronous; the drawing's existing autosave
              // remains debounced. Copy/close immediately preserves every key.
              persist(
                update.state.doc.toString(),
                languageRef.current,
                autocompleteRef.current,
              );
            }
          }),
        ],
      }),
    });
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [element.id, persist, view]);

  // Undo, remote file refresh, and scene restoration can update a mounted block.
  React.useEffect(() => {
    const editor = editorRef.current;
    const data = getCodeBlockData(element);
    if (!editor || !data) return;
    const languageChanged = languageRef.current !== data.language;
    const autocompleteChanged = autocompleteRef.current !== data.autocomplete;
    languageRef.current = data.language;
    autocompleteRef.current = data.autocomplete;
    setLanguage(data.language);
    setAutocompleteEnabled(data.autocomplete);
    const codeChanged = editor.state.doc.toString() !== data.code;
    if (codeChanged || languageChanged || autocompleteChanged) {
      editor.dispatch({
        ...(codeChanged
          ? {
              changes: {
                from: 0,
                to: editor.state.doc.length,
                insert: data.code,
              },
            }
          : {}),
        effects: [
          ...(languageChanged
            ? [
                languageCompartmentRef.current.reconfigure(
                  languageExtension(data.language),
                ),
              ]
            : []),
          ...(autocompleteChanged
            ? [
                completionCompartmentRef.current.reconfigure(
                  data.autocomplete
                    ? autocompletion({ activateOnTyping: true })
                    : [],
                ),
              ]
            : []),
        ],
        annotations: [sceneUpdate.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [element.customData?.codeBlock]);

  const isActive =
    appState.activeEmbeddable?.element.id === element.id &&
    appState.activeEmbeddable?.state === "active";
  React.useEffect(() => {
    if (!isActive) {
      return;
    }
    const ownerWindow = editorHostRef.current?.ownerDocument.defaultView;
    const frame = ownerWindow?.requestAnimationFrame(() =>
      editorRef.current?.focus(),
    );
    return () => {
      if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
    };
  }, [isActive]);

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const nextLanguage = event.currentTarget.value as CodeBlockLanguage;
    languageRef.current = nextLanguage;
    setLanguage(nextLanguage);
    editorRef.current?.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        languageExtension(nextLanguage),
      ),
    });
    persist(
      editorRef.current?.state.doc.toString() ?? initialDataRef.current.code,
      nextLanguage,
      autocompleteRef.current,
    );
    editorRef.current?.focus();
  };

  const toggleAutocomplete = (): void => {
    const nextAutocomplete = !autocompleteRef.current;
    autocompleteRef.current = nextAutocomplete;
    setAutocompleteEnabled(nextAutocomplete);
    editorRef.current?.dispatch({
      effects: completionCompartmentRef.current.reconfigure(
        nextAutocomplete ? autocompletion({ activateOnTyping: true }) : [],
      ),
    });
    persist(
      editorRef.current?.state.doc.toString() ?? initialDataRef.current.code,
      languageRef.current,
      nextAutocomplete,
    );
    editorRef.current?.focus();
  };

  return (
    <div
      className="excalidraw-code-block"
      ref={blockRef}
      data-active={isActive}
      onPointerDown={(event) => event.stopPropagation()}
      style={themeStyle}
    >
      <div className="excalidraw-code-block__header">
        <span className="excalidraw-code-block__label">{"</>"}</span>
        <select
          aria-label={t("CODE_BLOCK_LANGUAGE_ARIA")}
          className="excalidraw-code-block__language"
          onChange={handleLanguageChange}
          onPointerDown={(event) => event.stopPropagation()}
          value={language}
        >
          <option value="python">{t("CODE_BLOCK_LANGUAGE_PYTHON")}</option>
          <option value="cpp">{t("CODE_BLOCK_LANGUAGE_CPP")}</option>
          <option value="json">{t("CODE_BLOCK_LANGUAGE_JSON")}</option>
          <option value="systemverilog">
            {t("CODE_BLOCK_LANGUAGE_SYSTEMVERILOG")}
          </option>
        </select>
        <button
          aria-label={t("CODE_BLOCK_AUTOCOMPLETE_ARIA")}
          aria-pressed={autocompleteEnabled}
          className="excalidraw-code-block__autocomplete"
          onClick={toggleAutocomplete}
          onPointerDown={(event) => event.stopPropagation()}
          title={
            autocompleteEnabled
              ? t("CODE_BLOCK_AUTOCOMPLETE_ON")
              : t("CODE_BLOCK_AUTOCOMPLETE_OFF")
          }
          type="button"
        >
          <span aria-hidden="true" className="excalidraw-code-block__status" />
          AC
        </button>
      </div>
      <div className="excalidraw-code-block__editor" ref={editorHostRef} />
    </div>
  );
}
