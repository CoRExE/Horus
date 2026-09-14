export type UpdatePlatform = 'android' | 'macos' | 'windows' | 'linux';
export interface UpdateTarget {
  platform: UpdatePlatform;
  architecture: 'arm64' | 'x64' | 'universal';
  version: string;
  versionCode?: number;
}
export interface UpdateAsset {
  architecture: UpdateTarget['architecture'];
  name: string;
  url: string;
  sha256: string;
  size: number;
}
export interface UpdateManifest {
  schemaVersion: 1;
  application: 'desktop' | 'mobile';
  platform: UpdatePlatform;
  version: string;
  versionCode?: number;
  tag: string;
  publishedAt: string;
  notes: string;
  releaseUrl: string;
  assets: UpdateAsset[];
}

export const UPDATE_BASE_URL = 'https://corexe.github.io/Horus/updates';
export const RELEASE_BASE_URL = 'https://github.com/CoRExE/Horus/releases';
export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;

function versionParts(value: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Version stable invalide.');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version invalide.');
  return parts;
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export function assetName(platform: UpdatePlatform, version: string, architecture: string, code?: number): string {
  if (platform === 'android' && architecture === 'universal') return `HorusRemote-${version}-${code}-android.apk`;
  if (platform === 'macos' && ['arm64', 'x64'].includes(architecture)) return `HorusDesktop-${version}-macos-${architecture}.dmg`;
  if (platform === 'windows' && architecture === 'x64') return `HorusDesktop-${version}-windows-x64.exe`;
  if (platform === 'linux' && architecture === 'x64') return `HorusDesktop-${version}-linux-x64.deb`;
  throw new Error('Plateforme ou architecture non prise en charge.');
}

export function parseUpdateManifest(value: unknown, platform: UpdatePlatform): UpdateManifest {
  const fail = (): never => { throw new Error('Manifeste de mise à jour invalide.'); };
  if (!value || typeof value !== 'object') return fail();
  const m = value as UpdateManifest;
  const application = platform === 'android' ? 'mobile' : 'desktop';
  if (m.schemaVersion !== 1 || m.application !== application || m.platform !== platform || typeof m.version !== 'string') return fail();
  versionParts(m.version);
  if (platform === 'android') {
    if (!Number.isSafeInteger(m.versionCode) || m.versionCode! < 1 || m.versionCode! > 2100000000) return fail();
  } else if (m.versionCode !== undefined) return fail();
  if (m.tag !== `${application}-v${m.version}` || m.releaseUrl !== `${RELEASE_BASE_URL}/tag/${m.tag}`) return fail();
  if (typeof m.publishedAt !== 'string' || !Number.isFinite(Date.parse(m.publishedAt))) return fail();
  if (typeof m.notes !== 'string' || m.notes.length > 16000) return fail();
  const architectures = platform === 'android' ? ['universal'] : platform === 'macos' ? ['arm64', 'x64'] : ['x64'];
  if (!Array.isArray(m.assets) || m.assets.length !== architectures.length) return fail();
  const seen = new Set<string>();
  for (const asset of m.assets) {
    if (!asset || !architectures.includes(asset.architecture) || seen.has(asset.architecture)) return fail();
    seen.add(asset.architecture);
    const name = assetName(platform, m.version, asset.architecture, m.versionCode);
    if (asset.name !== name || asset.url !== `${RELEASE_BASE_URL}/download/${m.tag}/${name}`) return fail();
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0) return fail();
  }
  return m;
}

export function selectUpdate(manifest: UpdateManifest, target: UpdateTarget): UpdateAsset | undefined {
  parseUpdateManifest(manifest, target.platform);
  assetName(target.platform, target.version, target.architecture, target.versionCode);
  const comparison = compareVersions(manifest.version, target.version);
  if (target.platform === 'android') {
    if (!Number.isSafeInteger(target.versionCode) || target.versionCode! < 1) throw new Error('Version Android installée inconnue.');
    if (comparison < 0 || manifest.versionCode! <= target.versionCode!) return;
  } else if (comparison <= 0) return;
  return manifest.assets.find((asset) => asset.architecture === target.architecture);
}

export type UpdateResult =
  | { kind: 'idle' | 'checking' | 'skipped' | 'current' | 'unavailable' }
  | { kind: 'available'; manifest: UpdateManifest; asset: UpdateAsset };

export interface UpdateTransportResponse { status: number; body: string }
export interface UpdateCheckerOptions {
  target: UpdateTarget;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  request: (url: string) => Promise<UpdateTransportResponse>;
  now?: () => number;
}

export function createUpdateChecker(options: UpdateCheckerOptions) {
  const { target, getItem, setItem, request } = options;
  const now = options.now ?? Date.now;
  const key = `horus-update-check-v1:${target.platform}:${target.architecture}:${target.version}:${target.versionCode ?? ''}`;
  let pending: Promise<UpdateResult> | undefined;
  let lastAttempt = 0;
  async function run(manual: boolean): Promise<UpdateResult> {
    try {
      const time = now();
      let saved = lastAttempt;
      try { saved = Math.max(saved, Number(await getItem(key)) || 0); } catch { /* storage is optional */ }
      if (!manual && saved > 0 && time >= saved && time - saved < UPDATE_INTERVAL) return { kind: 'skipped' };
      lastAttempt = time;
      try { await setItem(key, String(time)); } catch { /* still allow the check */ }
      // Bound the request even if the transport fails to abort on a lost network.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        request(`${UPDATE_BASE_URL}/${target.platform}.json`),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), 10000); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (response.status !== 200 || response.body.length > 64000) return { kind: 'unavailable' };
      const manifest = parseUpdateManifest(JSON.parse(response.body), target.platform);
      const asset = selectUpdate(manifest, target);
      return asset ? { kind: 'available', manifest, asset } : { kind: 'current' };
    } catch { return { kind: 'unavailable' }; }
  }
  return {
    check(manual = false): Promise<UpdateResult> {
      if (!pending) pending = run(manual).finally(() => { pending = undefined; });
      return pending;
    },
  };
}

export function desktopUpdateTarget(platform: string, architecture: string | undefined, version: string): UpdateTarget | undefined {
  if (!['macos', 'windows', 'linux'].includes(platform)) return;
  const arch = architecture === 'aarch64' ? 'arm64' : architecture === 'x86_64' ? 'x64' : undefined;
  if (!arch || (platform !== 'macos' && arch !== 'x64')) return;
  return { platform: platform as UpdatePlatform, architecture: arch, version };
}
