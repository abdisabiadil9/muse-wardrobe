// Refresh exact browser origins after changing Wi-Fi/hotspot. Never prints secrets.
import { networkInterfaces } from "node:os";
import { readFile, writeFile, rename } from "node:fs/promises";
const addresses = [
  ...new Set(
    Object.values(networkInterfaces())
      .flat()
      .filter(
        (a) =>
          a &&
          a.family === "IPv4" &&
          !a.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address),
      )
      .map((a) => a.address),
  ),
];
if (!addresses.length)
  throw new Error(
    "No private IPv4 address found. Connect the computer to your phone hotspot first.",
  );
const path = ".env";
const source = await readFile(path, "utf8");
const previous = (source.match(/^APP_ORIGINS=(.*)$/m)?.[1] || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const origins = [
  ...new Set([
    ...previous,
    "http://localhost:5179",
    "http://127.0.0.1:5179",
    ...addresses.map((a) => `http://${a}:5179`),
  ]),
];
const line = "APP_ORIGINS=" + origins.join(",");
const next = /^APP_ORIGINS=/m.test(source)
  ? source.replace(/^APP_ORIGINS=.*$/m, line)
  : source + "\n" + line + "\n";
await writeFile(".env.phone-tmp", next, { mode: 0o600 });
await rename(".env.phone-tmp", path);
console.log("Phone addresses (choose the Wi-Fi/hotspot interface):");
addresses.forEach((a) => console.log(`  http://${a}:5179`));
console.log(
  "Restart npm run dev:full to load the updated origins. This does not create a public deployment.",
);
