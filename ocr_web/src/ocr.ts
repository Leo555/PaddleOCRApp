/**
 * 浏览器端 OCR 封装。
 *
 * 后端使用 @paddlejs-models/ocr —— 它运行的是 PaddleOCR 的 PP-OCR 检测/识别模型，
 * 通过 PaddleJS（WebGL）在浏览器里推理。模型从官方 CDN 拉取，识别全程在本地完成，
 * 图片不会上传到任何服务器。
 */
import * as ocrModel from '@paddlejs-models/ocr';

export interface OcrLine {
  text: string;
  /** 四个角点 [[x, y], ...]，基于原图像素坐标。 */
  points: number[][];
}

export interface OcrResult {
  lines: OcrLine[];
  /** 识别耗时（秒）。 */
  elapsed: number;
}

let initialized = false;
let initPromise: Promise<void> | null = null;

/** 加载模型（幂等）。首次调用会从 CDN 下载模型，耗时较长。 */
export function initOcr(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (!initPromise) {
    initPromise = ocrModel
      .init()
      .then(() => {
        initialized = true;
      })
      .catch((err) => {
        initPromise = null; // 失败后允许重试
        throw err;
      });
  }
  return initPromise;
}

export function isReady(): boolean {
  return initialized;
}

/**
 * 识别前的最长边上限。Retina 截图分辨率常达 3000~5000px，直接喂给 WebGL
 * 推理既慢又长时间阻塞主线程；下采样到这个尺寸再识别，速度大幅提升，
 * 对文字清晰度几乎无损（检测框坐标会按比例还原回原图）。
 */
const MAX_SIDE = 2048;

/** 把一张 canvas 转成等尺寸的 HTMLImageElement。 */
function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('画布转图片失败'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画布转图片加载失败'));
      };
      img.src = url;
    }, 'image/png');
  });
}

/** 把过大的图片下采样成一张较小的 Image，返回新图与缩放比例。 */
function downscaleToImage(
  img: HTMLImageElement,
  ratio: number,
): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('无法创建画布上下文'));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToImage(canvas);
}

/** 对一张图片执行 OCR，返回行级文本与检测框。 */
export async function recognize(
  src: HTMLImageElement | HTMLCanvasElement,
): Promise<OcrResult> {
  await initOcr();

  // PaddleJS 内部预处理多处直接读取 naturalWidth/naturalHeight（无 width 回退），
  // 而 <canvas> 没有这两个属性（undefined），会导致临时画布尺寸异常、坐标计算 NaN、
  // 最终识别结果为空。因此先把 canvas 转成带正确 naturalWidth/Height 的 Image。
  const img: HTMLImageElement =
    src instanceof HTMLCanvasElement ? await canvasToImage(src) : src;

  // 超大图先下采样，减少 WebGL 推理耗时与主线程阻塞。
  let input: HTMLImageElement = img;
  let ratio = 1;
  if (img.naturalWidth && img.naturalHeight) {
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (maxSide > MAX_SIDE) {
      ratio = MAX_SIDE / maxSide;
      input = await downscaleToImage(img, ratio);
    }
  }

  const start = performance.now();
  const res = await ocrModel.recognize(input);
  const elapsed = (performance.now() - start) / 1000;

  const texts: string[] = Array.isArray(res?.text)
    ? res.text
    : res?.text
      ? [res.text as unknown as string]
      : [];
  const rawPoints: number[][][] = Array.isArray(res?.points) ? res.points : [];
  // 若下采样过，把检测框坐标还原回原图坐标系。
  const points: number[][][] =
    ratio === 1
      ? rawPoints
      : rawPoints.map((poly) => poly.map(([x, y]) => [x / ratio, y / ratio]));

  const lines: OcrLine[] = texts
    .map((t, i) => ({ text: (t ?? '').trim(), points: points[i] ?? [] }))
    .filter((l) => l.text.length > 0);

  return { lines, elapsed };
}
