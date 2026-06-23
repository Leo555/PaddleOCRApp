import { useCallback, useEffect, useRef, useState } from 'react';
import { initOcr, recognize, type OcrLine } from './ocr';
import { isPdfFile, PdfPasswordRequired, renderPdf, type PdfPage } from './pdf';
import Download from './Download';

type ModelState = 'loading' | 'ready' | 'failed';

/** 识别源：普通图片或 PDF 渲染出的页面位图。 */
type Source = HTMLImageElement | HTMLCanvasElement;

/** 取得识别源的像素宽高（兼容 Image 的 naturalWidth 与 Canvas 的 width）。 */
function sourceSize(src: Source): { w: number; h: number } {
  if (src instanceof HTMLImageElement) {
    return { w: src.naturalWidth, h: src.naturalHeight };
  }
  return { w: src.width, h: src.height };
}

export default function App() {
  const [modelState, setModelState] = useState<ModelState>('loading');
  const [status, setStatus] = useState('正在加载 OCR 模型（首次较慢，模型来自 CDN）…');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [text, setText] = useState('');
  const [showBoxes, setShowBoxes] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  // PDF 多页：渲染好的页面与当前选中页码（从 0 起）。非 PDF 时为空数组。
  const [pdfPages, setPdfPages] = useState<PdfPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  // 页码输入框的受控值（字符串，便于编辑中允许临时空值）。
  const [pageInput, setPageInput] = useState('1');
  const [hasSource, setHasSource] = useState(false);
  // 加密 PDF 密码弹窗：null 表示不显示；incorrect 标记上一次密码是否错误。
  // 用自定义弹窗替代 window.prompt（嵌入式 WebView 不支持 prompt）。
  const [pwdPrompt, setPwdPrompt] = useState<{ incorrect: boolean } | null>(null);
  const [pwdInput, setPwdInput] = useState('');

  // 极简 hash 路由：#/download 显示下载页，其余显示在线 OCR。
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const sourceRef = useRef<Source | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 密码弹窗的 Promise resolver：提交/取消时调用，把结果回传给 loadPdf。
  const pwdResolverRef = useRef<((v: string | null) => void) | null>(null);

  // 弹出密码输入框并返回一个 Promise：用户提交返回密码字符串，取消返回 null。
  const requestPassword = useCallback((incorrect: boolean) => {
    return new Promise<string | null>((resolve) => {
      pwdResolverRef.current = resolve;
      setPwdInput('');
      setPwdPrompt({ incorrect });
    });
  }, []);

  const submitPassword = useCallback(() => {
    const resolve = pwdResolverRef.current;
    pwdResolverRef.current = null;
    setPwdPrompt(null);
    resolve?.(pwdInput);
  }, [pwdInput]);

  const cancelPassword = useCallback(() => {
    const resolve = pwdResolverRef.current;
    pwdResolverRef.current = null;
    setPwdPrompt(null);
    resolve?.(null);
  }, []);

  // ---- 模型预热 ---------------------------------------------------- //
  // 仅在线 OCR 页才加载模型；下载页（#/download）是纯静态页，无需拉取
  // 几十 MB 的 PaddleOCR 模型，否则会白白触发 CDN 请求。
  useEffect(() => {
    if (route === '#/download') return;
    let alive = true;
    initOcr()
      .then(() => {
        if (!alive) return;
        setModelState('ready');
        setStatus('模型已就绪，上传或粘贴图片即可识别。');
      })
      .catch((err) => {
        if (!alive) return;
        setModelState('failed');
        setStatus('模型加载失败：' + (err?.message ?? err));
      });
    return () => {
      alive = false;
    };
  }, [route]);

  // ---- 画布绘制 ---------------------------------------------------- //
  const draw = useCallback(
    (drawLines: OcrLine[]) => {
      const source = sourceRef.current;
      const canvas = canvasRef.current;
      if (!source || !canvas) return;
      const { w: sw, h: sh } = sourceSize(source);
      if (!sw) return;

      const maxW = 900; // 显示最大宽度
      const scale = Math.min(1, maxW / sw);
      const w = Math.round(sw * scale);
      const h = Math.round(sh * scale);
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);

      if (!showBoxes) return;
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(63,185,80,0.15)';
      for (const line of drawLines) {
        if (!line.points?.length) continue;
        ctx.beginPath();
        line.points.forEach(([px, py], i) => {
          const x = px * scale;
          const y = py * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
    [showBoxes],
  );

  useEffect(() => {
    draw(lines);
  }, [lines, showBoxes, draw]);

  // ---- 载入图片 ---------------------------------------------------- //
  const loadImageFromSrc = useCallback(
    (src: string, revokeAfterLoad = false) => {
      const img = new Image();

      const onReady = () => {
        if (revokeAfterLoad) URL.revokeObjectURL(src);
        setPdfPages([]);
        sourceRef.current = img;
        setHasSource(true);
        setLines([]);
        setText('');
        draw([]);
        // 不自动识别：与客户端一致，需手动点「开始识别」。
        setStatus(`已载入图片（${img.naturalWidth}×${img.naturalHeight}），点「开始识别」开始`);
      };
      const onFail = () => {
        if (revokeAfterLoad) URL.revokeObjectURL(src);
        setStatus('图片加载失败。');
      };

      img.src = src;
      // 用 decode() 在后台线程异步解码，避免粘贴大截图（Retina 数 MB PNG）时
      // 在主线程同步解码造成的「卡顿一下」。不支持 decode 时回退到 onload。
      if (typeof img.decode === 'function') {
        img.decode().then(onReady).catch(onFail);
      } else {
        img.onload = onReady;
        img.onerror = onFail;
      }
    },
    [draw],
  );

  // ---- 载入 PDF：渲染为逐页位图，默认展示第 1 页（不自动识别） -------- //
  const loadPdf = useCallback(
    async (file: File) => {
      setStatus('正在解析 PDF…');
      // 加密 PDF：循环向用户索要密码，直至成功或用户取消。
      let password: string | undefined;
      for (;;) {
        try {
          const pages = await renderPdf(
            file,
            (done, total) => setStatus(`正在渲染 PDF 第 ${done}/${total} 页…`),
            password,
          );
          if (!pages.length) {
            setStatus('PDF 没有可渲染的页面。');
            return;
          }
          setPdfPages(pages);
          setPageIndex(0);
          setPageInput('1');
          sourceRef.current = pages[0].canvas;
          setHasSource(true);
          setLines([]);
          setText('');
          draw([]);
          setStatus(`已载入 PDF（共 ${pages.length} 页），当前第 1 页，点「开始识别」识别当前页`);
          return;
        } catch (err: any) {
          if (err instanceof PdfPasswordRequired) {
            const input = await requestPassword(err.incorrect);
            if (input == null) {
              setStatus('已取消：未输入 PDF 密码。');
              return;
            }
            password = input;
            continue;
          }
          setStatus('PDF 解析失败：' + (err?.message ?? err));
          return;
        }
      }
    },
    [draw, requestPassword],
  );

  // ---- 切换 PDF 页：仅更新识别源与画布，不自动识别 ----------------- //
  const gotoPage = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= pdfPages.length || idx === pageIndex) return;
      setPageIndex(idx);
      setPageInput(String(idx + 1));
      sourceRef.current = pdfPages[idx].canvas;
      setLines([]);
      setText('');
      draw([]);
      setStatus(`第 ${idx + 1}/${pdfPages.length} 页，点「开始识别」识别当前页`);
    },
    [pdfPages, pageIndex, draw],
  );

  // ---- 页码输入框跳转：解析输入并 clamp 到合法范围 ------------------ //
  const jumpToInputPage = useCallback(() => {
    const n = parseInt(pageInput, 10);
    if (Number.isNaN(n)) {
      setPageInput(String(pageIndex + 1)); // 非法输入：还原为当前页
      return;
    }
    const idx = Math.min(Math.max(n, 1), pdfPages.length) - 1;
    if (idx === pageIndex) {
      setPageInput(String(pageIndex + 1)); // 越界但 clamp 回当前页：同步显示
    } else {
      gotoPage(idx);
    }
  }, [pageInput, pageIndex, pdfPages.length, gotoPage]);

  const loadFile = useCallback(
    (file: File) => {
      if (isPdfFile(file)) {
        void loadPdf(file);
        return;
      }
      if (!file.type.startsWith('image/')) {
        setStatus('请选择图片或 PDF 文件。');
        return;
      }
      // 用 object URL 替代 FileReader 的 base64 data URL：避免对大图做
      // base64 编码（体积 +33%、耗时、占内存），加载更快更省。
      const url = URL.createObjectURL(file);
      loadImageFromSrc(url, true);
    },
    [loadImageFromSrc, loadPdf],
  );

  // ---- 识别 -------------------------------------------------------- //
  const runOcr = useCallback(async () => {
    const source = sourceRef.current;
    if (!source) {
      setStatus('请先上传或粘贴一张图片 / PDF。');
      return;
    }
    if (busy) return;
    setBusy(true);
    setStatus('正在识别…');
    try {
      const res = await recognize(source);
      setLines(res.lines);
      setText(res.lines.map((l) => l.text).join('\n'));
      setStatus(`识别完成：${res.lines.length} 行，耗时 ${res.elapsed.toFixed(2)}s`);
    } catch (err: any) {
      setStatus('识别失败：' + (err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // ---- 粘贴 / 拖拽 ------------------------------------------------- //
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            loadFile(file);
            e.preventDefault();
          }
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  // ---- 导出 / 复制 ------------------------------------------------- //
  const copyAll = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus('已复制到剪贴板。');
  };

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportTxt = () => {
    if (!lines.length) return setStatus('没有可导出的结果。');
    download(text, 'ocr_result.txt', 'text/plain;charset=utf-8');
  };

  const exportJson = () => {
    if (!lines.length) return setStatus('没有可导出的结果。');
    const data = lines.map((l) => ({ text: l.text, box: l.points }));
    download(
      JSON.stringify(data, null, 2),
      'ocr_result.json',
      'application/json;charset=utf-8',
    );
  };

  const clearAll = () => {
    sourceRef.current = null;
    setHasSource(false);
    setPdfPages([]);
    setPageIndex(0);
    setPageInput('1');
    setLines([]);
    setText('');
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  // ---------------------------------------------------------------- //
  if (route === '#/download') {
    return (
      <Download
        onBack={() => {
          window.location.hash = '';
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <h1 className="title">在线 OCR</h1>
        <button onClick={() => fileInputRef.current?.click()}>打开图片 / PDF</button>
        <button
          className="primary"
          onClick={() => void runOcr()}
          disabled={busy || modelState !== 'ready'}
        >
          {busy ? '识别中…' : '开始识别'}
        </button>
        <label className="chk">
          <input
            type="checkbox"
            checked={showBoxes}
            onChange={(e) => setShowBoxes(e.target.checked)}
          />
          显示检测框
        </label>
        <span className="spacer" />
        <a className="dl-link" href="#/download">下载客户端</a>
        <span className={`badge ${modelState}`}>
          {modelState === 'loading' ? '模型加载中' : modelState === 'ready' ? '模型就绪' : '模型失败'}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
      </header>

      {pdfPages.length > 1 && (
        <div className="pager">
          <button
            onClick={() => gotoPage(pageIndex - 1)}
            disabled={busy || pageIndex === 0}
          >
            上一页
          </button>
          <span className="pager-info">
            第
            <input
              className="page-input"
              type="number"
              min={1}
              max={pdfPages.length}
              value={pageInput}
              disabled={busy}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              onBlur={jumpToInputPage}
            />
            / {pdfPages.length} 页
          </span>
          <button
            onClick={() => gotoPage(pageIndex + 1)}
            disabled={busy || pageIndex === pdfPages.length - 1}
          >
            下一页
          </button>
          <span className="pager-hint">输入页码回车可跳转 · 切页后点「开始识别」</span>
        </div>
      )}

      <main className="content">
        <section
          className={`viewer ${dragOver ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {hasSource ? (
            <canvas ref={canvasRef} className="canvas" />
          ) : (
            <div className="placeholder">
              <div>拖拽图片 / PDF 到此处 · 点击「打开图片 / PDF」· 或直接 Ctrl/⌘+V 粘贴图片</div>
              <div className="placeholder-hint">
                截图识别：用系统截图（macOS ⌃⌘⇧4 / Windows Win+Shift+S）截到剪贴板后，回到本页 Ctrl/⌘+V 粘贴即可
              </div>
            </div>
          )}
        </section>

        <section className="result">
          <div className="result-bar">
            <span>识别结果</span>
            <span className="spacer" />
            <button onClick={() => void copyAll()}>复制</button>
            <button onClick={exportTxt}>导出 TXT</button>
            <button onClick={exportJson}>导出 JSON</button>
            <button onClick={clearAll}>清空</button>
          </div>
          <textarea
            className="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="识别结果将显示在这里…"
          />
        </section>
      </main>

      <footer className="statusbar">{status}</footer>

      {pwdPrompt && (
        <div className="modal-mask" onMouseDown={cancelPassword}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {pwdPrompt.incorrect ? '密码错误，请重新输入' : '该 PDF 已加密'}
            </div>
            <div className="modal-body">请输入 PDF 打开密码：</div>
            <input
              className="modal-input"
              type="password"
              autoFocus
              value={pwdInput}
              onChange={(e) => setPwdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitPassword();
                else if (e.key === 'Escape') cancelPassword();
              }}
            />
            <div className="modal-actions">
              <button onClick={cancelPassword}>取消</button>
              <button className="primary" onClick={submitPassword}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
