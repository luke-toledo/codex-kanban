import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(repositoryRoot, "dist/server");

const [html, appStyles, demoStyles, demoScript] = await Promise.all([
  readFile(resolve(repositoryRoot, "demo/index.html"), "utf8"),
  readFile(resolve(repositoryRoot, "public/styles.css"), "utf8"),
  readFile(resolve(repositoryRoot, "demo/demo.css"), "utf8"),
  readFile(resolve(repositoryRoot, "demo/demo.js"), "utf8"),
]);

const assets = {
  "/": { type: "text/html; charset=utf-8", body: html },
  "/index.html": { type: "text/html; charset=utf-8", body: html },
  "/styles.css": { type: "text/css; charset=utf-8", body: `${appStyles}\n${demoStyles}` },
  "/demo.js": { type: "text/javascript; charset=utf-8", body: demoScript },
};

const worker = `const assets = ${JSON.stringify(assets)};

const securityHeaders = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export default {
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    const asset = assets[pathname];
    if (!asset) return new Response("Not found", { status: 404, headers: securityHeaders });
    const headers = { ...securityHeaders, "Content-Type": asset.type, "Cache-Control": "public, max-age=300" };
    return new Response(request.method === "HEAD" ? null : asset.body, { status: 200, headers });
  },
};
`;

await rm(resolve(repositoryRoot, "dist"), { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "index.js"), worker, "utf8");
console.log("Built fake-data demo");
