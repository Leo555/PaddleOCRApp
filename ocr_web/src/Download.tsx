import { useEffect, useMemo, useState } from 'react';

// GitHub 仓库 slug（owner/repo），用于拼接 Release 下载链接。
// 部署时通过环境变量 VITE_GITHUB_REPO 注入（如 "your-org/ocr"）。
const REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || 'OWNER/REPO';
const REPO_CONFIGURED = REPO !== 'OWNER/REPO';

type OS = 'mac' | 'windows' | 'linux' | 'unknown';

interface Build {
  /** 与 .github/workflows/build-app.yml 中的 asset 名严格一致。 */
  asset: string;
  os: OS;
  title: string;
  hint: string;
}

// 桌面客户端各平台构建包。顺序即页面展示顺序。
const BUILDS: Build[] = [
  { asset: 'PaddleOCRApp-macos-arm64.zip', os: 'mac', title: 'macOS · Apple Silicon', hint: 'M1/M2/M3 等 Apple 芯片' },
  { asset: 'PaddleOCRApp-macos-x64.zip', os: 'mac', title: 'macOS · Intel', hint: 'Intel 芯片的 Mac' },
  { asset: 'PaddleOCRApp-windows-x64.zip', os: 'windows', title: 'Windows', hint: '64 位 Windows 10/11' },
  { asset: 'PaddleOCRApp-linux-x64.tar.gz', os: 'linux', title: 'Linux', hint: '64 位主流发行版' },
];

/** 最新 Release 资产的固定直链：始终指向最近一次正式版本（打 tag 触发）。 */
function downloadUrl(asset: string): string {
  return `https://github.com/${REPO}/releases/latest/download/${asset}`;
}

/** 尽力而为地识别用户操作系统（浏览器无法可靠拿到 CPU 架构）。 */
function detectOS(): OS {
  const uaData = (navigator as any).userAgentData;
  const platform: string = (uaData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (platform.includes('mac') || ua.includes('mac')) return 'mac';
  if (platform.includes('win') || ua.includes('win')) return 'windows';
  if (platform.includes('linux') || ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

export default function Download({ onBack }: { onBack: () => void }) {
  const [os, setOs] = useState<OS>('unknown');
  // 是否为 Apple Silicon：通过高熵 UA 数据异步探测，失败则默认推荐 arm64（近年新机为主）。
  const [appleArm, setAppleArm] = useState<boolean | null>(null);

  useEffect(() => {
    setOs(detectOS());
    const uaData = (navigator as any).userAgentData;
    if (uaData?.getHighEntropyValues) {
      uaData
        .getHighEntropyValues(['architecture'])
        .then((v: { architecture?: string }) => setAppleArm(v.architecture === 'arm'))
        .catch(() => setAppleArm(null));
    }
  }, []);

  // 计算「推荐」的那一项资产名。
  const recommended = useMemo<string | null>(() => {
    if (os === 'windows') return 'PaddleOCRApp-windows-x64.zip';
    if (os === 'linux') return 'PaddleOCRApp-linux-x64.tar.gz';
    if (os === 'mac') {
      // 明确探测到 Intel 才推荐 x64，否则默认 Apple Silicon。
      return appleArm === false ? 'PaddleOCRApp-macos-x64.zip' : 'PaddleOCRApp-macos-arm64.zip';
    }
    return null;
  }, [os, appleArm]);

  const osLabel =
    os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : '未知系统';

  return (
    <div className="download">
      <header className="toolbar">
        <h1 className="title">下载桌面客户端</h1>
        <button onClick={onBack}>← 返回在线 OCR</button>
        <span className="spacer" />
        <span className="badge">{`检测到：${osLabel}`}</span>
      </header>

      <main className="dl-main">
        <p className="dl-intro">
          桌面客户端（PaddleOCRApp）基于 PySide6，模型已内置，<strong>安装后可完全离线使用</strong>，支持截图取词、PDF 与剪贴板识别。
          下方已根据你的系统高亮推荐版本。
        </p>

        {!REPO_CONFIGURED && (
          <div className="dl-warn">
            尚未配置发布仓库（<code>VITE_GITHUB_REPO</code>），下载链接暂不可用。请在部署环境设置该变量为
            <code> owner/repo</code> 后重新构建。
          </div>
        )}

        <div className="dl-grid">
          {BUILDS.map((b) => {
            const isRec = b.asset === recommended;
            return (
              <a
                key={b.asset}
                className={`dl-card ${isRec ? 'rec' : ''} ${REPO_CONFIGURED ? '' : 'disabled'}`}
                href={REPO_CONFIGURED ? downloadUrl(b.asset) : undefined}
                onClick={(e) => {
                  if (!REPO_CONFIGURED) e.preventDefault();
                }}
              >
                {isRec && <span className="dl-rec-tag">推荐</span>}
                <div className="dl-card-title">{b.title}</div>
                <div className="dl-card-hint">{b.hint}</div>
                <div className="dl-card-file">{b.asset}</div>
              </a>
            );
          })}
        </div>

        <p className="dl-foot">
          下载的是<strong>最新正式版本</strong>（最近一次发布的 Release）。
          {REPO_CONFIGURED && (
            <>
              {' '}也可前往{' '}
              <a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">
                全部版本
              </a>{' '}
              或{' '}
              <a href={`https://github.com/${REPO}/actions`} target="_blank" rel="noreferrer">
                最近构建
              </a>{' '}
              查看其它版本。
            </>
          )}
        </p>

        <details className="dl-help">
          <summary>下载后如何运行？</summary>
          <ul>
            <li>
              <strong>macOS</strong>：解压得到 <code>PaddleOCRApp.app</code>，拖入「应用程序」。首次打开若提示「无法验证开发者」，
              在「系统设置 → 隐私与安全性」中点「仍要打开」，或对该 app 执行
              <code> xattr -dr com.apple.quarantine PaddleOCRApp.app</code>。
            </li>
            <li>
              <strong>Windows</strong>：解压后运行文件夹内的 <code>PaddleOCRApp.exe</code>。SmartScreen 拦截时选「仍要运行」。
            </li>
            <li>
              <strong>Linux</strong>：解压后运行 <code>PaddleOCRApp/PaddleOCRApp</code>（需具备 GUI 桌面环境）。
            </li>
          </ul>
        </details>
      </main>
    </div>
  );
}
