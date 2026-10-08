// Real-browser check of the provider UI: does the page load, render the
// provider dropdown/list, and switch providers without console errors?
const puppeteer = require("puppeteer-core");
const path = require("path");

const FILE = "file:///" + path.resolve(process.argv[2]).replace(/\\/g, "/");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto(FILE, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 800));

  let failures = 0;
  const check = (label, cond, extra = "") => {
    if (cond) console.log(`  PASS  ${label}`);
    else { console.log(`  FAIL  ${label} ${extra}`); failures++; }
  };

  // Open settings the way a user does -> populates every field.
  await page.evaluate(() => document.getElementById("settingsBtn").click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => selectSection("connection"));
  await new Promise((r) => setTimeout(r, 300));

  const state = await page.evaluate(() => {
    const sel = document.getElementById("sProviderSelect");
    return {
      options: Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent })),
      selected: sel.value,
      label: document.getElementById("sProviderLabel").value,
      baseUrl: document.getElementById("sProviderBaseUrl").value,
      key: document.getElementById("sProviderKey").value,
      route: document.getElementById("sProviderRoute").value,
      rows: document.querySelectorAll("#sProviderList .provider-row").length,
      note: document.getElementById("sProviderNote").textContent,
      modelHeading: document.getElementById("sModelsProvider").textContent,
    };
  });

  console.log("\n[rendered connection panel]");
  check("3 options in dropdown", state.options.length === 3,
        JSON.stringify(state.options.map(o => o.v)));
  check("bridge selected by default", state.selected === "deepseek-web", state.selected);
  check("label populated", state.label.includes("DeepSeek Web"), state.label);
  check("base url starts blank (no personal endpoint shipped)", state.baseUrl === "", state.baseUrl);
  check("api key starts blank (no secrets shipped)", state.key === "", state.key);
  check("route populated", state.route === "coding", state.route);
  check("3 rows rendered", state.rows === 3, String(state.rows));
  check("note shown", state.note.length > 0);
  check("models heading names provider", state.modelHeading.includes("DeepSeek Web"),
        state.modelHeading);

  // Switch to the paid API provider
  console.log("\n[switch to deepseek-api]");
  const after = await page.evaluate(() => {
    const sel = document.getElementById("sProviderSelect");
    sel.value = "deepseek-api";
    sel.dispatchEvent(new Event("change"));
    return {
      baseUrl: document.getElementById("sProviderBaseUrl").value,
      route: document.getElementById("sProviderRoute").value,
      key: document.getElementById("sProviderKey").value,
      models: document.getElementById("sModels").value,
      activeRow: document.querySelector("#sProviderList .provider-row.active .p-name")?.textContent,
      builtUrl: buildRequestUrl(),
    };
  });
  check("base url switched", after.baseUrl === "https://api.deepseek.com", after.baseUrl);
  check("route switched to root", after.route === "root", after.route);
  check("key cleared (empty for this provider)", after.key === "", after.key);
  check("model list switched", after.models.includes("deepseek-chat"), after.models);
  check("active row updated", (after.activeRow || "").includes("DeepSeek Platform"), after.activeRow);
  check("request URL is root route",
        after.builtUrl === "https://api.deepseek.com/chat/completions", after.builtUrl);

  // Switch back -> the bridge's own values are restored, not the other
  // provider's. Enter a URL/key first so the round-trip is actually observable.
  console.log("\n[switch back to bridge]");
  const back = await page.evaluate(() => {
    let sel = document.getElementById("sProviderSelect");
    sel.value = "deepseek-web";
    sel.dispatchEvent(new Event("change"));
    // Type a distinctive URL + key into the bridge provider.
    document.getElementById("sProviderBaseUrl").value = "https://bridge.example.workers.dev";
    document.getElementById("sProviderBaseUrl").dispatchEvent(new Event("change"));
    document.getElementById("sProviderKey").value = "TEST-KEY-BRIDGE";
    document.getElementById("sProviderKey").dispatchEvent(new Event("change"));
    // Go to the paid provider and give it different values.
    sel.value = "deepseek-api";
    sel.dispatchEvent(new Event("change"));
    document.getElementById("sProviderKey").value = "TEST-KEY-PAID";
    document.getElementById("sProviderKey").dispatchEvent(new Event("change"));
    // Come back.
    sel.value = "deepseek-web";
    sel.dispatchEvent(new Event("change"));
    return {
      key: document.getElementById("sProviderKey").value,
      baseUrl: document.getElementById("sProviderBaseUrl").value,
      builtUrl: buildRequestUrl(),
      models: document.getElementById("sModels").value,
      persisted: JSON.parse(localStorage.getItem("deepseek-ui-settings")).activeProviderId,
    };
  });
  check("bridge key restored (not the other provider's)",
        back.key === "TEST-KEY-BRIDGE", back.key);
  check("bridge URL restored",
        back.baseUrl === "https://bridge.example.workers.dev", back.baseUrl);
  check("bridge URL used for requests",
        back.builtUrl === "https://bridge.example.workers.dev/coding/chat/completions",
        back.builtUrl);
  check("selection persisted", back.persisted === "deepseek-web", back.persisted);

  // Model picker reflects the active provider
  console.log("\n[model picker]");
  const picker = await page.evaluate(() => {
    renderModelMenu();
    return {
      items: Array.from(document.querySelectorAll("#modelMenu button"))
        .map((b) => b.textContent),
      label: document.getElementById("modelLabel").textContent,
    };
  });
  check("picker shows bridge models", picker.items.length === 2, JSON.stringify(picker.items));
  check("topbar label correct", picker.label.length > 0, picker.label);

  console.log("\n[console errors]");
  const real = errors.filter((e) => !/favicon|net::ERR_FILE_NOT_FOUND/i.test(e));
  check("no page errors", real.length === 0, real.slice(0, 5).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "\nALL BROWSER TESTS PASSED" : `\n${failures} BROWSER TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
