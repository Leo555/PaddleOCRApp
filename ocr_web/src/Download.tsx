import { useEffect, useMemo, useState } from 'react';

// GitHub 仓库 slug（owner/repo），用于拼接 Release 下载链接与查询 API。
// 部署时通过环境变量 VITE_GITHUB_REPO 注入（如 "your-org/ocr"）。
const REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || 'OWNER/REPO';
const REPO_CONFIGURED = REPO !== 'OWNER/REPO';

type OS = 'mac' | 'windows' | 'linux' | 'unknown';

type PlatformOS = Exclude<OS, 'unknown'>;
type Arch = 'arm64' | 'x64';

interface Build {
  /** 与 .github/workflows/build-app.yml 中的 asset 名严格一致。 */
  asset: string;
  os: OS;
  /** 仅 macOS 需要区分架构展示。 */
  arch?: Arch;
  title: string;
  hint: string;
}

// 桌面客户端各平台构建包。
const BUILDS: Build[] = [
  { asset: 'PaddleOCRApp-macos-arm64.zip', os: 'mac', arch: 'arm64', title: 'macOS · Apple Silicon', hint: 'M1 / M2 / M3 / M4 等 Apple 芯片' },
  { asset: 'PaddleOCRApp-macos-x64.zip', os: 'mac', arch: 'x64', title: 'macOS · Intel', hint: 'Intel 芯片的 Mac' },
  { asset: 'PaddleOCRApp-windows-x64.zip', os: 'windows', title: 'Windows', hint: '64 位 Windows 10 / 11' },
  { asset: 'PaddleOCRApp-linux-x64.tar.gz', os: 'linux', title: 'Linux', hint: '64 位主流发行版' },
];

// 操作系统选择 tab（顺序即展示顺序）。
const OS_TABS: { os: PlatformOS; label: string }[] = [
  { os: 'mac', label: 'macOS' },
  { os: 'windows', label: 'Windows' },
  { os: 'linux', label: 'Linux' },
];

function osNameOf(os: OS): string {
  return os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : '未知系统';
}

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

// 平台 logo（单色线性，跟随 currentColor），保持简约统一的视觉。
function PlatformIcon({ os }: { os: OS }) {
  if (os === 'windows') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.351" />
      </svg>
    );
  }
  if (os === 'linux') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139z" />
      </svg>
    );
  }
  // mac / unknown → Apple
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
    </svg>
  );
}

// 下载动作箭头。
function DownloadArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
    </svg>
  );
}

// 针对所选平台的安装/运行说明。
function RunHelp({ os }: { os: PlatformOS }) {
  if (os === 'windows') {
    return (
      <p className="dl-run-text">
        解压后运行文件夹内的 <code>PaddleOCRApp.exe</code>。若 SmartScreen 拦截，点「更多信息 → 仍要运行」。
      </p>
    );
  }
  if (os === 'linux') {
    return (
      <p className="dl-run-text">
        解压后运行 <code>PaddleOCRApp/PaddleOCRApp</code>（需具备 GUI 桌面环境）。
      </p>
    );
  }
  return (
    <p className="dl-run-text">
      解压得到 <code>PaddleOCRApp.app</code>，拖入「应用程序」。首次打开若提示「无法验证开发者」，在「系统设置 → 隐私与安全性」点「仍要打开」，或执行{' '}
      <code>xattr -dr com.apple.quarantine PaddleOCRApp.app</code>。
    </p>
  );
}

export default function Download({ onBack }: { onBack: () => void }) {
  const [os, setOs] = useState<OS>('unknown');
  // 用户在 tab 中选中的平台 / macOS 架构（默认值在检测到系统后同步）。
  const [selectedOs, setSelectedOs] = useState<PlatformOS>('mac');
  const [macArch, setMacArch] = useState<Arch>('arm64');

  // 最新 Release 信息。
  const [releaseState, setReleaseState] = useState<ReleaseState>(
    REPO_CONFIGURED ? 'loading' : 'error',
  );
  const [tag, setTag] = useState<string | null>(null);
  // 资产名 -> 下载地址与大小（来自 GitHub API，最准确）。
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({});
  // 待二次确认的下载项；为 null 时不显示确认弹窗。
  const [pending, setPending] = useState<{ title: string; asset: string; url: string; size?: number } | null>(null);

  // 用户在确认弹窗中点「确认下载」：以临时 <a> 触发下载，避免离开当前页面。
  function confirmDownload() {
    if (!pending) return;
    const a = document.createElement('a');
    a.href = pending.url;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPending(null);
  }

  useEffect(() => {
    const detected = detectOS();
    setOs(detected);
    if (detected !== 'unknown') setSelectedOs(detected); // 默认选中检测到的系统
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

  // 根据检测到的系统给出「推荐」的 tab（unknown 时不推荐）。
  const recommendedOs = useMemo<PlatformOS | null>(
    () => (os === 'unknown' ? null : os),
    [os],
  );

  // 当前选中平台（含 macOS 架构）对应的构建包。
  const currentBuild = useMemo<Build>(() => {
    if (selectedOs === 'mac') {
      return BUILDS.find((b) => b.os === 'mac' && b.arch === macArch) ?? BUILDS[0];
    }
    return BUILDS.find((b) => b.os === selectedOs) ?? BUILDS[0];
  }, [selectedOs, macArch]);

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
        <section className="dl-hero">
          <h1 className="dl-hero-title">下载 PaddleOCRApp</h1>
          <p className="dl-hero-sub">
            获得适用于 <b>{osNameOf(selectedOs)}</b> 的桌面客户端
            {releaseState === 'ready' && tag ? <> <b>{tag}</b></> : null}。模型已内置，
            <b>安装后完全离线使用</b>，支持截图取词、PDF 与剪贴板识别。
          </p>
          <div className="dl-chips">
            <span className="dl-chip">完全离线</span>
            <span className="dl-chip">截图取词</span>
            <span className="dl-chip">PDF 识别</span>
            <span className="dl-chip">剪贴板识别</span>
          </div>
        </section>

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

        {(() => {
          const cur = resolveAsset(currentBuild.asset);
          const clickable = cur.state === 'ready';
          const btnLabel =
            cur.state === 'loading'
              ? '查询版本中…'
              : cur.state === 'ready'
                ? `下载${cur.size ? `（${formatSize(cur.size)}）` : ''}`
                : cur.state === 'missing'
                  ? '该平台暂未发布'
                  : cur.state === 'none'
                    ? '暂无正式版本'
                    : '未配置仓库';
          return (
            <section className="dl-picker">
              <div className="dl-os-tabs" role="tablist" aria-label="选择操作系统">
                {OS_TABS.map((t) => (
                  <button
                    key={t.os}
                    type="button"
                    role="tab"
                    aria-selected={selectedOs === t.os}
                    className={`dl-os-tab ${selectedOs === t.os ? 'active' : ''}`}
                    onClick={() => setSelectedOs(t.os)}
                  >
                    <PlatformIcon os={t.os} />
                    <span>{t.label}</span>
                    {recommendedOs === t.os && <span className="dl-tab-rec">推荐</span>}
                  </button>
                ))}
              </div>

              <div className="dl-panel">
                {selectedOs === 'mac' && (
                  <div className="dl-arch" role="tablist" aria-label="选择芯片架构">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={macArch === 'arm64'}
                      className={macArch === 'arm64' ? 'active' : ''}
                      onClick={() => setMacArch('arm64')}
                    >
                      Apple Silicon
                      {recommendedOs === 'mac' && <span className="dl-arch-rec">推荐</span>}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={macArch === 'x64'}
                      className={macArch === 'x64' ? 'active' : ''}
                      onClick={() => setMacArch('x64')}
                    >
                      Intel
                    </button>
                  </div>
                )}

                <div className="dl-download">
                  <button
                    type="button"
                    className="dl-btn-primary"
                    disabled={!clickable}
                    onClick={() => {
                      if (!clickable || !cur.url) return;
                      setPending({ title: currentBuild.title, asset: currentBuild.asset, url: cur.url, size: cur.size });
                    }}
                  >
                    <DownloadArrow />
                    {btnLabel}
                  </button>
                  <div className="dl-download-info">
                    <span className="dl-file">{currentBuild.asset}</span>
                    <span className="dl-meta">{currentBuild.hint}</span>
                  </div>
                </div>

                <div className="dl-run">
                  <div className="dl-run-title">安装与运行</div>
                  <RunHelp os={selectedOs} />
                </div>
              </div>
            </section>
          );
        })()}

        <div className="dl-links">
          <span>
            下载的是<b>最新正式版本</b>
            {REPO_CONFIGURED && (
              <>
                ，也可查看{' '}
                <a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">
                  全部版本
                </a>{' '}
                /{' '}
                <a href={`https://github.com/${REPO}/actions`} target="_blank" rel="noreferrer">
                  最近构建
                </a>
                {releaseState === 'ready' && (
                  <>
                    {' '}/{' '}
                    <a
                      href={`https://github.com/${REPO}/releases/latest/download/SHA256SUMS.txt`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      SHA256 校验
                    </a>
                  </>
                )}
              </>
            )}
            。
          </span>
          <a
            className="dl-feedback"
            href="https://github.com/Leo555/PaddleOCRApp/issues/new"
            target="_blank"
            rel="noreferrer"
          >
            意见反馈
          </a>
        </div>
      </main>

      {pending && (
        <div className="modal-mask" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">确认下载</div>
            <div className="modal-body">
              即将下载 <strong>{pending.title}</strong> 客户端
              {pending.size ? `（${formatSize(pending.size)}）` : ''}：
              <br />
              <code>{pending.asset}</code>
              <br />
              文件来自 GitHub Releases，请确认后开始下载。
            </div>
            <div className="modal-actions">
              <button onClick={() => setPending(null)}>取消</button>
              <button className="primary" onClick={confirmDownload}>
                确认下载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
