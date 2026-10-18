# 构建与发布

## Web / PWA

需要 Node.js 22+。

```bash
npm install
npm run build     # 输出到 dist/
npm run preview   # 本机预览生产构建
```

构建产物 `dist/` 可直接部署到任意静态托管（Vercel、Netlify、Cloudflare Pages、GitHub Pages 等）。

- 只部署 `dist/`，不要部署仓库根目录
- `dist/` 已包含 `index.html`、哈希命名的 JS/CSS、`assets/` 静态素材、`manifest.webmanifest` 与 `sw.js`
- Service Worker 需要 HTTPS 或 localhost 才能注册

### GitHub Pages

仓库默认 CI 只做构建检查，不自动部署。如需 Pages，在仓库 Settings → Pages 中选择 GitHub Actions，然后添加部署工作流，`path` 设为 `dist`。

## Windows 桌面应用

基于 Tauri 2，打包为 NSIS 安装程序。

### 前置要求

1. **Rust**（1.77+）：https://rustup.rs
2. **Visual Studio Build Tools**：勾选「使用 C++ 的桌面开发」
3. **WebView2**：Windows 10/11 通常已内置
4. **Tauri CLI**：`cargo install tauri-cli`

### 构建

```bash
npm install
npm run build
cd src-tauri
cargo tauri build --bundles nsis
```

产物位置：`src-tauri/target/release/bundle/nsis/青柠工作台_1.0.0_x64-setup.exe`

### 配置说明

- 应用标识：`app.lime.workbench`
- 安装模式：当前用户（无需管理员权限）
- 界面语言：简体中文
- 缺少 WebView2 时自动下载安装器（需要网络）
- 窗口尺寸：1280×820，最小 960×640

## Android 应用

### 前置要求

1. **Rust** + Android targets：
   ```bash
   rustup target add aarch64-linux-android
   ```
2. **JDK 17+**
3. **Android Studio**（含 SDK、NDK、build-tools）
4. **Tauri CLI**：`cargo install tauri-cli`

### 环境变量

```bash
export JAVA_HOME=/path/to/jdk
export ANDROID_HOME=/path/to/android-sdk
export NDK_HOME=/path/to/android-ndk
```

### 构建

```bash
npm install
npm run build
cd src-tauri

# 初始化 Android 工程（仅首次）
cargo tauri android init

# 构建 APK
cargo tauri android build --apk --target aarch64

# 构建 AAB（用于 Google Play）
cargo tauri android build --aab --target aarch64
```

产物位置：`src-tauri/gen/android/app/build/outputs/`

### 签名

正式发布前需要配置签名密钥。keystore 文件不要提交到仓库：

```bash
keytool -genkey -v -keystore release.keystore -alias lime \
  -keyalg RSA -keysize 2048 -validity 10000
```

在 `src-tauri/gen/android/keystore.properties` 中配置（该文件已被 `.gitignore` 排除）：

```properties
storeFile=/absolute/path/to/release.keystore
storePassword=你的密码
keyAlias=lime
keyPassword=你的密码
```

## 数据迁移

浏览器版与桌面/移动版的存储相互独立，不会自动同步。

- 旧设备：设置 → 数据与备份 → 导出备份（JSON）
- 新设备：设置 → 数据与备份 → 导入备份
- 头像、壁纸等媒体随 JSON 保存；AI Key 和外观偏好不在备份中，需重新设置

## 版本管理

应用版本在三个地方保持一致：

- `package.json` 的 `version`
- `src-tauri/Cargo.toml` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`

Android 的 `versionCode` 每次发布必须递增，否则无法在商店更新。
