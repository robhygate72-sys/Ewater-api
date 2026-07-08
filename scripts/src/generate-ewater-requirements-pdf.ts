import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MD_PATH = path.join(__dirname, "ewater-api-requirements.md");
const OUT_DIR = path.join(__dirname, "..", "..", "attached_assets", "generated");
const HTML_PATH = path.join(OUT_DIR, "ewater-api-requirements.html");
const PDF_PATH = path.join(OUT_DIR, "eWater-API-Technical-Requirements.pdf");

const CHROMIUM_PATH = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

const CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1a1f2b;
    font-size: 11pt;
    line-height: 1.55;
    padding: 56px 64px;
    max-width: 100%;
  }
  h1 {
    font-size: 22pt;
    color: #0b3d5c;
    border-bottom: 3px solid #0b7285;
    padding-bottom: 10px;
    margin-top: 0;
  }
  h1:not(:first-of-type) { margin-top: 36px; page-break-before: always; }
  h2 {
    font-size: 15pt;
    color: #0b3d5c;
    margin-top: 28px;
    border-bottom: 1px solid #cdd7dd;
    padding-bottom: 4px;
    page-break-after: avoid;
  }
  h3 {
    font-size: 12.5pt;
    color: #0b5c7a;
    margin-top: 20px;
    page-break-after: avoid;
  }
  h4 { font-size: 11pt; color: #333; margin-top: 14px; }
  p, li { font-size: 10.3pt; }
  code {
    background: #f1f4f6;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: "SF Mono", Consolas, Menlo, monospace;
    font-size: 9.3pt;
    color: #a4262c;
  }
  pre {
    background: #0b3d5c;
    color: #e8f4fa;
    padding: 14px 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 9pt;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: none; color: inherit; padding: 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 9.3pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cdd7dd;
    padding: 6px 9px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eaf3f6; color: #0b3d5c; }
  blockquote {
    border-left: 4px solid #0b7285;
    margin: 10px 0;
    padding: 4px 16px;
    color: #444;
    background: #f7fafb;
  }
  hr { border: none; border-top: 1px solid #cdd7dd; margin: 28px 0; }
  a { color: #0b7285; }
  strong { color: #12222e; }
  .cover {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    page-break-after: always;
  }
  .cover h1 {
    border: none;
    font-size: 30pt;
    margin-bottom: 6px;
  }
  .cover .subtitle { font-size: 14pt; color: #0b7285; margin-bottom: 40px; }
  .cover .meta { font-size: 10.5pt; color: #555; line-height: 1.9; }
`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const md = readFileSync(MD_PATH, "utf-8");

  const lines = md.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# ")) ?? "# eWater Platform API — Technical Requirements";
  const title = titleLine.replace(/^#\s*/, "");
  const restStart = lines.indexOf(titleLine) + 1;
  const metaLines: string[] = [];
  let i = restStart;
  while (i < lines.length && !lines[i]!.startsWith("---")) {
    if (lines[i]!.trim().length > 0) metaLines.push(lines[i]!);
    i++;
  }
  const bodyMd = lines.slice(i + 1).join("\n");

  const bodyHtml = await marked.parse(bodyMd);

  const coverMeta = metaLines
    .map((l) => l.replace(/\*\*/g, ""))
    .join("<br/>");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="cover">
    <h1>${title}</h1>
    <div class="subtitle">Gap Analysis &amp; Endpoint Specification</div>
    <div class="meta">${coverMeta}</div>
  </div>
  ${bodyHtml}
</body>
</html>`;

  writeFileSync(HTML_PATH, html, "utf-8");

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(`file://${HTML_PATH}`, { waitUntil: "networkidle0" });
  await page.evaluate((t: string) => {
    document.title = t;
  }, "eWater Platform API — Technical Requirements & Gap Analysis");

  await page.pdf({
    path: PDF_PATH,
    format: "Letter",
    printBackground: true,
    margin: { top: "0", bottom: "0", left: "0", right: "0" },
  });

  await browser.close();

  console.log(`PDF written to ${PDF_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
