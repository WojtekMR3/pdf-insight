# Verification record

Checks performed on 2026-10-06 with Node 22.17.1, Chrome, Ollama `qwen3.5:9b`, and an RTX 5080 with 16 GB VRAM. The supplied interview documents and their extracted fixtures remain local. The public repository includes an independently generated fictional invoice and synthetic unit-test inputs.

## Automated checks

`npm run check` runs strict TypeScript, ESLint, Prettier, 102 Vitest tests, the production frontend build and the Cloudflare Worker bundle. The natural-summary revision is validated locally before publishing; live checks for that revision are recorded separately below.

Tests cover required JSON fields, cardinality, ISO codes, valid dates, input limits, source quotations, amount/currency formats, amendment precedence, chunk coverage, malformed replies and the single correction attempt. Regressions cover decimal and minus-sign preservation, percentages, excerpt boundaries, quotation order, split UTF-8 stream chunks, terminal results, cancellation, response errors and denied browser storage. Provider tests mock Gemini; Worker tests cover exact origins, preflight, configuration, rate limits, request sizes, malformed bodies and streamed results.

## Local model and browser checks

The supplied document was tested locally, including scanned-page OCR, amended terms and an embedded instruction that the model must ignore. The final local run completed in **6.645 seconds of backend time**, with five summary quotations, seven key points and no unread pages. Earlier cold-model testing took approximately 22 seconds. These measurements do not establish hosted performance or a guarantee for every document.

The fictional one-page English invoice was tested through real browser file selection. Its result identified an invoice, USD 1,250.50, issue date 2026-10-01 and payment deadline 2026-10-15. Observed backend times were 3.007 and 6.280 seconds in separate runs.

`npm run benchmark` exercises a synthetic long agreement through the local model. A two-chunk run took 4.632 seconds and retained the amended 30 users and USD 1,500 fee. This is repetitive synthetic text, not a representative 200-page PDF performance benchmark.

Browser checks exercised PDF selection, export, cancellation and restart, dark/light themes, history reopening, settings keyboard navigation and validation errors for non-PDF, empty, corrupt, fake-header and oversized files. Downloaded JSON matched its visible preview byte-for-byte. Existing user history was preserved by disabling result saving during subsequent checks. Saving and reloading history had passed an earlier smoke test.

The desktop sidebar starts at the left edge and fills the viewport height. CSS Grid replaces Bootstrap. Mobile navigation appears above the content. Widths of 3116, 1440, 768 and 360 pixels showed no horizontal page overflow. Primary-button text contrast measured 5.11:1.

Successful native dragging from Explorer remains a manual check: the automation did not reliably transfer a real file through the browser extension. The drop handler's one-file rejection logic was inspected.

## Hosted verification

The deployment workflow checks the project, deploys the Worker and its secret, verifies configuration readiness and CORS, and then publishes GitHub Pages. A manual run with `verify_sample` enabled also analyzes the fictional invoice through Gemini and validates the resulting schema, amount, dates and backend round-trip time.

[Manual deployment run 6](https://github.com/WojtekMR3/pdf-insight/actions/runs/37459751011) passed the clean build, both API/CORS checks, real Gemini inference and Pages deployment. The hosted invoice smoke test took **3.271 seconds** and verified USD 1,250.50 and its payment deadline.

The [public demo](https://wojtekmr3.github.io/pdf-insight/) was then tested in Chrome. The text invoice completed in **3.346 seconds of backend time**. Downloaded JSON matched the visible JSON preview exactly. A newly created image-only fictional invoice exercised browser scan detection, Gemini OCR and final extraction; it completed in **6.256 seconds**, correctly reporting USD 2,450.75, issue date 2026-10-02, payment deadline 2026-10-16, `ocrPages: [1]`, no unread pages and no warnings. Both results remained in local history after reloading. These timers exclude browser PDF extraction and file-selection time.

An earlier manual run detected an inconsistent repeat response for an unrelated origin. Worker responses now always include `Vary: Origin`, including rejections, and verification requests bypass caches and report response diagnostics. The subsequent manual run passed both origin checks. The exact cause of the initial inconsistent response was not established.

The selected free-tier model is `gemini-3.1-flash-lite`; the project's dashboard currently reports 15 requests per minute, 250,000 input tokens per minute and 500 requests per day. Long documents, OCR and correction attempts can consume multiple requests. Quotas can change.

## Review fixes

A follow-up review of the deployed version found that running page headers and abbreviations such as `ul.` and `ust.` produced fragments in the live contract summary; that embedded AI instructions were excluded only by the prompt; that a dense long document could need 76 AI requests, above both the Workers Free limit of 50 subrequests and the 15-requests-per-minute quota; that OCR quota or timeout errors were hidden as unreadable pages; and that code errors were retried as invalid AI replies. Nineteen new tests cover the fixes.

On the supplied contract, the candidate sentence catalog shrank from 143 entries to 98, with no page headers, clause-number fragments or embedded instructions; the injected "1 PLN" amount left the evidence catalog while all other amounts and dates stayed identical. A local end-to-end run with `qwen3.5:9b` took 20.3 seconds including OCR and produced complete summary sentences. The frontend build output is byte-identical to the previously deployed version; the changes are backend-only.

## Remaining limits

The current summary is generated from selected source sentences and independently reviewed by the same provider. Numeric and citation checks reject several concrete failures, but model review does not guarantee semantic accuracy or complete source selection. Original and amended terms can appear together. Metadata and entities still involve model judgment; OCR can misread images. Very short PDFs with fewer than three eligible sentences return an explicit error. Results require comparison with the source for important decisions.

The public under-30-second end-to-end target, large-request CPU/memory limits, external-device access and 14-day availability remain unverified. A successful deployment cannot prove future uptime. The candidate's deadline and understanding of the implementation are also outside automated verification.

## PR regression review

A second review reproduced three data-loss regressions introduced by the readability changes: ordinary documentation obligations were classified as AI commands, complete amendment clauses longer than 500 characters disappeared when shorter sentences were available, and separate events sharing a date lost their contexts. Thirteen regression cases cover normal obligations, known direct injection commands, long amendment retention and date-event preservation. Five cases failed before the fixes; all pass with the corrections. Tests use synthetic document text and mocked model selections through the extraction pipeline; they do not establish live Gemini behavior.

## Natural-language summaries

The user retained the brief's 10 MB maximum and requested natural summaries with source references. Fifteen new tests cover source-resolved citations and OCR labels, unsupported numbers/signs/dates, missing or invented references, sentence count/completeness, Polish abbreviations, amended counts, a mocked semantic rejection of invented recurring billing, a single correction, review quota propagation, JSON export, citation rendering and legacy result compatibility. Existing extraction tests still test evidence selection independently. The Worker integration test exercises extraction, drafting and review through mocked Gemini transport.

A local browser run using the revised prompts and real Ollama produced three natural sentences for the synthetic invoice in 3.234 seconds of backend time. It retained USD 1,250.50 and the payment deadline, and expanding a citation displayed the matching exact quotations. The JSON view retained the natural summary and its references. A synthetic Polish agreement also produced three Polish summary sentences in 3.618 seconds. Direct backend analysis of a synthetic invoice image exercised real local OCR and the new summary flow in 6.071 seconds, preserving USD 2,450.75 and OCR attribution on every summary reference. This last test bypassed browser file selection. Live cloud checks for this release are pending deployment; older hosted timings above describe extractive versions.
