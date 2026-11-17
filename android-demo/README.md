# MUSE Android 演示 APK

这是现有 MUSE 网页的原生 Java / WebView 演示壳。它不包含 API、Worker、模型密钥或离线后端；默认连接 https://muse-web-production-eeb115cb.up.railway.app ，首次安装直接显示云端演示口令入口，无需填写地址或连接同一 Wi-Fi。升级旧版时会一次性切换到云端，之后仍可在顶部修改服务地址。APK 不内置演示口令。

## 构建

使用 JDK 17、Gradle **8.11.1**、Android SDK Platform **35**。工程采用 Android Gradle Plugin **8.9.2**，最低 Android 7.0 / API 24，目标 API 35。仓库的 GitHub Actions 可构建本工程；本目录不包含 Gradle wrapper，需使用指定版本的 `gradle`。

```sh
gradle -p android-demo testDebugUnitTest lintDebug assembleDebug --no-daemon
```

调试 APK：`android-demo/app/build/outputs/apk/debug/app-debug.apk`。这是 SDK 自动调试签名的可安装包，应用名为「MUSE演示」，包名为 `com.muse.demo.debug`。只生成 debug variant；release variant 已禁用，没有生产发布配置或签名材料。

## 手机连接电脑

1. 在仓库根目录按 [本地开发指南](../docs/LOCAL_DEVELOPMENT.md) 配置并运行 `npm run dev:full`。
2. 让电脑和手机连接同一 Wi-Fi，或让电脑连接手机热点。找到电脑在该网络的 IPv4 地址，例如 `192.168.43.20`。
3. 将完整 origin `http://192.168.43.20:5179` 加入电脑 `.env` 的 `APP_ORIGINS`，保留已有值，重启 API。不要向 APK 填写或复制密钥。
4. 安装 APK，填入 `http://192.168.43.20:5179`。手机上的 `localhost` / `127.0.0.1` 指手机自身，不是电脑。

Vite 的 `/api` 代理使网页和 API 保持同源；不需要把 API 的 `8787` 端口开放给手机。电脑防火墙需允许演示网络访问 `5179`。地址变化后更新 `APP_ORIGINS` 和 App 中的服务地址。

HTTP 仅接受规范写法的 RFC1918 IPv4（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）或回环地址（`localhost`、`127.0.0.0/8`、`[::1]`）。`100.64.0.0/10` 共享地址、公共 IP、`.local` / 普通域名的 HTTP 地址均不接受；普通域名请使用有效证书的 HTTPS。服务地址不能含账号密码、反斜杠或 `#` 片段。

## 壳的行为与边界

- 页面导航限制为填写服务的相同 scheme、host 和有效端口。用户点击的其他安全 HTTPS 链接交给外部应用；非 HTTPS 外链、自动跨域跳转和 `file:` / `content:` / `javascript:` 顶层导航被阻止。
- 仅 debug manifest 允许明文 HTTP；主 manifest 默认关闭。HTTPS 证书错误直接取消，不提供绕过按钮。混合内容关闭，跨源明文子请求被拦截。
- WebView 开启 JavaScript、DOM storage 和第一方 cookie；不提供 JavaScript 原生桥，不允许文件访问、文件跨域访问或第三方 cookie。
- 图片 `data:image/...` 可作为子资源显示（包括 SVG 纹理），不能作为顶层页面或服务地址。
- 图片上传使用系统 `ACTION_OPEN_DOCUMENT`，一次选择一张 `image/*`，仅接受用户选择的 `content:` URI。允许 WebView 读取该选择，未申请照片库、存储或相机权限；改地址、销毁 Activity、取消选择时都会完成空回调。
- 网络错误显示重试和改地址，不展示异常细节。Android 15 的系统栏及键盘通过 WindowInsets 预留四边空间。
- 系统相机实时预览、原生后台任务、离线运行和独立服务器部署均不在该演示壳内。当前本地后端使用共享开发身份，只适合受信任的演示网络。

## 验证

纯 Java JUnit 覆盖 HTTPS、局域网 HTTP、localhost、非法协议/账号/片段/端口、非私网 HTTP、同源判定和安全外链。`lintDebug` 与 `assembleDebug` 应由 CI 一起执行。

构建成功后仍需在实体 Android 手机验收：安装和首次连通、系统栏无遮挡、衣橱图片上传/取消、旋转屏幕后选择回调安全、断网重试、重启记住地址、改服务地址和外链行为。编译与单元测试通过不能替代这些真机验证。
