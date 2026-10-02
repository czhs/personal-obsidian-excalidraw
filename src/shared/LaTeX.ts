import { DataURL } from "@zsviczian/excalidraw/types/excalidraw/types";
import { arrayBufferToBase64 } from "src/utils/fileUtils";
import { generateIdFromFile } from "./EmbeddedFileLoader";
import { localMathRenderer } from "./math/LocalMathRenderer";
import { TFile } from "obsidian";
import ExcalidrawView from "../view/ExcalidrawView";
import { FileData, MimeType } from "src/types/embeddedFileLoaderTypes";
import { FileId } from "@zsviczian/excalidraw/types/element/src/types";
import ExcalidrawPlugin from "src/core/main";
import type { ExcalidrawExtrasAPI } from "@zsviczian/excalidraw-extras-api";
import type { MathJaxRenderOptions } from "src/types/mathJaxTypes";

type Tex2DataURLWithOptions = (
  tex: string,
  scale?: number,
  preamble?: string | null,
  options?: MathJaxRenderOptions,
) => ReturnType<ExcalidrawExtrasAPI["mathjax"]["tex2dataURL"]>;

export const updateEquation = async (
  equation: string,
  fileId: FileId,
  view: ExcalidrawView,
  addFiles: (files: FileData[], view: ExcalidrawView) => void,
) => {
  // view.plugin gives us access to the gateway
  const data = await tex2dataURL(equation, 4, view.plugin);
  if (data) {
    const files: FileData[] = [];
    files.push({
      mimeType: data.mimeType,
      id: fileId,
      dataURL: data.dataURL,
      created: data.created,
      size: data.size,
      hasSVGwithBitmap: false,
      shouldScale: true,
    });
    addFiles(files, view);
  }
};

export async function tex2dataURL(
  tex: string,
  scale: number = 4,
  plugin: ExcalidrawPlugin,
  options?: MathJaxRenderOptions,
): Promise<{
  mimeType: MimeType;
  fileId: FileId;
  dataURL: DataURL;
  created: number;
  size: { height: number; width: number };
} | null> {
  // 2. Resolve Preamble File using cachedRead for performance
  let preambleStr: string | null = null;
  const preamblePath = plugin.settings.latexPreambleLocation || "preamble.sty";
  const preambleFile = plugin.app.vault.getFileByPath(preamblePath);

  if (preambleFile instanceof TFile) {
    preambleStr = await plugin.app.vault.cachedRead(preambleFile);
  }

  try {
    const rendered = localMathRenderer().render(tex, scale, preambleStr ?? "");
    const bytes = new TextEncoder().encode(rendered.svg).buffer;
    return {
      mimeType: "image/svg+xml",
      fileId: await generateIdFromFile(bytes),
      dataURL:
        `data:image/svg+xml;base64,${arrayBufferToBase64(bytes)}` as DataURL,
      created: Date.now(),
      size: { width: rendered.width, height: rendered.height },
    };
  } catch (error) {
    // Keep advanced Extras-only extensions working when that service is already active.
    const api = plugin.extrasGateway.getAPI();
    if (
      api?.features.isActive("mathjax") &&
      plugin.extrasGateway.checkVersion("mathjax", api).valid
    ) {
      const mathjaxAPIWithOptions: { tex2dataURL: Tex2DataURLWithOptions } =
        api.mathjax;
      return (await mathjaxAPIWithOptions.tex2dataURL(
        tex,
        scale,
        preambleStr,
        options,
      )) as Awaited<ReturnType<typeof tex2dataURL>>;
    }
    if (options?.throwOnError) throw error;
    return null;
  }
}

export const clearMathJaxVariables = (plugin: ExcalidrawPlugin) => {
  localMathRenderer().clear();
  const api = plugin.extrasGateway.getAPI();
  api?.mathjax?.clearMathJaxVariables();
};
