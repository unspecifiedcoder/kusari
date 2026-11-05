import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({ entryPoints: ["src/page.js"], bundle: true, format: "esm", outfile: "dist/page.js", logLevel: "info" });
await copyFile("src/index.html", "dist/index.html");
