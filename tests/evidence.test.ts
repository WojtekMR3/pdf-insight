import { describe, expect, it } from 'vitest';
import { buildEvidence, extractionSchema, resolveEvidence } from '../server/evidence';
import { buildProseCatalog } from '../server/prose';
import { checkGrounding } from '../server/grounding';

describe('Deterministic numeric evidence', () => {
  it('does not assign the invoice currency to percentages on total rows', () => {
    const pages = [{ number: 1, text: 'Razem 100% 184 500,00 zł' }];
    expect(buildEvidence(pages).amounts.map((entry) => entry.value)).toEqual([184500]);
  });

  it('keeps inherited-currency invoice excerpts on complete word boundaries', () => {
    const pages = [
      {
        number: 1,
        text:
          'Razem 55 350,00 12 730,50 68 080,50\nDo zapłaty: 68 080,50 zł\n' +
          'Dodatkowe informacje o płatności i szczegóły rachunku. '.repeat(8),
      },
    ];
    const evidence = buildEvidence(pages);
    expect(evidence.amounts.map((entry) => entry.value)).toEqual([55350, 12730.5, 68080.5]);
    expect(checkGrounding(evidence, pages)).toEqual([]);
  });
  it('does not turn a negative adjustment into a charge', () => {
    expect(buildEvidence([{ number: 1, text: 'Adjustment: −125.50 USD.' }]).amounts[0].value).toBe(
      -125.5,
    );
  });
  const pages = [
    {
      number: 1,
      text: 'Umowa do 31 marca 2028 r. Opłata wynosi 13 100,00 PLN netto od 1 kwietnia 2027 r. Hosting: 890 USD miesięcznie. Licencje: 8 600 EUR rocznie. System obsługuje 135 użytkowników.',
    },
  ];
  it('extracts exact source values without classifying a user count as money', () => {
    const catalog = buildEvidence(pages);
    expect(catalog.amounts.map(({ value, currency }) => [value, currency])).toEqual([
      [13100, 'PLN'],
      [890, 'USD'],
      [8600, 'EUR'],
    ]);
    expect(catalog.dates.map(({ date }) => date)).toEqual(['2028-03-31', '2027-04-01']);
    expect(resolveEvidence(catalog, ['a2'], ['d1']).amounts[0].value).toBe(890);
    expect(resolveEvidence(catalog, [], ['d1']).dates[0].date).toBe('2028-03-31');
    for (const entry of [...catalog.amounts, ...catalog.dates])
      expect(pages[0].text).toContain(entry.source.quote);
  });
  it('requires evidence for each currency and rejects invented IDs', () => {
    const schema = extractionSchema(buildEvidence(pages), buildProseCatalog(pages)).shape.amounts;
    expect(schema.safeParse({ PLN: ['a1'], USD: ['a2'], EUR: ['a3'] }).success).toBe(true);
    expect(schema.safeParse({ PLN: ['a1'], USD: [], EUR: ['a3'] }).success).toBe(false);
    expect(schema.safeParse({ PLN: ['a2'], USD: ['a2'], EUR: ['a3'] }).success).toBe(false);
    expect(schema.safeParse({ PLN: ['invented'], USD: ['a2'], EUR: ['a3'] }).success).toBe(false);
  });
  it('handles English/European number formats and explicit missing or ambiguous data', () => {
    expect(
      buildEvidence([
        { number: 1, text: 'Total USD 1,250.50 and 1.250,50 EUR on October 1, 2026.' },
      ]).amounts.map(({ value }) => value),
    ).toEqual([1250.5, 1250.5]);
    expect(
      buildEvidence([{ number: 1, text: 'Total $1250; next quarter; February 30, 2026.' }]),
    ).toEqual({ amounts: [], dates: [] });
  });
  it('preserves invoice total columns without merging adjacent amounts', () => {
    const catalog = buildEvidence([
      { number: 1, text: 'Razem 55 350,00 12 730,50 68 080,50\nDo zapłaty: 68 080,50 zł' },
    ]);
    expect(catalog.amounts.map(({ value }) => value)).toEqual(
      expect.arrayContaining([55350, 12730.5, 68080.5]),
    );
  });
});
