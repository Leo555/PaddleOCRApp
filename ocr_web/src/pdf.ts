// PDF 导入：用 pdfjs-dist 在浏览器端把每一页渲染成位图，供 OCR 识别。
//
// 说明：
// - PaddleJS 只能识别图片，PDF 需先栅格化成像素。这里把每页渲染到 canvas。
// - 渲染倍率 scale 影响识别清晰度：太小文字糊、太大太慢且占内存。默认 2x，
//   再按页面尺寸把渲染结果限制在 MAX_SIDE 以内，避免超大页面把内存撑爆。
import type * as PdfjsNs from 'pdfjs-dist';

/**
 * 懒加载 pdfjs：仅在用户真正上传 PDF 时才拉取主库与 worker。
 * pdfjs 主库 + worker（约 1.3MB）不进首屏 bundle，纯图片识别用户零成本。
 * 只初始化一次，后续调用复用同一 Promise。
 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist');
      // Vite 推荐用 ?url 拿到 worker 的最终构建地址，避免 ESM worker 解析问题。
      const { default: workerUrl } = await import(
        'pdfjs-dist/build/pdf.worker.min.mjs?url'
      );
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    })();
  }
  return pdfjsPromise;
}

/** 单页渲染后的位图最长边上限，与 ocr.ts 的下采样阈值保持一致。 */
const MAX_SIDE = 2048;
/** 期望的基础渲染倍率（相对 PDF 原始点尺寸）。 */
const BASE_SCALE = 2;

export interface PdfPage {
  /** 页码，从 1 开始。 */
  pageNumber: number;
  /** 渲染好的页面位图，可直接交给 recognize()。 */
  canvas: HTMLCanvasElement;
}

/**
 * PDF 已加密且未提供正确密码时抛出，由 UI 层捕获后向用户索要密码。
 * ``incorrect`` 为 true 表示已提供但密码错误，false 表示尚未提供密码。
 */
export class PdfPasswordRequired extends Error {
  constructor(public readonly incorrect: boolean) {
    super(incorrect ? 'PDF 密码错误。' : 'PDF 已加密，需要密码。');
    this.name = 'PdfPasswordRequired';
  }
}

/** 判断一个文件是否为 PDF（兼容部分浏览器 type 为空的情况）。 */
export function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

/**
 * 把 PDF 文件渲染成逐页位图。
 * @param file PDF 文件
 * @param onProgress 渲染进度回调（已完成页数 / 总页数）
 * @param password 加密 PDF 的打开密码（可选）
 */
export async function renderPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<PdfPage[]> {
  // 每次都重新读取 arrayBuffer：getDocument 会把 buffer 转移给 worker 而置空，
  // 输错密码重试时必须拿到一份新的 buffer，否则会因 detached 而失败。
  const buf = await file.arrayBuffer();
  const pdfjsLib = await loadPdfjs();
  let doc: PdfjsNs.PDFDocumentProxy;
  try {
    doc = await pdfjsLib.getDocument({ data: buf, password }).promise;
  } catch (err: any) {
    // pdfjs 对加密文档抛 PasswordException：code 1=需要密码，2=密码错误。
    if (err?.name === 'PasswordException') {
      throw new PdfPasswordRequired(
        err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD,
      );
    }
    throw err;
  }
  const pages: PdfPage[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      // 先按基础倍率取视口，再按 MAX_SIDE 收敛实际倍率。
      const base = page.getViewport({ scale: BASE_SCALE });
      const longSide = Math.max(base.width, base.height);
      const scale =
        longSide > MAX_SIDE ? (BASE_SCALE * MAX_SIDE) / longSide : BASE_SCALE;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布上下文');

      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();

      pages.push({ pageNumber: i, canvas });
      onProgress?.(i, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }

  return pages;
}
