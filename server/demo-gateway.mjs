import { createServer, request } from "node:http";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { pipeline } from "node:stream";

const hash = (value) => createHash("sha256").update(value).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".apk": "application/vnd.android.package-archive",
};
const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MUSE · 演示入口</title><style>html{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#1d1d1f}body{margin:0;min-height:100dvh;display:grid;place-items:center}main{box-sizing:border-box;width:min(90%,380px);padding:36px 28px;background:white;border-radius:28px;box-shadow:0 12px 48px #00000008}h1{font-size:32px;letter-spacing:-1px;margin:0 0 8px}p{color:#737378;font-size:14px;line-height:1.7}label{display:block;font-size:14px;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:15px;border-radius:14px;font:inherit;font-size:16px}input{border:1px solid #d8d8dc;background:#fafafa}button{margin-top:14px;border:0;background:#007aff;color:white;cursor:pointer}small{display:block;margin-top:22px;color:#86868b;font-size:12px;line-height:1.6}</style><main><h1>muse.</h1><p>今天穿什么，从你的衣橱开始。</p><form method="post" action="/__demo/login"><label for="password">演示口令</label><input id="password" name="password" type="password" required autocomplete="current-password" placeholder="输入组内分享的口令"><button>进入体验</button></form><small>组内演示 · 共用衣橱与 AI 额度<br>请勿上传不希望组员查看的照片。</small></main></html>`;

/** Public team-demo boundary. The upstream API must stay on loopback. */
export function createDemoGateway({
  password,
  dist,
  upstream = "http://127.0.0.1:8787",
  upstreamOrigin = "http://localhost:5179",
  getOrigin,
  health,
}) {
  if (!password || password.length < 16)
    throw new Error("Demo password must be at least 16 characters");
  const signingKey = randomBytes(32);
  const sign = (value) =>
    createHmac("sha256", signingKey).update(value).digest("hex");
  const cookieName = "__Host-muse_demo";
  let attempts = 0,
    windowEnd = Date.now() + 60_000;
  const root = resolve(dist);
  const rootReal = realpath(root);
  const upstreamUrl = new URL(upstream);
  return createServer(async (req, res) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      if (req.url === "/healthz" && req.method === "GET" && health) {
        const ready = await health().catch(() => false);
        return send(
          ready ? 200 : 503,
          JSON.stringify({ ok: ready }),
          "application/json",
        );
      }
      const origin = getOrigin();
      if (!origin) return send(503, "演示入口正在准备，请稍后刷新。");
      if (req.headers.host !== new URL(origin).host)
        return send(403, "Invalid host");
      const url = new URL(req.url, origin);
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin !== origin
      )
        return send(403, "Invalid origin");
      const cookies = String(req.headers.cookie || "")
        .split(";")
        .map((v) => v.trim());
      const ticket =
        cookies
          .find((v) => v.startsWith(cookieName + "="))
          ?.slice(cookieName.length + 1) || "";
      const [expiry, signature] = ticket.split(".");
      const authenticated =
        Number(expiry) > Date.now() && equal(signature || "", sign(expiry));
      if (url.pathname === "/__demo/login" && req.method === "POST") {
        if (Date.now() >= windowEnd) {
          attempts = 0;
          windowEnd = Date.now() + 60_000;
        }
        if (++attempts > 30) {
          res.setHeader("Retry-After", "60");
          return send(429, "尝试次数过多，请一分钟后再试。");
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 2048) return send(413, "Request too large");
        }
        if (!equal(new URLSearchParams(body).get("password") || "", password))
          return send(
            401,
            loginPage.replace("输入组内分享的口令", "口令不正确，请重试"),
            "text/html; charset=utf-8",
          );
        const expires = String(Date.now() + 8 * 3600_000);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${expires}.${sign(expires)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`,
        );
        res.writeHead(303, { Location: "/" });
        return res.end();
      }
      if (!authenticated) {
        if (url.pathname.startsWith("/api/"))
          return send(
            401,
            '{"error":{"message":"请刷新页面并输入演示口令"}}',
            "application/json",
          );
        return send(200, loginPage, "text/html; charset=utf-8");
      }
      if (url.pathname.startsWith("/api/")) {
        if (Number(req.headers["content-length"] || 0) > 11 * 1024 * 1024)
          return send(413, "Request too large");
        const headers = { ...req.headers, host: upstreamUrl.host };
        for (const name of Object.keys(headers))
          if (
            /^(authorization|forwarded|x-forwarded-.*|cf-.*|x-test-.*|connection|upgrade|proxy-.*)$/i.test(
              name,
            )
          )
            delete headers[name];
        headers.cookie = cookies
          .filter((v) => !v.startsWith(cookieName + "="))
          .join("; ");
        // Only rewrite after the public origin check; preserve the API's CSRF check.
        if (headers.origin) headers.origin = upstreamOrigin;
        const proxy = request(
          new URL(url.pathname + url.search, upstreamUrl),
          { method: req.method, headers, timeout: 60_000 },
          (incoming) => {
            const output = { ...incoming.headers, "cache-control": "no-store" };
            if (output["set-cookie"])
              output["set-cookie"] = output["set-cookie"].map((c) =>
                /;\s*secure/i.test(c) ? c : c + "; Secure",
              );
            res.writeHead(incoming.statusCode, output);
            pipeline(incoming, res, () => {});
          },
        );
        proxy.on("timeout", () => proxy.destroy(new Error("timeout")));
        proxy.on("error", () => {
          if (!res.headersSent) send(502, "本机 API 暂不可用，请联系演示者。");
          else res.destroy();
        });
        req.on("aborted", () => proxy.destroy());
        res.on("close", () => {
          if (!res.writableEnded) proxy.destroy();
        });
        req.pipe(proxy);
        return;
      }
      if (!["GET", "HEAD"].includes(req.method))
        return send(405, "Method not allowed");
      const path = decodeURIComponent(url.pathname);
      if (
        path.split("/").some((part) => part.startsWith(".")) ||
        path.includes("\\")
      )
        return send(404, "Not found");
      let file = resolve(root, "." + path);
      if (file !== root && !file.startsWith(root + sep))
        return send(404, "Not found");
      if (path === "/" || !extname(path)) file = resolve(root, "index.html");
      const actual = await realpath(file).catch(() => null);
      if (!actual || !actual.startsWith((await rootReal) + sep))
        return send(404, "Not found");
      const info = await stat(actual);
      if (!info.isFile()) return send(404, "Not found");
      res.writeHead(200, {
        "Content-Type": mime[extname(actual)] || "application/octet-stream",
        "Content-Length": info.size,
      });
      if (req.method === "HEAD") return res.end();
      pipeline(createReadStream(actual), res, () => {});
    } catch {
      if (!res.headersSent) send(400, "Invalid request");
      else res.destroy();
    }
  });
}
