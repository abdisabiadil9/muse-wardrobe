# MUSE Android 演示 APK

这是现有 MUSE 网页的原生 Java / WebView 演示壳。它不包含 API、Worker、模型密钥或离线后端；默认连接 https://muse-web-production-eeb115cb.up.railway.app ，首次安装直接显示云端演示口令入口，无需填写地址或连接同一 Wi-Fi。固定连接云端，已移除顶部地址/返回工具栏，返回使用 Android 系统手势或返回键。APK 不内置演示口令。

## 构建

使用 JDK 17、Gradle **8.11.1**、Android SDK Platform **35**。工程采用 Android Gradle Plugin **8.9.2**，最低 Android 7.0 / API 24，目标 API 35。仓库的 GitHub Actions 可构建本工程；本目录不包含 Gradle wrapper，需使用指定版本的 `gradle`。

```sh
gradle -p android-demo testDebugUnitTest lintDebug assembleDebug --no-daemon
```

调试 APK：`android-demo/app/build/outputs/apk/debug/app-debug.apk`。这是 SDK 自动调试签名的可安装包，应用名为「MUSE演示」，包名为 `com.muse.demo.debug`。只生成 debug variant；release variant 已禁用，没有生产发布配置或签名材料。

## 使用

安装后自动打开云端口令页，输入组内演示口令即可。手机流量或 Wi-Fi 均可，无需电脑开机或同一局域网；服务器地址固定在 MainActivity.DEFAULT_URL。应用顶部没有浏览器工具栏，返回使用 Android 系统返回手势/返回键。

## 壳的行为与边界

- 页面导航限制为内置云端服务的相同 scheme、host 和有效端口。用户点击的其他安全 HTTPS 链接交给外部应用；非 HTTPS 外链、自动跨域跳转和 `file:` / `content:` / `javascript:` 顶层导航被阻止。
- 仅 debug manifest 允许明文 HTTP；主 manifest 默认关闭。HTTPS 证书错误直接取消，不提供绕过按钮。混合内容关闭，跨源明文子请求被拦截。
- WebView 开启 JavaScript、DOM storage 和第一方 cookie；不提供 JavaScript 原生桥，不允许文件访问、文件跨域访问或第三方 cookie。
- 图片 `data:image/...` 可作为子资源显示（包括 SVG 纹理），不能作为顶层页面或服务地址。
- 图片上传使用系统 `ACTION_OPEN_DOCUMENT`，一次选择一张 `image/*`，仅接受用户选择的 `content:` URI。允许 WebView 读取该选择，未申请照片库、存储或相机权限；销毁 Activity、取消选择时都会完成空回调。
- 网络错误显示重试，不展示异常细节。Android 15 的系统栏及键盘通过 WindowInsets 预留四边空间。
- 系统相机实时预览、原生后台任务、离线运行和独立服务器部署均不在该演示壳内。当前云端使用口令保护的共用演示身份，组员共享衣橱与额度。

## 验证

纯 Java JUnit 覆盖 HTTPS、局域网 HTTP、localhost、非法协议/账号/片段/端口、非私网 HTTP、同源判定和安全外链。`lintDebug` 与 `assembleDebug` 应由 CI 一起执行。

构建成功后仍需在实体 Android 手机验收：安装和首次连通、系统栏无遮挡、衣橱图片上传/取消、旋转屏幕后选择回调安全、断网重试、重启直达云端、系统返回和外链行为。编译与单元测试通过不能替代这些真机验证。

## 识别当前安装包

0.4 起应用名称为「MUSE 云端」，下载文件名包含版本号。Android 应用信息中应显示 `0.4-cloud-debug`；仍显示旧版本或顶部「改地址」时，说明旧安装包尚未替换。云端网页更新无法删除旧 APK 内置的原生工具栏。

若安装提示签名冲突，请先卸载旧「MUSE演示」再安装新包；卸载会清除本机记录，云端衣橱保留。
