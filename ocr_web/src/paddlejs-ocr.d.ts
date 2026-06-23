// @paddlejs-models/ocr 未随包提供 TypeScript 类型声明，这里补一个最小声明。
declare module '@paddlejs-models/ocr' {
  /** 加载检测 + 识别模型（异步，模型从官方 CDN 拉取）。 */
  export function init(): Promise<void>;

  export interface RecognizeStyle {
    strokeStyle?: string;
    lineWidth?: number;
    fillStyle?: string;
  }

  export interface RecognizeOption {
    canvas?: HTMLCanvasElement;
    style?: RecognizeStyle;
  }

  export interface RecognizeResult {
    /** 每个文本框的识别文字。 */
    text: string[];
    /** 每个文本框的四个角点坐标 [[x,y],...]（基于原图像素）。 */
    points: number[][][];
  }

  export function recognize(
    img: HTMLImageElement | HTMLCanvasElement | ImageData,
    option?: RecognizeOption,
  ): Promise<RecognizeResult>;

  export function detect(
    img: HTMLImageElement | HTMLCanvasElement | ImageData,
  ): Promise<number[][][]>;
}
