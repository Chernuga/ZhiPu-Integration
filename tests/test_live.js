// Live integration: use the page's OWN streamCompletion() to call a real
// OpenAI-compatible endpoint.
//
// Credentials are NOT stored in this file. Provide them via the environment:
//   BRIDGE_URL=https://your-bridge.workers.dev BRIDGE_KEY=... node test_live.js index.html
// Without them the test reports SKIPPED rather than failing.
const puppeteer = require("puppeteer-core");
const path = require("path");
const FILE = "file:///" + path.resolve(process.argv[2]).replace(/\\/g, "/");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROMPT = process.argv[3] || "Reply with exactly: INTEGRATION OK";
const BRIDGE_URL = process.env.BRIDGE_URL || "";
const BRIDGE_KEY = process.env.BRIDGE_KEY || "";

(async () => {
  if (!BRIDGE_URL || !BRIDGE_KEY) {
    console.log("\nSKIPPED: set BRIDGE_URL and BRIDGE_KEY to run the live test.");
    console.log("  e.g.  BRIDGE_URL=https://x.workers.dev BRIDGE_KEY=abc node test_live.js index.html");
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text()); });
  await page.goto(FILE, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 700));

  const result = await page.evaluate(async (prompt, url, key) => {
    // Inject credentials at runtime instead of shipping them in the file.
    const p = settings.providers.find((x) => x.id === "deepseek-web");
    p.baseUrl = url;
    p.apiKey = key;
    settings.activeProviderId = "deepseek-web";
    syncActiveProvider();
    const reqUrl = buildRequestUrl();
    const model = settings.model;

    let content = "", reasoning = "", err = null;
    await new Promise((resolve) => {
      streamCompletion({
        messages: [{ role: "user", content: prompt }],
        model,
        thinking: false,
        onDelta: (d) => {
          if (d.content) content += d.content;
          if (d.reasoning) reasoning += d.reasoning;
        },
        onDone: () => resolve(),
        onError: (e) => { err = e.message; resolve(); },
      }).catch((e) => { err = e.message; resolve(); });
      setTimeout(resolve, 150000);
    });
    return { url: reqUrl, model, content, reasoning, err };
  }, PROMPT, BRIDGE_URL, BRIDGE_KEY);

  console.log("\n  request URL :", result.url);
  console.log("  model       :", result.model);
  console.log("  error       :", result.err || "(none)");
  console.log("  content     :", JSON.stringify(result.content.slice(0, 300)));
  if (result.reasoning) console.log("  reasoning   :", JSON.stringify(result.reasoning.slice(0, 120)));

  const ok = !result.err && result.content.trim().length > 0;
  console.log(ok ? "\nLIVE INTEGRATION: PASS" : "\nLIVE INTEGRATION: FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
