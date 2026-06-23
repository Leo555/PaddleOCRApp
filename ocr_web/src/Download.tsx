import { useEffect, useMemo, useState } from 'react';

// GitHub 仓库 slug（owner/repo），用于拼接 Release 下载链接与查询 API。
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
  { asset: 'PaddleOCRApp-windows-x64.zip', os: 'windows', title: 'Windows', hint: '64 位 Windows 10/11' },
  { asset: 'PaddleOCRApp-linux-x64.tar.gz', os: 'linux', title: 'Linux', hint: '64 位主流发行版' },
];

/** 最新 Release 资产的固定直链：始终指向最近一次正式版本（打 tag 触发）。 */
function downloadUrl(asset: string): string {
  return `https://github.com/${REPO}/releases/latest/download/${asset}`;
}

/** 人类可读的文件大小。 */
function formatSize(bytes?: number): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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

// 最新 Release 的查询状态：
// - loading: 正在向 GitHub API 查询
// - ready:   已拿到最新 Release（含 tag 与各资产信息）
// - none:    仓库尚无任何正式 Release（404）
// - error:   查询失败（网络/限流等）—— 退回静态 latest 直链，不阻断下载
type ReleaseState = 'loading' | 'ready' | 'none' | 'error';

interface AssetInfo {
  url: string;
  size: number;
}

export default function Download({ onBack }: { onBack: () => void }) {
  const [os, setOs] = useState<OS>('unknown');

  // 最新 Release 信息。
  const [releaseState, setReleaseState] = useState<ReleaseState>(
    REPO_CONFIGURED ? 'loading' : 'error',
  );
  const [tag, setTag] = useState<string | null>(null);
  // 资产名 -> 下载地址与大小（来自 GitHub API，最准确）。
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({});

  useEffect(() => {
    setOs(detectOS());
  }, []);

  // 查询最新 Release：拿到真实存在的资产、版本号与文件大小。
  useEffect(() => {
    if (!REPO_CONFIGURED) return;
    let alive = true;
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(async (r) => {
        if (r.status === 404) {
          if (alive) setReleaseState('none'); // 仓库还没有任何 Release
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any) => {
        if (!alive || !data) return;
        setTag(typeof data.tag_name === 'string' ? data.tag_name : null);
        const map: Record<string, AssetInfo> = {};
        for (const a of data.assets ?? []) {
          if (a?.name && a?.browser_download_url) {
            map[a.name] = { url: a.browser_download_url, size: a.size ?? 0 };
          }
        }
        setAssets(map);
        setReleaseState('ready');
      })
      .catch(() => {
        if (alive) setReleaseState('error'); // 失败不阻断：退回静态直链
      });
    return () => {
      alive = false;
    };
  }, []);

  // 计算「推荐」的那一项资产名。
  const recommended = useMemo<string | null>(() => {
    if (os === 'windows') return 'PaddleOCRApp-windows-x64.zip';
    if (os === 'linux') return 'PaddleOCRApp-linux-x64.tar.gz';
    if (os === 'mac') return 'PaddleOCRApp-macos-arm64.zip';
    return null;
  }, [os]);

  const osLabel =
    os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : '未知系统';

  // 解析单个平台包的可下载状态：
  // - 'ready'：可下载（ready 时有该资产，或 error 降级用静态直链）
  // - 'missing'：最新 Release 不含该平台包
  // - 'loading' / 'none' / 'unconfigured'：不可下载
  function resolveAsset(asset: string): { state: 'ready' | 'missing' | 'loading' | 'none' | 'unconfigured'; url?: string; size?: number } {
    if (!REPO_CONFIGURED) return { state: 'unconfigured' };
    if (releaseState === 'loading') return { state: 'loading' };
    if (releaseState === 'none') return { state: 'none' };
    if (releaseState === 'ready') {
      const a = assets[asset];
      return a ? { state: 'ready', url: a.url, size: a.size } : { state: 'missing' };
    }
    // error：API 查询失败，但 latest 静态直链通常仍可用，给出兜底链接。
    return { state: 'ready', url: downloadUrl(asset) };
  }

  // 版本徽标文案。
  const versionBadge =
    releaseState === 'loading'
      ? '查询版本中…'
      : releaseState === 'ready' && tag
        ? `最新版本 ${tag}`
        : releaseState === 'none'
          ? '暂无正式版本'
          : null;

  return (
    <div className="download">
      <header className="toolbar">
        <button onClick={onBack}>← 返回在线 OCR</button>
        <span className="spacer" />
        {versionBadge && <span className="badge">{versionBadge}</span>}
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

        {REPO_CONFIGURED && releaseState === 'none' && (
          <div className="dl-warn">
            该仓库尚未发布任何正式版本。请先打一个 <code>v*</code> 标签触发构建（详见{' '}
            <a href={`https://github.com/${REPO}/actions`} target="_blank" rel="noreferrer">
              Actions
            </a>
            ），发布到 Releases 后即可在此下载。
          </div>
        )}

        <div className="dl-grid">
          {BUILDS.map((b) => {
            const isRec = b.asset === recommended;
            const r = resolveAsset(b.asset);
            const clickable = r.state === 'ready';
            return (
              <a
                key={b.asset}
                className={`dl-card ${isRec ? 'rec' : ''} ${clickable ? '' : 'disabled'}`}
                href={clickable ? r.url : undefined}
                onClick={(e) => {
                  if (!clickable) e.preventDefault();
                }}
              >
                {isRec && <span className="dl-rec-tag">推荐</span>}
                <div className="dl-card-title">{b.title}</div>
                <div className="dl-card-hint">{b.hint}</div>
                <div className="dl-card-file">{b.asset}</div>
                <div className="dl-card-size">
                  {r.state === 'ready' && r.size ? formatSize(r.size) : ''}
                  {r.state === 'ready' && !r.size ? '可下载' : ''}
                  {r.state === 'loading' && '查询中…'}
                  {r.state === 'missing' && '该平台暂未发布'}
                  {r.state === 'none' && '暂未发布'}
                  {r.state === 'unconfigured' && '未配置仓库'}
                </div>
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
              {releaseState === 'ready' && (
                <>
                  {' '}校验完整性可对照 Release 中的{' '}
                  <a
                    href={`https://github.com/${REPO}/releases/latest/download/SHA256SUMS.txt`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    SHA256SUMS.txt
                  </a>
                  。
                </>
              )}
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

        <p className="dl-foot">
          有问题或建议？欢迎{' '}
          <a
            href="https://github.com/Leo555/PaddleOCRApp/issues/new"
            target="_blank"
            rel="noreferrer"
          >
            意见反馈
          </a>
          。
        </p>
      </main>
    </div>
  );
}
