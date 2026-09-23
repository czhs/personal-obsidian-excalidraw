import type { Mutable } from "@zsviczian/excalidraw/types/common/src/utility-types";
import type {
  ExcalidrawElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawImageElement,
} from "@zsviczian/excalidraw/types/element/src/types";
import type { PDFPageViewProps } from "src/types/embeddedFileLoaderTypes";

export type CodeBlockLanguage = "python" | "cpp" | "systemverilog";

/** Source code stored with a drawing element, including copied elements. */
export interface CodeBlockData {
  autocomplete: boolean;
  code: string;
  language: CodeBlockLanguage;
  version: 1;
}

/** Reads validated code-block metadata without modifying the scene. */
export function getCodeBlockData(
  element: ExcalidrawEmbeddableElement,
): CodeBlockData | null {
  const data: unknown = element.customData?.codeBlock;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    (record.language !== "python" &&
      record.language !== "cpp" &&
      record.language !== "systemverilog")
  )
    return null;
  return {
    autocomplete: record.autocomplete !== false,
    code: record.code,
    language: record.language,
    version: 1,
  };
}

export type ExcalidrawCustomDataValue =
  | string
  | number
  | boolean
  | null
  | ExcalidrawCustomDataValue[]
  | { [key: string]: ExcalidrawCustomDataValue };

export type ExcalidrawCustomData = Record<
  string,
  ExcalidrawCustomDataValue | undefined
>;

export type ExcalidrawCustomDataPatch = Partial<ExcalidrawCustomData>;

export type ExcalidrawPDFCustomData = ExcalidrawCustomData & {
  pdfPageViewProps?: PDFPageViewProps;
};

export type ExcalidrawLatexCustomData = ExcalidrawCustomData & {
  latex?: string;
  latexscale?: number;
};

export type ExcalidrawImageWithCustomData<
  TCustomData extends ExcalidrawCustomData = ExcalidrawCustomData,
> = ExcalidrawImageElement & {
  customData?: TCustomData;
};

export function addAppendUpdateCustomData(
  el: Mutable<ExcalidrawElement>,
  newData: ExcalidrawCustomDataPatch,
): ExcalidrawElement {
  if (!newData) {
    return el;
  }
  if (!el.customData) {
    el.customData = {};
  }
  for (const key in newData) {
    if (typeof newData[key] === "undefined") {
      delete el.customData[key];
      continue;
    }
    el.customData[key] = newData[key];
  }
  return el;
}
