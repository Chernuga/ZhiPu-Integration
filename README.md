# ZhiPu-Integration — Web Chat UI with Multi-Provider Support

A single-file (`index.html`) chat front-end for GLM / ZhiPu and any
OpenAI-compatible endpoint. Now multi-provider: each provider carries its own
base URL, API key, route, and model list.

## Providers

Three ship configured. Switch between them in **Settings → Connection**.
No endpoints or keys are pre-filled — enter your own.

| Provider | Base URL | Route | Notes |
| :--- | :--- | :--- | :--- |
| **DeepSeek Web (bridge)** | *(set your own)* | `coding` | Personal phone bridge. Fill in your Worker URL + key. |
| **Z.ai / GLM** | `https://api.z.ai/api/coding/paas/v4` | `coding` | Add your own key. |
| **DeepSeek Platform (paid)** | `https://api.deepseek.com` | `root` | Add your own key. Official API. |

Add more with **Add provider** — any OpenAI-compatible host works.

## How routing works

The request URL is `baseUrl` + (route segment) + `/chat/completions`:

| Route | URL suffix | Used by |
| :--- | :--- | :--- |
| `coding` | `/coding/chat/completions` | z.ai coding plan, the bridge |
| `general` | `/general/chat/completions` | z.ai general |
| `root` | `/chat/completions` | api.deepseek.com, OpenAI-compatible |

## Using the DeepSeek Web bridge

This is the interesting one: it drives a **logged-in DeepSeek web session** on a
phone, exposing it as an OpenAI-compatible API.

Requirements:
- The phone must be **awake** with the bridge app in the foreground. When the
  screen sleeps, the WebView stops running JavaScript and requests return an
  empty `200`. This is the most common failure.
- **One request at a time.** Rapid requests trigger the site's anti-abuse path,
  which returns a proof-of-work challenge instead of an answer and then clears
  after a period of inactivity.
- Only the newest user message is sent; conversation history lives in the web
  session, not in the request.

## Migrating from the old single-provider layout

Automatic. If saved settings contain `apiKey` / `workerUrl` / `plan` /
`baseOverride`, they are folded into a provider called **"Previous setup"** and
selected as active. Nothing is lost, and the bridge is added alongside it.

## Model lists

Stored per provider. In **Settings → Models**:
- **Refresh from provider** — `GET <baseUrl>/models`. Works for the bridge and
  `api.deepseek.com`; z.ai blocks it from a browser via CORS.
- **Load provider defaults** — restore the built-in list.

Format is one per line: `id`, `id | Label`, or `id | Label | Description`.
The model chosen for each provider is remembered across switches.

## Notes

- API keys live in `localStorage` only. Never sent anywhere except the provider
  they belong to.
- Direct browser calls to `api.z.ai` are blocked by CORS preflight. Point a
  Cloudflare Worker (or the bridge) at it and set that as the provider base URL.
- The Worker answers CORS preflight (`OPTIONS`) so browser clients work.

## Tests

`test_providers.js`, `test_browser.js`, and `test_live.js` (in the working
scratch dir) cover migration, URL building, per-provider model memory, the
rendered settings UI, and a real end-to-end streaming call.
