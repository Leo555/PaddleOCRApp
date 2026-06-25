/**
 * 浏览器端 OCR 封装。
 *
 * 后端使用 @paddlejs-models/ocr —— 它运行的是 PaddleOCR 的 PP-OCR 检测/识别模型，
 * 通过 PaddleJS（WebGL）在浏览器里推理。模型从官方 CDN 拉取，识别全程在本地完成，
 * 图片不会上传到任何服务器。
 */
// 动态加载：@paddlejs-models/ocr 含约 905KB 内联 WASM，静态引入会让首屏 bundle
// 膨胀到 2MB。改为首次 initOcr() 时按需加载，Vite 会自动拆成独立 chunk——
// 下载页等无需 OCR 的场景零成本，OCR 页则与模型下载并行加载、用户基本无感。
type OcrModule = typeof import('@paddlejs-models/ocr');
let ocrModule: OcrModule | null = null;

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

/**
 * init 超时上限。init() 分两段：①下载 model.json/chunk 权重；②WebGL 预热
 * （上传纹理、编译着色器、跑一次空推理）。第②段无网络请求，弱机/集显上可达
 * 十几秒——这正是「网络都 200 了还在转圈」的原因。但若 WebGL 异常（context
 * lost、GPU 进程崩）init() 会永久 hang、UI 永远转圈也不报错。设一个宽松上限
 * 兜底：超时则 reject，让上层切到失败态引导用户刷新，而非无限等待。
 */
const INIT_TIMEOUT_MS = 120_000;

/** 加载模型（幂等）。首次调用会从 CDN 下载模型并做 WebGL 预热，耗时较长。 */
export function initOcr(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import('@paddlejs-models/ocr');
      ocrModule = mod;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                '模型初始化超时（网络较慢或设备性能受限），请刷新页面重试',
              ),
            ),
          INIT_TIMEOUT_MS,
        );
      });
      try {
        // init() 包含下载 + WebGL 预热；与超时竞速，任一先结算即返回。
        await Promise.race([mod.init(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      initialized = true;
    })().catch((err) => {
      initPromise = null; // 失败/超时后允许重试
      ocrModule = null;
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

  if (!ocrModule) throw new Error('OCR 模型尚未初始化');
  const start = performance.now();
  const res = await ocrModule.recognize(input);
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
