# Architecture and code walkthrough

## Request flow

1. `src/App.tsx` controls upload, progress, cancellation, results, history and theme. PDF.js loads only when a file is selected.
2. `src/lib/pdf.ts` validates the extension, MIME type, 10 MB size and PDF header. The browser extracts text with a bundled PDF.js worker. Pages with fewer than 30 non-whitespace characters are rendered for OCR.
3. `src/api/client.ts` sends extracted text and scan images to the backend and validates newline-delimited JSON events. The first result ends the stream; cancelled operations cannot deliver buffered progress or results. Invalid responses produce Polish errors. It never receives an AI credential.
4. `server/ai.ts` provides interchangeable Ollama and Gemini transports. Ollama accepts loopback URLs and local models only. Gemini uses a server-side API key header.
5. `server/analysis.ts` transcribes image-only pages, divides long documents into overlapping chunks, selects verified source passages from each chunk, and merges them for the final analysis. Chunk reductions retain original page numbers and must quote the source.
6. `server/evidence.ts` indexes explicit dates and monetary values with their original source excerpts. AI selects evidence IDs instead of retyping amounts, years or date descriptions. The server resolves these IDs to the final required JSON fields. This both reduces generated tokens and prevents copying errors in structured numeric fields.
7. `server/prose.ts` builds a catalog of whole source sentences and resolves the model's selected IDs to verbatim summary/key-point quotations, sorted in document order. Each quotation includes a page and a PDF-text/OCR origin. Key points prefer sentences that the summary does not already quote. Documents with fewer than three eligible sentences fail explicitly; there is no generated-prose fallback.
   `server/sentences.ts` decides which source text is eligible. It joins sentences split after common abbreviations (`ul.`, `ust.`, `sp. z o.o.`), starts a new sentence at clause numbers (`1.`, `§ 3.`), and finds lines repeated on most pages (running headers, footers, page numbers). Prose skips all of them; evidence skips only those carrying a page number, so a total printed on every page remains. It also detects sentences addressed to an AI system; prose and evidence catalogs drop them, and evidence excerpts stop at them, so embedded instructions never reach the final model request. When the stricter sentence rules leave fewer than three sentences, the catalog falls back to plain sentence segmentation.
8. `server/grounding.ts` verifies quotations, currencies and dates, and catches unlabelled superseded user/seat/license counts in explicit Polish/English amendments. Quotation matching preserves punctuation, signs, decimal separators and case. It does not establish that selected quotations include every relevant qualification or amendment.
9. Invalid JSON, invalid schema, truncation and failed grounding receive one correction attempt. A second invalid reply produces a Polish error. Code errors are not retried. The transport retries one network failure or temporary 5xx response, then reports it. An unusable OCR transcription marks its page unread; quota, timeout and outage errors stop the analysis instead. Unread OCR pages are visibly flagged.
10. `shared/schema.ts` validates requests and final results on both sides. `src/components/Results.tsx` renders text through React, previews JSON and downloads it. `src/lib/history.ts` keeps up to five results in the browser and reports storage failures, including failed deletion, to the interface.

## Why two backend entry points?

`server/index.ts` serves the app and API on this PC. It binds to loopback, restricts origins, enforces a 12 MiB request limit and six requests per minute, and admits one analysis at a time. `server/worker.ts` is an optional Cloudflare adapter using the same analysis engine. It requires an exact origin allowlist and a Cloudflare rate-limiter binding; missing configuration fails closed. Workers rate limits apply per Cloudflare location, not as a global billing cap. An anonymous IP bucket can also be shared by multiple visitors behind NAT.

The worker build validates that the shared engine bundles without Node APIs. Node-based handler tests exercise the Web API contract with mocked Gemini responses; they are not a Cloudflare deployment or a real Gemini test.

## Data and limits

- PDF maximum: 10,000,000 bytes, 200 pages and 600,000 extracted characters.
- OCR: up to eight pages with little or no text. Mixed pages containing both substantial text and scanned regions can be missed.
- Chunk size: 32,000 characters for local Ollama and 100,000 for Gemini, with overlap. Every chunk is processed; iterative source selection reduces oversized merged input, and a dense result is reduced again from the selected passages rather than from the whole document. The hosted provider stops after 40 AI requests per analysis to stay below the Workers Free limit of 50 subrequests. Long documents and retries may exceed 30 seconds.
- Structured evidence recognizes ISO/numeric and written Polish/English dates and common monetary formats. Unsupported or ambiguous facts may be omitted. A bare dollar sign needs an explicit USD marker; ambiguous currencies are not guessed.
- Only important amounts/dates are selected. Equal amount/currency pairs are deduplicated, preferring amendment evidence; this can collapse separate obligations with the same value. Detected amendment amounts are appended even if the AI omits them. This is a summary, not a complete ledger of every number in the PDF.
- OCR output is itself model-generated. Verified quotation matching does not prove that OCR read the original image correctly.
- Original files are not stored by the backend. Browser history stores results, not complete PDFs. Local benchmark artifacts belong under ignored `tmp/`.

## Code lists

`shared/iso-codes.ts` contains a dated snapshot, checked on 2026-10-06, of [Library of Congress ISO language codes](https://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt) and SIX [current](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml) and [historical](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-three.xml) currency codes. Historical currencies remain valid for older PDFs. Refresh by taking nonempty two-letter fields from the language list and distinct three-letter `Ccy` elements from both currency XML files. Runtime validation uses membership, not just character counts.

## Before explaining this project in an interview

Be able to trace one upload through the files above; explain the difference between PDF text extraction and OCR, why an API key stays on the backend, how evidence IDs prevent numeric copying errors, why source checks do not guarantee semantic accuracy, how chunking merges long documents, and how cancellation and the one-retry rule work. Read the implementation and ask about any line you cannot explain; an automated check cannot establish your understanding.
