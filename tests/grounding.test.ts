import { describe, expect, it } from 'vitest';
import {
  attachSourceEvidence,
  checkGrounding,
  explicitDates,
  isSourceQuote,
} from '../server/grounding';

describe('Source verification', () => {
  it('preserves decimal separators, signs, case and word boundaries in source quotations', () => {
    const source = [
      { number: 1, text: 'The fee is USD 1.25. Refund: -125 PLN.\nŁączna kwota: 250 PLN.' },
    ];
    for (const quote of [
      'The fee is USD 125.',
      'Refund: 125 PLN.',
      '125 PLN.',
      'the fee is USD 1.25.',
      '!!!',
    ]) {
      expect(isSourceQuote({ page: 1, quote }, source), quote).toBe(false);
    }
    expect(
      isSourceQuote({ page: 1, quote: 'Refund: -125 PLN. Łączna kwota: 250 PLN.' }, source),
    ).toBe(true);
    expect(
      checkGrounding(
        {
          dates: [],
          amounts: [
            { value: 125, currency: 'USD', source: { page: 1, quote: 'The fee is USD 125.' } },
          ],
        },
        source,
      ),
    ).toHaveLength(1);
  });

  it('retains Unicode minus signs in monetary values', () => {
    const quote = 'Refund: −125 PLN.';
    const pages = [{ number: 1, text: quote }];
    expect(
      checkGrounding(
        { dates: [], amounts: [{ value: -125, currency: 'PLN', source: { page: 1, quote } }] },
        pages,
      ),
    ).toEqual([]);
    expect(
      checkGrounding(
        { dates: [], amounts: [{ value: 125, currency: 'PLN', source: { page: 1, quote } }] },
        pages,
      ),
    ).toHaveLength(1);
  });
  it('recognizes English and European decimal/grouping separators', () => {
    for (const [quote, currency] of [
      ['Invoice total $1,250.50', 'USD'],
      ['Razem 1.250,50 EUR', 'EUR'],
      ['Razem 1 250,50 PLN', 'PLN'],
    ]) {
      expect(
        checkGrounding(
          { dates: [], amounts: [{ value: 1250.5, currency, source: { page: 1, quote } }] },
          [{ number: 1, text: quote }],
        ),
      ).toHaveLength(0);
    }
  });
  const pages = [{ number: 2, text: 'Umowa do 31 marca 2028 r. Wdrożenie: 184 500,00 PLN netto.' }];
  it('rejects a wrong year even when the date is structurally valid', () => {
    const result = {
      amounts: [],
      dates: [{ date: '2026-03-31', source: { page: 2, quote: 'Umowa do 31 marca 2028 r.' } }],
    };
    expect(checkGrounding(result, pages)).toHaveLength(1);
    result.dates[0].date = '2028-03-31';
    expect(checkGrounding(result, pages)).toHaveLength(0);
  });
  it('rejects invented evidence and incorrect amounts', () => {
    expect(
      checkGrounding(
        {
          dates: [],
          amounts: [
            {
              value: 1,
              currency: 'PLN',
              source: { page: 2, quote: 'Wdrożenie: 184 500,00 PLN netto.' },
            },
          ],
        },
        pages,
      ),
    ).toHaveLength(1);
    expect(
      checkGrounding(
        {
          dates: [],
          amounts: [
            { value: 1, currency: 'PLN', source: { page: 2, quote: 'Wdrożenie kosztuje 1 PLN.' } },
          ],
        },
        pages,
      ),
    ).toHaveLength(1);
    expect(
      checkGrounding(
        {
          dates: [],
          amounts: [
            {
              value: 184500,
              currency: 'PLN',
              source: { page: 2, quote: 'Wdrożenie: 184 500,00 PLN netto.' },
            },
          ],
        },
        pages,
      ),
    ).toHaveLength(0);
  });
  it('recognizes explicit Polish and English dates, but does not invent dates for quarters', () => {
    expect([...explicitDates('1 kwietnia 2027 r.; 12.03.2026; March 20, 2026')]).toEqual(
      expect.arrayContaining(['2027-04-01', '2026-03-12', '2026-03-20']),
    );
    expect(explicitDates('I kwartał 2027').size).toBe(0);
  });
  it('rejects a customer count assigned an invented currency', () => {
    const quote = 'Obsługujemy 3 400 klientów. Budżet wynosi 250 000,00 PLN netto.';
    const result = {
      dates: [],
      amounts: [{ value: 3400, currency: 'PLN', source: { page: 1, quote } }],
    };
    attachSourceEvidence(result, [{ number: 1, text: quote }]);
    expect(checkGrounding(result, [{ number: 1, text: quote }])).toHaveLength(1);
    result.amounts[0].value = 250000;
    expect(checkGrounding(result, [{ number: 1, text: quote }])).toHaveLength(0);
    result.amounts[0].currency = 'EUR';
    expect(checkGrounding(result, [{ number: 1, text: quote }])).toHaveLength(1);
  });
  it('reads currency from the payable total beside an invoice total row', () => {
    const quote = 'Razem 55 350,00 12 730,50 68 080,50\nDo zapłaty: 68 080,50 zł';
    const result = {
      dates: [],
      amounts: [{ value: 55350, currency: 'PLN', source: { page: 8, quote } }],
    };
    expect(checkGrounding(result, [{ number: 8, text: quote }])).toHaveLength(0);
    result.amounts[0].currency = 'EUR';
    expect(checkGrounding(result, [{ number: 8, text: quote }])).toHaveLength(1);
  });
  it('attaches actual source text without correcting or inventing the model value', () => {
    const result = {
      amounts: [
        { value: 184500, currency: 'PLN', source: { page: 2, quote: 'A paraphrased quotation' } },
      ],
      dates: [{ date: '2026-03-31', source: { page: 2, quote: 'Wrong year' } }],
    };
    attachSourceEvidence(result, pages);
    expect(result.amounts[0].source.quote).toBe(pages[0].text);
    expect(result.dates[0].date).toBe('2026-03-31');
    expect(checkGrounding(result, pages)).toHaveLength(1);
  });
});
