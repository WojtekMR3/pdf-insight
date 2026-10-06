import { useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  Code2,
  Copy,
  Download,
  FileText,
  Landmark,
  ListChecks,
  Tag,
  Users,
  Wallet,
} from 'lucide-react';
import type { AnalysisRecord } from '../../shared/schema';
import { downloadResult, exportJson } from '../lib/history';

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    value,
  );

export default function Results({
  record,
  sourceText,
}: {
  record: AnalysisRecord;
  sourceText?: string;
}) {
  const [tab, setTab] = useState('summary');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const { result, meta } = record;
  async function copy() {
    try {
      await navigator.clipboard.writeText(exportJson(record));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Nie można skopiować danych. Użyj przycisku „Pobierz JSON”.');
    }
  }
  return (
    <section className="results" aria-label="Wynik analizy">
      <div className="result-heading">
        <div>
          <span className="eyebrow">
            <CheckCheck size={15} /> ANALIZA ZAKOŃCZONA
          </span>
          <h2>Wynik analizy</h2>
          <p>{result.document.title || result.document.fileName}</p>
        </div>
        <button className="button primary" onClick={() => downloadResult(record)}>
          <Download size={16} /> Pobierz JSON
        </button>
      </div>
      <div className="result-stats">
        <span>
          <FileText size={15} />
          Liczba stron: {result.document.pages}
        </span>
        <span>{result.document.language.toUpperCase()}</span>
        <span className="capitalize">{result.document.type}</span>
        <span>
          <CalendarDays size={15} />
          {result.document.date || 'Brak daty'}
        </span>
      </div>
      {meta.warnings.map((warning) => (
        <div className="notice warning" key={warning}>
          {warning}
        </div>
      ))}
      {meta.ocrPages.length > 0 && (
        <div className="ocr-note">
          <Check size={15} /> Odczytano również skany ze stron: {meta.ocrPages.join(', ')}.
        </div>
      )}
      <div className="tabs" aria-label="Widok wyniku">
        {[
          ['summary', 'Podsumowanie', FileText],
          ['data', 'Dane dokumentu', ListChecks],
          ['json', 'JSON', Code2],
          ...(sourceText ? [['source', 'Tekst źródłowy', FileText]] : []),
        ].map(([id, label, Icon]) => {
          const TabIcon = Icon as typeof FileText;
          return (
            <button
              key={String(id)}
              className={tab === id ? 'active' : ''}
              aria-pressed={tab === id}
              onClick={() => setTab(String(id))}
            >
              <TabIcon size={15} />
              {String(label)}
            </button>
          );
        })}
      </div>
      {tab === 'summary' && (
        <div className="overview-grid">
          <div className="overview-main">
            <article className="card summary-card">
              <div className="section-label">
                <FileText size={17} /> W skrócie
              </div>
              {result.summarySentences ? (
                result.summarySentences.map((sentence, index) => (
                  <div key={index}>
                    <p>{sentence.text}</p>
                    <details>
                      <summary className="source-reference">
                        Źródła · str.{' '}
                        {[...new Set(sentence.sources.map((source) => source.page))].join(', ')}
                      </summary>
                      {sentence.sources.map((source, sourceIndex) => (
                        <blockquote key={sourceIndex}>
                          <p>{source.quote}</p>
                          <span className="source-reference">
                            str. {source.page}
                            {source.origin === 'ocr' ? ' · OCR' : ''}
                          </span>
                        </blockquote>
                      ))}
                    </details>
                  </div>
                ))
              ) : result.proseSources ? (
                <>
                  {result.proseSources.summary.map((source, index) => (
                    <p key={index}>
                      {source.quote}{' '}
                      <span className="source-reference">
                        str. {source.page}
                        {source.origin === 'ocr' ? ' · OCR' : ''}
                      </span>
                    </p>
                  ))}
                </>
              ) : (
                <p>{result.summary}</p>
              )}
            </article>
            <article className="card">
              <div className="section-label">
                <ListChecks size={17} /> Kluczowe informacje
              </div>
              <ol className="key-points">
                {result.keyPoints.map((point, index) => (
                  <li key={point}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <p>
                      {point}
                      {result.proseSources?.keyPoints[index] && (
                        <>
                          {' '}
                          <span className="source-reference">
                            str. {result.proseSources.keyPoints[index].page}
                            {result.proseSources.keyPoints[index].origin === 'ocr' ? ' · OCR' : ''}
                          </span>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </article>
          </div>
          <aside className="overview-side">
            <article className="card">
              <div className="section-label">
                <Landmark size={17} /> Organizacje
              </div>
              {result.entities.organizations.length ? (
                result.entities.organizations.map((org) => (
                  <div className="entity" key={org}>
                    <span className="entity-avatar">{org.slice(0, 1)}</span>
                    <span>{org}</span>
                  </div>
                ))
              ) : (
                <p className="muted">Brak informacji w dokumencie.</p>
              )}
            </article>
            <article className="card">
              <div className="section-label">
                <Tag size={17} /> Słowa kluczowe
              </div>
              <div className="tags">
                {result.keywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            </article>
            <p className="result-note">Ważne informacje sprawdź w oryginale.</p>
          </aside>
        </div>
      )}
      {tab === 'data' && (
        <div className="data-grid">
          <article className="card full">
            <div className="section-label">
              <Wallet size={17} /> Kwoty <span className="count">{result.amounts.length}</span>
            </div>
            {result.amounts.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kwota</th>
                      <th>Waluta</th>
                      <th>Kontekst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.amounts.map((amount, index) => (
                      <tr key={index}>
                        <td className="amount">{money(amount.value, amount.currency)}</td>
                        <td>{amount.currency}</td>
                        <td>{amount.context}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Brak kwot w dokumencie.</p>
            )}
          </article>
          <article className="card">
            <div className="section-label">
              <CalendarDays size={17} /> Daty
            </div>
            <div className="date-list">
              {result.dates.map((date, index) => (
                <div key={index}>
                  <time>{date.date}</time>
                  <p>{date.context}</p>
                </div>
              ))}
            </div>
            {!result.dates.length && <p className="muted">Brak pełnych dat w dokumencie.</p>}
          </article>
          <article className="card">
            <div className="section-label">
              <Users size={17} /> Osoby
            </div>
            {result.entities.people.map((person) => (
              <div className="person" key={person}>
                <span className="entity-avatar neutral">
                  {person
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                {person}
              </div>
            ))}
            {!result.entities.people.length && <p className="muted">Brak informacji o osobach.</p>}
          </article>
        </div>
      )}
      {tab === 'json' && (
        <article className="card code-card">
          <div className="code-heading">
            <span>
              <Code2 size={16} /> wynik.json
            </span>
            <button className="button secondary small" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Skopiowano' : 'Kopiuj'}
            </button>
          </div>
          {copyError && <p role="alert">{copyError}</p>}
          <pre>{exportJson(record)}</pre>
        </article>
      )}
      {tab === 'source' && (
        <article className="card source-card">
          <div className="section-label">
            <FileText size={17} /> Tekst wyodrębniony z PDF <ArrowUpRight size={16} />
          </div>
          <p className="muted">
            Tekst z PDF. Odczytane skany są uwzględnione w analizie, ale nie w tym podglądzie.
          </p>
          <pre>{sourceText}</pre>
        </article>
      )}
    </section>
  );
}
