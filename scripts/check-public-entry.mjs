import { readFileSync } from "node:fs";
const home = readFileSync("out/index.html", "utf8");
const preview = readFileSync("out/software/preview/index.html", "utf8");
const checks = [
  ["home stays on the introduction", !home.includes('http-equiv="refresh"') && home.includes("The campus day, in one place.")],
  ["home sign-in link", home.includes("Sign in to your campus") && home.includes('href="/software/"')],
  ["home has no faculty demo", !/Aanya|NODEMCU|desk device/i.test(home)],
  ["preview sign-in", preview.includes("Continue to sign in") && !preview.includes("Aanya")],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
