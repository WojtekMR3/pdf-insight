# Hosted deployment

The deployed architecture is [GitHub Pages](https://wojtekmr3.github.io/pdf-insight/) for the frontend, Cloudflare Worker `pdf-insight-api` for the backend, and Gemini 3.1 Flash-Lite for inference. Source is public at [WojtekMR3/pdf-insight](https://github.com/WojtekMR3/pdf-insight). A dedicated Google project/key named `PDF Insight` supplies the backend credential. Billing remains disabled. Text-invoice analysis, scanned-invoice OCR and JSON export passed on 2026-10-06; see [verification details](verification.md).

## GitHub Actions

`.github/workflows/deploy.yml` runs all checks for pull requests and pushes to `main`. Publishing is enabled only for `main`, after checks pass, when `DEPLOY_ENABLED` is `true`. Deployment credentials are used only in the main-branch backend job. To reproduce the configured setup:

1. Create the public repository and push the reviewed source. Select **GitHub Actions** under **Settings > Pages > Build and deployment > Source**.
2. Create the Gemini project/key on the free tier and confirm an available vision model with structured JSON support. Keep billing disabled unless a paid plan is separately chosen.
3. Create the `pdf-insight-api` Worker, then create a Cloudflare deployment API token with **Individual Workers Editor** permission restricted to that Worker. Store it as the repository Actions secret `CLOUDFLARE_API_TOKEN`. Store the dedicated Gemini credential as `GEMINI_API_KEY`. Neither value belongs in source code or repository variables. The initial deployment token expires after 30 days and must be renewed for later deployments; token expiry does not stop the deployed Worker.
4. Set Actions repository variables `CLOUDFLARE_ACCOUNT_ID` and `GEMINI_MODEL`, then set `DEPLOY_ENABLED` to `true`.
5. Run **Check and deploy PDF Insight** manually with **verify_sample** enabled. The workflow configures the exact GitHub Pages origin, publishes the Worker and secret, tests CORS/provider configuration, analyzes the sample, and deploys Pages only if those steps succeed.

The API URL comes directly from the Worker deployment output. The frontend uses `/<repository>/` as its Vite base path. The workflow is intended for a project repository such as `pdf-insight`, not a root `<owner>.github.io` site or a custom domain. Future pushes to `main` repeat deployment and lightweight API checks; the sample inference runs only when explicitly enabled in a manual workflow run.

`npm run verify:cloud` needs `API_URL` and `FRONTEND_ORIGIN` in the environment. It checks cloud configuration readiness, browser preflight and rejection of unrelated origins. Add `-- --sample` to analyze the synthetic invoice through the real backend, validate its JSON, and check USD 1,250.50 and the payment deadline. This performs real inference and uses provider quota. It fails when backend round-trip time reaches 30 seconds; passing still does not establish end-to-end browser timing, which also includes PDF extraction. The hosted smoke test passed in 3.271 seconds. OCR was verified separately in the public browser flow with an image-only fictional invoice.

The supplied interview PDF and its text, image and metadata fixtures stay local. Only the synthetic invoice is bundled into the public frontend. Automated unit tests use synthetic data and do not require the private files.

## Available configurations

Local Ollama remains the default and requires no API key. To exercise the cloud adapter from the Node backend, copy `.env.example` to `.env`, set `AI_PROVIDER=gemini`, set `GEMINI_MODEL` to an available Gemini model with vision and structured-output support, and set `GEMINI_API_KEY` locally. Never paste the key into chat or any `VITE_` variable. Restart the backend after changing configuration.

The implementation uses Google's documented [Generate Content structured-output REST interface](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Model availability and free quotas change; choose the model from the account's current model list instead of relying on a permanently hardcoded name. Gemini health reports configuration readiness, not a successful inference or remaining quota.

## Cloudflare option

Cloudflare Workers is a reasonable first option for this small public demo because PDF extraction runs in the browser and inference runs at the AI provider. The free plan's [CPU and memory limits](https://developers.cloudflare.com/workers/platform/limits/) still need a real deployment benchmark, especially for large requests and grounding. A successful local bundle is not proof that every request fits the free plan. Vercel's [4.5 MB function body limit](https://vercel.com/docs/functions/limitations) would require an alternative upload path for larger scan payloads. Supabase is useful if the app later needs accounts, a database or stored files.

The prepared files are `server/worker.ts` and `wrangler.toml`. When hosting is selected:

1. Install a current Wrangler release from the official npm registry and authenticate to the intended Cloudflare account.
2. Set `ALLOWED_ORIGINS` to the exact frontend origin, without a path or trailing slash. Set `GEMINI_MODEL` to a supported model. Choose a rate-limiter namespace ID unused by unrelated workers in that account.
3. Store the credential with `wrangler secret put GEMINI_API_KEY`. Never put it in `wrangler.toml`, browser code, committed files or shell history.
4. Validate a Wrangler dry run and a test deployment, including large request CPU/memory usage, rate limits, cancellation, real Gemini responses, cold/warm timing and quota exhaustion.
5. Build the frontend with `VITE_API_URL` pointing at the deployed API. For the later GitHub Pages deployment, also set `VITE_BASE_PATH` to the repository path. The sample PDF and PDF.js worker are bundled assets and inherit that base path.
6. Verify from an unrelated browser/device and keep the demo available for at least 14 days. Free quotas are limits, not an uptime guarantee.

`npm run build:worker` creates `dist-worker/worker.js` for local bundle verification. Publishing is a separate action. No database is needed for the brief's browser-local history.

## Security and privacy

The hosted adapter accepts only the configured browser origins and applies a [rate-limiter binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). CORS is not authentication; non-browser clients can imitate an Origin header. Use provider quotas and monitor usage for the anonymous demo. A larger public service would need an additional abuse control such as authentication or Turnstile.

The UI changes its disclosure when the backend reports cloud mode: document text and scan images go to Google Gemini API. Review the selected provider/model's data-use terms before allowing confidential documents. The local mode sends nothing to a cloud AI service.
