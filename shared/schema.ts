import { z } from 'zod';
import { CURRENCY_CODES, LANGUAGE_CODES } from './iso-codes';

export const MAX_FILE_BYTES = 10_000_000;
export const MAX_PAGES = 200;
export const MAX_TEXT_CHARS = 600000;
export const MAX_SCAN_PAGES = 8;

const text = z.string().trim().min(1);
const sourceSchema = z.object({ page: z.number().int().positive(), quote: text.max(600) });
const proseSourceSchema = z.object({
  page: z.number().int().positive(),
  quote: text.max(1200),
  origin: z.enum(['pdf-text', 'ocr']),
});
export const resultSchema = z.object({
  document: z.object({
    fileName: text,
    pages: z.number().int().positive(),
    language: z.enum(LANGUAGE_CODES as [string, ...string[]]),
    type: z.enum(['faktura', 'umowa', 'oferta', 'raport', 'inne']),
    title: text.nullable(),
    date: z.iso.date().nullable(),
  }),
  summary: text,
  keyPoints: z.array(text).min(3).max(7),
  proseSources: z
    .object({
      summary: z.array(proseSourceSchema).min(3).max(5),
      keyPoints: z.array(proseSourceSchema).min(3).max(7),
    })
    .optional(),
  entities: z.object({ organizations: z.array(text), people: z.array(text) }),
  amounts: z.array(
    z.object({
      value: z.number().finite(),
      currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
      context: text,
      source: sourceSchema.optional(),
    }),
  ),
  dates: z.array(z.object({ date: z.iso.date(), context: text, source: sourceSchema.optional() })),
  keywords: z.array(text),
});

export const analysisRequestSchema = z
  .object({
    fileName: text.max(250),
    fileSize: z.number().int().positive().max(MAX_FILE_BYTES),
    pageCount: z.number().int().positive().max(MAX_PAGES),
    pages: z
      .array(
        z.object({
          number: z.number().int().positive(),
          text: z.string().max(MAX_TEXT_CHARS),
          image: z.string().max(2_500_000).optional(),
        }),
      )
      .min(1)
      .max(MAX_PAGES),
  })
  .superRefine((request, ctx) => {
    if (
      request.pages.length !== request.pageCount ||
      request.pages.some((p, i) => p.number !== i + 1)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Nieprawidłowa kolejność lub liczba stron.' });
    }
    if (request.pages.reduce((sum, p) => sum + p.text.length, 0) > MAX_TEXT_CHARS) {
      ctx.addIssue({
        code: 'custom',
        message: 'Dokument ma zbyt dużo tekstu dla lokalnego modelu.',
      });
    }
    if (request.pages.filter((p) => p.image).length > MAX_SCAN_PAGES) {
      ctx.addIssue({ code: 'custom', message: 'Przekroczono limit stron OCR.' });
    }
    for (const page of request.pages) {
      if (page.image && !/^[A-Za-z0-9+/]+={0,2}$/.test(page.image)) {
        ctx.addIssue({ code: 'custom', message: 'Nieprawidłowy obraz strony.' });
      }
    }
  });

export const analysisMetaSchema = z.object({
  model: z.string(),
  elapsedMs: z.number(),
  ocrPages: z.array(z.number()),
  unreadPages: z.array(z.number()),
  warnings: z.array(z.string()),
  source: z.enum(['local-ai', 'cloud-ai']),
  chunkCount: z.number().int().positive().optional(),
  proseMode: z.literal('extractive').optional(),
});

export type AnalysisResult = z.infer<typeof resultSchema>;
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;
export type AnalysisRecord = {
  id: string;
  result: AnalysisResult;
  meta: AnalysisMeta;
  createdAt: string;
};

export const streamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    message: z.string(),
    stage: z.enum(['ocr', 'analysis', 'validation']),
  }),
  z.object({ type: z.literal('result'), result: resultSchema, meta: analysisMetaSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;
