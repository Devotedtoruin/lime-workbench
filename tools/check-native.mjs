// Read-only preflight. Never install tools, initialize Android, compile Rust, sign or publish.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const nativeInputs = ['Cargo.toml', 'build.rs', 'tauri.conf.json', 'capabilities/default.json', 'src/lib.rs', 'src/main.rs'];
const iconInputs = ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.ico'];
const nativeCsp = new Map([
  ['default-src', "'self'"], ['script-src', "'self'"], ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob:"], ['media-src', "'self' blob:"], ['font-src', "'self' blob:"],
  ['connect-src', "'self' ipc: http://ipc.localhost https: http://127.0.0.1:* http://localhost:* http://[::1]:*"],
  ['object-src', "'none'"], ['frame-src', "'none'"], ['base-uri', "'self'"], ['form-action', "'none'"]
]);
function matchesNativeCsp(value) {
  if (typeof value !== 'string') return false;
  const directives = value.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]);
  return directives.length === nativeCsp.size &&
    new Set(directives.map(([name]) => name)).size === directives.length &&
    directives.every(([name, ...sources]) => nativeCsp.get(name) === sources.join(' '));
}

export function inspectNativeConfiguration({ config, capability, packageVersion, cargoText, files = [] }) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  const present = new Set(files);
  add('inputs', nativeInputs.every(p => present.has(p)), 'All six native configuration/entry files must exist.');
  const cargoVersion = cargoText?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  add('version', config?.version === packageVersion && cargoVersion === packageVersion, 'package.json, Cargo.toml and tauri.conf.json versions must agree.');
  add('identifier', config?.identifier === 'app.lime.workbench', 'Stable application ID: app.lime.workbench; changing it can isolate existing data.');
  add('frontend', config?.build?.frontendDist === '../dist', 'Bundle dist only, never the repository root.');
  add('build-hook', config?.build?.beforeBuildCommand === 'npm run build', 'Build hook produces the Vue bundle into dist from the frontend project root.');
  const dev = config?.build?.beforeDevCommand;
  add('dev-hook', config?.build?.devUrl === 'http://127.0.0.1:5173' && dev?.script === 'npm run dev' && dev?.wait === false && dev?.cwd == null, 'Development hook starts the Vite server without waiting for it to exit.');
  add('icons', iconInputs.every(p => present.has(p)) && iconInputs.every(p => config?.bundle?.icon?.includes(p)), 'Native PNG and ICO icons must exist; SVG alone is not a native icon set.');
  const window = config?.app?.windows?.[0];
  add('window', config?.app?.windows?.length === 1 && window?.label === 'main' && window?.transparent === false && window?.width === 1280 && window?.height === 820, 'Single normal window; glass is CSS, not OS window transparency.');
  add('capabilities', capability?.identifier === 'main-local' && capability?.local === true && capability?.remote == null && JSON.stringify(capability?.windows) === '["main"]' && JSON.stringify(capability?.permissions) === '["core:default"]' && JSON.stringify(config?.app?.security?.capabilities) === '["main-local"]', 'Local main only; no filesystem, shell, notification plugins or remote privileges.');
  add('asset-protocol', config?.app?.security?.assetProtocol?.enable === false && config?.app?.security?.assetProtocol?.scope?.length === 0, 'Do not expose arbitrary local files through an asset protocol.');
  for (const key of ['csp', 'devCsp']) {
    add(key, matchesNativeCsp(config?.app?.security?.[key]), 'Local scripts and local data/blob media/fonts only; HTTPS and explicit loopback APIs, no remote images, frames or eval.');
  }
  const windows = config?.bundle?.windows;
  add('windows-installer', JSON.stringify(config?.bundle?.targets) === '["nsis"]' && windows?.nsis?.installMode === 'currentUser' && JSON.stringify(windows?.nsis?.languages) === '["SimpChinese"]' && windows?.webviewInstallMode?.type === 'downloadBootstrapper', 'Chinese per-user NSIS; missing WebView2 downloads require network.');
  add('android-config', config?.bundle?.android?.minSdkVersion === 24 && config?.bundle?.android?.versionCode === 1000000, 'Android settings are configuration, not evidence of a built or signed APK.');
  add('minimal-rust', /tauri-build\s*=\s*\{\s*version\s*=\s*"2"/.test(cargoText || '') && /tauri\s*=\s*\{\s*version\s*=\s*"2"/.test(cargoText || '') && !/tauri-plugin-/.test(cargoText || ''), 'Tauri 2 only; no privileged plugins.');
  return checks;
}

export function summarizeReadiness({ platform, configuration, environment }) {
  const missing = [...configuration, ...environment].filter(check => !check.ok).map(check => check.id);
  return {
    platform,
    status: missing.length ? 'blocked' : 'prerequisites-detected',
    exitCode: missing.length ? 2 : 0,
    nativeBuildVerified: false,
    configuration,
    environment,
    missing,
    nextStep: missing.length ? 'Resolve missing prerequisites only after user approval. No tools were installed and no native build was run.' : 'Static configuration and prerequisite presence passed; compilation, signing, installation and device behavior remain unverified.'
  };
}

function probe(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 12000, windowsHide: true, shell: false });
  return { ok: !result.error && result.status === 0, detail: (result.stdout || result.stderr || result.error?.message || `exit ${result.status}`).trim().slice(0, 500) };
}
function directories(path) {
  try { return readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(path, e.name)); }
  catch { return []; }
}
function isDirectory(path) {
  try { return Boolean(path) && statSync(path).isDirectory(); }
  catch { return false; }
}
function loadConfiguration(root) {
  const checks = [];
  const load = (file, parse = value => value) => {
    try { return parse(readFileSync(join(root, file), 'utf8')); }
    catch (error) { checks.push({ id: `read:${file}`, ok: false, detail: error.message }); return null; }
  };
  const pkg = load('package.json', JSON.parse);
  const config = load('src-tauri/tauri.conf.json', JSON.parse);
  const capability = load('src-tauri/capabilities/default.json', JSON.parse);
  const cargoText = load('src-tauri/Cargo.toml');
  const files = [...nativeInputs, ...iconInputs].filter(p => existsSync(join(root, 'src-tauri', p)));
  return [...checks, ...inspectNativeConfiguration({ config, capability, packageVersion: pkg?.version, cargoText, files })];
}
function checkEnvironment(platform, env = process.env) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  for (const command of ['node', 'rustc', 'cargo']) {
    const result = probe(command);
    add(command, result.ok, result.detail);
  }
  const cargoTauri = probe('cargo', ['tauri', '--version']);
  const standalone = cargoTauri.ok ? cargoTauri : probe('tauri');
  add('tauri-cli', standalone.ok && /tauri(?:-cli)?\s+2\./i.test(standalone.detail), standalone.detail);
  if (platform === 'windows') {
    add('windows-host', process.platform === 'win32', 'This configuration expects a Windows host for NSIS builds; cross-compilation is not validated.');
    const programFiles = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const vsRoots = [join(programFiles, 'Microsoft Visual Studio'), join(env.ProgramFiles || 'C:/Program Files', 'Microsoft Visual Studio')];
    const vcRoots = [env.VCToolsInstallDir, ...vsRoots.flatMap(root => directories(root).flatMap(year => directories(year).flatMap(edition => directories(join(edition, 'VC/Tools/MSVC')))))].filter(Boolean);
    add('msvc-tools', vcRoots.some(root => existsSync(join(root, 'bin/Hostx64/x64/cl.exe')) && existsSync(join(root, 'bin/Hostx64/x64/link.exe'))), 'Detect C++ x64 compiler/linker files in Visual Studio or VCToolsInstallDir; presence is not a compilation test.');
    const sdk = env.WindowsSdkDir || join(programFiles, 'Windows Kits/10');
    add('windows-sdk', directories(join(sdk, 'Include')).some(version => existsSync(join(version, 'um/Windows.h'))) && directories(join(sdk, 'Lib')).some(version => existsSync(join(version, 'um/x64/kernel32.lib'))), 'Windows SDK headers and x64 libraries must exist.');
  } else {
    const java = probe('java');
    add('java', java.ok && Number(java.detail.match(/(?:java|openjdk)\s+(?:version\s+)?"?(\d+)/i)?.[1]) >= 17, java.detail || 'JDK 17+ required.');
    const javaHome = env.JAVA_HOME;
    add('java-home', isDirectory(javaHome) && (existsSync(join(javaHome, 'bin/java.exe')) || existsSync(join(javaHome, 'bin/java'))) && (existsSync(join(javaHome, 'bin/javac.exe')) || existsSync(join(javaHome, 'bin/javac'))), 'JAVA_HOME must point to a JDK with javac, not just a JRE or unconfigured java on PATH.');
    const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
    add('android-sdk', isDirectory(sdk) && directories(join(sdk || '', 'platforms')).some(p => existsSync(join(p, 'android.jar'))) && directories(join(sdk || '', 'build-tools')).some(p => existsSync(join(p, 'aapt2.exe')) || existsSync(join(p, 'aapt2'))), 'ANDROID_HOME / ANDROID_SDK_ROOT must contain platforms and build-tools.');
    add('android-platform-tools', Boolean(sdk) && (existsSync(join(sdk, 'platform-tools/adb.exe')) || existsSync(join(sdk, 'platform-tools/adb'))), 'SDK platform-tools/adb must exist; no device is contacted.');
    const ndk = env.NDK_HOME || env.ANDROID_NDK_HOME;
    add('android-ndk', isDirectory(ndk) && existsSync(join(ndk, 'source.properties')) && isDirectory(join(ndk, 'toolchains/llvm/prebuilt')), 'NDK_HOME must identify an installed LLVM Android NDK.');
    const rustupHome = env.RUSTUP_HOME || join(env.USERPROFILE || env.HOME || '', '.rustup');
    add('rust-android-target', directories(join(rustupHome, 'toolchains')).some(toolchain => isDirectory(join(toolchain, 'lib/rustlib/aarch64-linux-android/lib'))), 'Installed Rust aarch64-linux-android target library is required for the documented ARM64 build.');
    add('android-initialized', existsSync(join(projectRoot, 'src-tauri/gen/android/gradlew')) || existsSync(join(projectRoot, 'src-tauri/gen/android/gradlew.bat')), 'Android project has not been generated this round; future tauri android init requires approved SDK setup.');
  }
  return checks;
}

export function runCheck(args = process.argv.slice(2)) {
  let platform = process.platform === 'win32' ? 'windows' : 'android';
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--platform' || !['windows', 'android'].includes(args[1])) {
      return { status: 'invalid-arguments', exitCode: 2, nativeBuildVerified: false, error: 'Usage: node tools/check-native.mjs [--platform windows|android]' };
    }
    platform = args[1];
  }
  return summarizeReadiness({ platform, configuration: loadConfiguration(projectRoot), environment: checkEnvironment(platform) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runCheck();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.exitCode;
}
