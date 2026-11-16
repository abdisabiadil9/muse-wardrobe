# 手机访问与 Android 安装方案

更新：2026-11-17。

## 现在演示：手机热点

校园网连不上不一定是前端故障。可能是无线客户端隔离、电脑地址变化、防火墙或服务停止；尚未在你的手机上确认具体原因。

1. 手机打开个人热点，电脑连接这个热点，电脑保持联网和唤醒。
2. 在项目目录运行 `npm run phone:setup`。脚本只更新本机允许访问的来源并打印地址，不输出密钥。
3. 重启 `npm run dev:full`。
4. 手机浏览器访问打印的 Wi-Fi 地址，端口是 `5179`。不要在手机输入 localhost。
5. 如果热点宿主手机仍不能访问电脑，使用第二部手机开热点，让电脑和测试手机都连接它。有些设备的热点策略不支持宿主访问客户端。

这仍依赖电脑在线，不能保证所有校园/热点网络都允许设备互访。不要关闭整个系统防火墙；只检查本应用所需端口的本地网络权限。

## 日常使用：公网 HTTPS 后端 + 可安装网页版

建议先部署同源 HTTPS 网站、API、Worker、PostgreSQL 和私有对象存储，并使用真实登录替代开发共享身份。手机用校园网或移动数据访问同一个域名，无需连接电脑。

现有前端已有 manifest、192/512 图标和 standalone 配置。上线 HTTPS 后，符合浏览器条件时 Android Chrome 可显示安装入口，iPhone 可通过 Safari 添加到主屏幕。不同浏览器行为不同，当前 HTTP 局域网地址不保证出现安装提示。没有承诺离线 AI 生成；模型仍需要联网。公开旧 Sites 只含演示页面，不能替代这个业务后端。

参考：[Chrome 安装条件](https://web.dev/articles/install-criteria)。

## Android 演示 APK

项目新增 `android-demo/` 原生 Android WebView 工程，启动时由用户填写电脑服务地址并保存在本机，支持返回、换地址、图片文件选择和网络失败重试。页面、API 和 AI 仍来自该服务，不包含服务端密钥或数据库。

`.github/workflows/android-demo.yml` 使用 JDK17、Gradle8.11.1、AGP8.9.2 和 Android SDK35 构建调试签名 APK，并上传名为 `muse-android-demo` 的构建产物。源码和构建配置可复用，但这是本地演示壳，不是独立离线应用或商店正式版本。

安装后先把电脑连到手机热点、启动服务，再输入 `http://电脑地址:5179`。连接失败时使用“修改地址”，不要继续使用上一个网络中的旧 IP。APK 无法穿透校园网的设备隔离；没有云服务器时电脑必须保持运行。

APK 为调试签名；不同构建机生成的调试签名可能不同，覆盖安装若签名不匹配需卸载旧演示包后安装，卸载会清除壳内的登录与本机偏好。正式版应配置稳定私有签名、HTTPS 和独立用户登录。

当前只支持选取相册文件，不申请广泛相册读取、摄像头或麦克风权限。构建、校验和真机验证的实际状态见本轮交付记录；未将编译成功写成真机验收。

参考：[Android WebChromeClient 文件选择接口](https://developer.android.com/reference/android/webkit/WebChromeClient)、[AGP8.9兼容版本](https://developer.android.com/build/releases/agp-8-9-0-release-notes)。
