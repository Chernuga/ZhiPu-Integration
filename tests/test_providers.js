// Headless test of the provider logic extracted from index.html.
// Verifies migration, URL building, and per-provider model memory.
const fs = require("fs");

const html = fs.readFileSync(process.argv[2], "utf8");
const start = html.indexOf("<script>") + 8;
const end = html.lastIndexOf("</script>");
let body = html.slice(start, end);

// Keep only the pieces that don't touch the DOM.
function extract(name, kind = "function") {
  const re = new RegExp(`^${kind} ${name}\\(`, "m");
  const i = body.search(re);
  if (i < 0) throw new Error("not found: " + name);
  let depth = 0, j = body.indexOf("{", i);
  for (let k = j; k < body.length; k++) {
    if (body[k] === "{") depth++;
    else if (body[k] === "}") { depth--; if (depth === 0) return body.slice(i, k + 1); }
  }
  throw new Error("unbalanced: " + name);
}

const constSrc = (n, closer = "\\];") => {
  const m = body.match(new RegExp(`^const ${n} = [\\s\\S]*?^${closer}`, "m"));
  if (!m) throw new Error("const not found: " + n);
  return m[0];
};

const src = [
  constSrc("DEFAULT_MODELS"),
  constSrc("DEFAULT_PROVIDERS"),
  body.match(/^const DEFAULT_PROVIDER_ID = .*$/m)[0],
  extract("normalizeProvider"),
  extract("activeProvider"),
  constSrc("DEFAULT_SETTINGS", "\\};"),
  TYPING_SPEEDS(),
].join("\n\n");

function TYPING_SPEEDS() {
  const m = body.match(/^const TYPING_SPEEDS = \{[\s\S]*?^\};/m);
  return m ? m[0] : "const TYPING_SPEEDS = {default:{}};";
}

const normalizeHexInput = (v) => (typeof v === "string" ? v : "");

// loadSettings needs localStorage; stub it and the two helpers it uses.
const settingsKey = "deepseek-ui-settings";
let STORE = {};
const localStorage = {
  getItem: (k) => (k in STORE ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = v; },
};
const SETTINGS_KEY = settingsKey;

const loadSettings = extract("loadSettings");
const syncActiveProvider = extract("syncActiveProvider");
const commitModelsToProvider = extract("commitModelsToProvider");
const buildRequestUrl0 = extract("buildRequestUrl");

const factory = new Function(
  "localStorage", "SETTINGS_KEY", "normalizeHexInput",
  src + "\n" + loadSettings + "\n" + syncActiveProvider + "\n" +
  commitModelsToProvider + "\n" +
  "return { loadSettings, syncActiveProvider, commitModelsToProvider, " +
  "normalizeProvider, activeProvider, DEFAULT_PROVIDERS, DEFAULT_SETTINGS, " +
  "buildRequestUrlSrc: " + JSON.stringify(buildRequestUrl0) + " };"
);

const M = factory(localStorage, SETTINGS_KEY, normalizeHexInput);

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label} ${extra}`); failures++; }
}

// ---------------------------------------------------------------- fresh install
console.log("\n[1] Fresh install");
let s = M.loadSettings();
check("3 providers by default", s.providers.length === 3, `got ${s.providers.length}`);
check("bridge is first", s.providers[0].id === "deepseek-web");
check("active is bridge", s.activeProviderId === "deepseek-web");
check("bridge key left blank (no secrets shipped)", s.providers[0].apiKey === "",
      `"${s.providers[0].apiKey}"`);
check("bridge base url left blank (no personal endpoint shipped)",
      s.providers[0].baseUrl === "", `"${s.providers[0].baseUrl}"`);
check("bridge models present", s.providers[0].models.length === 2);

// ---------------------------------------------------------------- legacy migration
console.log("\n[2] Legacy single-provider migration");
STORE[settingsKey] = JSON.stringify({
  apiKey: "LEGACY-KEY-123", workerUrl: "https://old.workers.dev",
  plan: "general", model: "glm-4.6",
  models: [{ id: "glm-4.6", label: "GLM-4.6", desc: "Stable" }],
});
let L = M.loadSettings();
const custom = L.providers.find((p) => p.id === "custom");
check("legacy preserved as 'custom' provider", !!custom);
check("legacy key kept", custom && custom.apiKey === "LEGACY-KEY-123", custom && custom.apiKey);
check("legacy url kept", custom && custom.baseUrl === "https://old.workers.dev");
check("legacy route kept (general)", custom && custom.route === "general", custom && custom.route);
check("legacy models kept", custom && custom.models.length === 1 &&
      custom.models[0].id === "glm-4.6");
check("active switched to legacy provider", L.activeProviderId === "custom");
check("bridge still offered", L.providers.some((p) => p.id === "deepseek-web"));

// ---------------------------------------------------------------- no data loss
console.log("\n[3] Model choice survives provider switching");
// syncActiveProvider/commitModelsToProvider mutate a module-global `settings`.
// Build a small sandbox that owns that global so the calls are realistic.
const sandbox = new Function(
  "localStorage", "SETTINGS_KEY", "normalizeHexInput",
  src + "\n" + loadSettings + "\n" + syncActiveProvider + "\n" + commitModelsToProvider +
  "\n" + extract("rememberModelChoice") +
  "\nlet settings = loadSettings();" +
  "\nreturn {" +
  "  setModel: (m) => { settings.model = m; }," +
  "  getModel: () => settings.model," +
  "  getModels: () => settings.models.map(m => m.id)," +
  "  setActive: (id) => { settings.activeProviderId = id; syncActiveProvider(); }," +
  "  commit: () => { commitModelsToProvider(); rememberModelChoice(); }," +
  "  choices: () => JSON.stringify(settings.providerModelChoice)," +
  "  raw: () => settings," +
  "};"
)(localStorage, SETTINGS_KEY, normalizeHexInput);

sandbox.setActive("deepseek-web");
sandbox.setModel("deepseek-web-think");
sandbox.commit();
const bridgeModel = sandbox.getModel();
console.log("     (recorded choices: " + sandbox.choices() + ")");

sandbox.setActive("deepseek-api");
check("switching provider changed model list",
      sandbox.getModels().includes("deepseek-chat"), JSON.stringify(sandbox.getModels()));
sandbox.setModel("deepseek-reasoner");
sandbox.commit();

sandbox.setActive("deepseek-web");
check("bridge remembered its model", sandbox.getModel() === bridgeModel,
      `${sandbox.getModel()} vs ${bridgeModel}; choices=${sandbox.choices()}`);

// ---------------------------------------------------------------- URL building
console.log("\n[4] URL construction per route");
const buildUrl = (providers, activeId) => {
  const settings = { providers, activeProviderId: activeId, workerUrl: "", plan: "coding", baseOverride: "" };
  const activeProvider = () => providers.find((p) => p.id === activeId) || providers[0];
  const fn = new Function("settings", "activeProvider", buildRequestUrl0 + "; return buildRequestUrl;");
  return fn(settings, activeProvider)();
};
const P = M.DEFAULT_PROVIDERS.map((p) => M.normalizeProvider(p, p.id));
// The bridge ships with a blank URL, so give it one for the URL tests.
const BRIDGE_URL = "https://bridge.example.workers.dev";
const P1 = P.map((p) => p.id === "deepseek-web" ? { ...p, baseUrl: BRIDGE_URL } : p);

check("bridge -> /coding/chat/completions",
      buildUrl(P1, "deepseek-web") === `${BRIDGE_URL}/coding/chat/completions`,
      buildUrl(P1, "deepseek-web"));
check("zai -> /coding/chat/completions",
      buildUrl(P1, "zai") === "https://api.z.ai/api/coding/paas/v4/coding/chat/completions",
      buildUrl(P1, "zai"));
check("deepseek-api (root) -> /chat/completions",
      buildUrl(P1, "deepseek-api") === "https://api.deepseek.com/chat/completions",
      buildUrl(P1, "deepseek-api"));
check("blank base url falls back to legacy defaults (no crash)",
      typeof buildUrl(P, "deepseek-web") === "string" && buildUrl(P, "deepseek-web").includes("/chat/completions"),
      buildUrl(P, "deepseek-web"));

// trailing slash must not double up
const P2 = P1.map((p) => p.id === "deepseek-web" ? { ...p, baseUrl: p.baseUrl + "/" } : p);
check("trailing slash tolerated",
      buildUrl(P2, "deepseek-web") === `${BRIDGE_URL}/coding/chat/completions`,
      buildUrl(P2, "deepseek-web"));

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
