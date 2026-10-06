import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileSearch,
  FileText,
  History,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  ScanLine,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { analyze, getHealth, loadSample, type Health } from './api/client';
import type { ExtractedDocument } from './lib/pdf';
import { clearHistory, readHistory, saveHistory } from './lib/history';
import type { AnalysisRecord } from '../shared/schema';
import Results from './components/Results';
import { applyTheme, readTheme } from './lib/theme';

type Phase = 'empty' | 'extracting' | 'ready' | 'ocr' | 'analysis' | 'validation' | 'done';
const busyPhases: Phase[] = ['extracting', 'ocr', 'analysis', 'validation'];

export default function App() {
  const [theme, setTheme] = useState(readTheme);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState('');
  const [view, setView] = useState<'analyze' | 'history'>('analyze');
  const [phase, setPhase] = useState<Phase>('empty');
  const [document, setDocument] = useState<ExtractedDocument | null>(null);
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [history, setHistory] = useState(readHistory);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [remember, setRemember] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const busy = busyPhases.includes(phase);
  const local = health?.local === true;
  const visibleError = error || healthError;

  useEffect(() => applyTheme(theme), [theme]);

  async function refreshHealth() {
    setHealthError('');
    try {
      setHealth(await getHealth());
    } catch {
      setHealth(null);
      setHealthError('Nie można połączyć się z usługą. Spróbuj ponownie w sekcji pomocy.');
    }
  }
  useEffect(() => {
    void refreshHealth();
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);

  function reset() {
    abort.current?.abort();
    abort.current = null;
    setDocument(null);
    setRecord(null);
    setError('');
    setPhase('empty');
    setShowSource(false);
    setView('analyze');
    setElapsed(0);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function selectFile(file: File) {
    await prepareFile(async () => file);
  }

  async function prepareFile(loadFile: (signal: AbortSignal) => Promise<File>) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setView('analyze');
    setError('');
    setRecord(null);
    setDocument(null);
    setShowSource(false);
    setPhase('extracting');
    setStatus('Sprawdzam dokument…');
    startedAt.current = Date.now();
    setElapsed(0);
    try {
      const file = await loadFile(controller.signal);
      controller.signal.throwIfAborted();
      const { extractPdf } = await import('./lib/pdf');
      controller.signal.throwIfAborted();
      const extracted = await extractPdf(file, controller.signal, (message) => {
        if (!controller.signal.aborted) setStatus(message);
      });
      if (controller.signal.aborted) return;
      setDocument(extracted);
      setPhase('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : 'Nie udało się odczytać pliku.');
      setPhase('empty');
    }
  }

  async function runAnalysis() {
    if (!document || busy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError('');
    setPhase('analysis');
    setStatus('Rozpoczynam analizę…');
    startedAt.current = Date.now();
    setElapsed(0);
    try {
      await analyze(document.request, controller.signal, (event) => {
        if (controller.signal.aborted || abort.current !== controller) return;
        if (event.type === 'progress') {
          setPhase(event.stage);
          setStatus(event.message);
        }
        if (event.type === 'result') {
          const next: AnalysisRecord = {
            id: crypto.randomUUID(),
            result: event.result,
            meta: event.meta,
            createdAt: new Date().toISOString(),
          };
          setRecord(next);
          setPhase('done');
          if (remember) {
            const updated = [next, ...readHistory()].slice(0, 5);
            if (saveHistory(updated)) setHistory(updated);
            else
              setError(
                'Analiza gotowa. Przeglądarka nie pozwoliła zapisać historii; pobierz JSON, aby zachować wynik.',
              );
          }
        }
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : 'Nie udało się ukończyć analizy.');
      setPhase('ready');
    }
  }

  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setPhase(document ? 'ready' : 'empty');
    setStatus('');
  }
  function openHistory(item: AnalysisRecord) {
    abort.current?.abort();
    abort.current = null;
    setDocument(null);
    setRecord(item);
    setPhase('done');
    setView('analyze');
    setError('');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Przejdź do treści
      </a>
      <div className="app-frame">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              if (!busy) reset();
            }}
            aria-label="PDF Insight — strona główna"
          >
            <span className="brand-icon">
              <FileSearch size={23} strokeWidth={1.8} />
            </span>
            <span>
              PDF<span className="brand-light">Insight</span>
            </span>
          </a>
          <nav aria-label="Nawigacja główna">
            <button
              className={view === 'analyze' ? 'nav-button active' : 'nav-button'}
              onClick={() => setView('analyze')}
            >
              <LayoutDashboard size={18} /> Nowa analiza <ChevronRight size={15} />
            </button>
            <button
              className={view === 'history' ? 'nav-button active' : 'nav-button'}
              disabled={busy}
              onClick={() => setView('history')}
            >
              <History size={18} /> Historia <span className="nav-count">{history.length}</span>
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button className="nav-button" onClick={() => dialog.current?.showModal()}>
              <Settings2 size={18} /> Pomoc i prywatność
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              {view === 'history' ? 'Historia analiz' : 'Analiza PDF'}
            </div>
            <div className="topbar-actions">
              <button
                className={`connection-badge ${health?.available ? '' : 'offline'}`}
                onClick={() => dialog.current?.showModal()}
              >
                <span className="status-dot" />
                {health
                  ? health.available
                    ? 'Gotowe do analizy'
                    : 'Usługa niedostępna'
                  : healthError
                    ? 'Brak połączenia'
                    : 'Łączenie…'}
              </button>
              <button
                className="theme-toggle"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Włącz jasny motyw' : 'Włącz ciemny motyw'}
                title={theme === 'dark' ? 'Włącz jasny motyw' : 'Włącz ciemny motyw'}
              >
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                <span>{theme === 'dark' ? 'Jasny' : 'Ciemny'}</span>
              </button>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {visibleError && (
              <div className="notice error" role="alert">
                <span>{visibleError}</span>
                {error && (
                  <button aria-label="Zamknij komunikat" onClick={() => setError('')}>
                    <X size={17} />
                  </button>
                )}
              </div>
            )}
            {view === 'history' ? (
              <>
                <div className="page-heading">
                  <h1>Historia analiz</h1>
                  <p>Ostatnie 5 wyników, zapisane w tej przeglądarce.</p>
                </div>
                <div className="history-toolbar">
                  <span>{history.length} zapisanych analiz</span>
                  <button
                    className="button secondary"
                    disabled={!history.length}
                    onClick={() => {
                      if (clearHistory()) {
                        setHistory([]);
                        setError('');
                      } else {
                        setError(
                          'Przeglądarka nie pozwoliła wyczyścić historii. Spróbuj ponownie.',
                        );
                      }
                    }}
                  >
                    <Trash2 size={15} /> Wyczyść historię
                  </button>
                </div>
                {history.length ? (
                  <div className="history-list">
                    {history.map((item) => (
                      <button
                        className="card history-item"
                        key={item.id}
                        onClick={() => openHistory(item)}
                      >
                        <span className="file-symbol">
                          <FileText size={23} />
                        </span>
                        <span>
                          <strong>
                            {item.result.document.title || item.result.document.fileName}
                          </strong>
                          <small>
                            {item.result.document.fileName} ·{' '}
                            {new Date(item.createdAt).toLocaleString('pl-PL')}
                          </small>
                        </span>
                        <ChevronRight size={19} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="card history-empty">
                    <History size={38} />
                    <h2>Brak zapisanych analiz</h2>
                    <p>Tutaj znajdziesz wyniki swoich dokumentów.</p>
                    <button className="button primary" onClick={reset}>
                      <Plus size={16} /> Nowa analiza
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {!record && (
                  <div className="page-heading">
                    <h1>Twój PDF w skrócie.</h1>
                    <p>Dodaj dokument. Otrzymaj podsumowanie, ważne dane i plik JSON.</p>
                  </div>
                )}
                {record && (
                  <div className="back-row">
                    <span>
                      <FileCheck2 size={17} /> {record.result.document.fileName}
                    </span>
                    <button className="button secondary" onClick={reset}>
                      <Plus size={16} /> Nowa analiza
                    </button>
                  </div>
                )}
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  accept=".pdf,application/pdf"
                  aria-label="Wybierz plik PDF"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void selectFile(file);
                    event.target.value = '';
                  }}
                />
                {!record && (
                  <div className="upload-layout">
                    <section className="card upload-card" aria-label="Dodaj dokument">
                      <div className="card-topline">
                        <span>
                          <Upload size={18} /> Dodaj PDF
                        </span>
                        <span className="muted">PDF · do 10 MB</span>
                      </div>
                      {!document && phase !== 'extracting' && (
                        <>
                          <button
                            className={`dropzone ${dragging ? 'dragging' : ''}`}
                            onClick={() => fileInput.current?.click()}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(event) => {
                              event.preventDefault();
                              setDragging(false);
                              const files = event.dataTransfer.files;
                              if (files.length !== 1) {
                                setError('Dodaj jeden plik PDF na raz.');
                                return;
                              }
                              void selectFile(files[0]);
                            }}
                          >
                            <span className="upload-art">
                              <FileText size={37} strokeWidth={1.4} />
                              <span>
                                <Upload size={14} />
                              </span>
                            </span>
                            <strong>
                              {dragging ? 'Upuść PDF tutaj' : 'Przeciągnij tutaj PDF'}
                            </strong>
                            <span>
                              lub <b>wybierz plik</b>
                            </span>
                          </button>
                          <div className="sample-divider">
                            <span /> Nie masz pliku? <span />
                          </div>
                          <button
                            className="sample-button"
                            onClick={() => void prepareFile(loadSample)}
                          >
                            <span className="file-symbol">
                              <FileText size={21} />
                            </span>
                            <span>
                              <strong>Wypróbuj przykład</strong>
                              <small>Faktura · 1 strona</small>
                            </span>
                            <ArrowRight size={18} />
                          </button>
                        </>
                      )}
                      {phase === 'extracting' && (
                        <div className="extracting">
                          <LoaderCircle className="spin" size={30} />
                          <h3>Odczytuję PDF…</h3>
                          <p role="status">{status}</p>
                          <button className="text-button" onClick={cancel}>
                            Anuluj
                          </button>
                        </div>
                      )}
                      {document && (
                        <>
                          <div className="selected-document">
                            <div className="document-preview">
                              {document.thumbnail ? (
                                <img
                                  src={document.thumbnail}
                                  alt="Podgląd pierwszej strony dokumentu"
                                />
                              ) : (
                                <FileText size={42} />
                              )}
                            </div>
                            <div>
                              <span className="file-badge">PDF</span>
                              <h3>{document.request.fileName}</h3>
                              <p>
                                Liczba stron: {document.request.pageCount} <span>·</span>{' '}
                                {(document.request.fileSize / 1024).toFixed(0)} KB
                              </p>
                              <span className="success-line">
                                <Check size={15} /> Plik gotowy do analizy
                              </span>
                              {document.scanPages.length > 0 && (
                                <span className="scan-line">
                                  <ScanLine size={15} /> Wykryte skany: {document.scanPages.length}
                                </span>
                              )}
                            </div>
                            {!busy && (
                              <button
                                className="icon-button"
                                aria-label="Usuń wybrany dokument"
                                onClick={reset}
                              >
                                <X size={18} />
                              </button>
                            )}
                          </div>
                          {document.warnings.map((warning) => (
                            <p className="notice warning" key={warning}>
                              {warning}
                            </p>
                          ))}
                          {!busy && (
                            <>
                              <button
                                className="source-toggle"
                                onClick={() => setShowSource(!showSource)}
                              >
                                <FileSearch size={16} />
                                {showSource ? 'Ukryj tekst' : 'Podgląd tekstu'}
                                <ChevronRight size={15} />
                              </button>
                              {showSource && <pre className="source-preview">{document.text}</pre>}
                              <label className="remember">
                                <input
                                  type="checkbox"
                                  checked={remember}
                                  onChange={(event) => setRemember(event.target.checked)}
                                />{' '}
                                Zapisz wynik w historii na tym urządzeniu
                              </label>
                              <button
                                className="button primary analyze-button"
                                disabled={!health?.available}
                                onClick={() => void runAnalysis()}
                              >
                                <Sparkles size={17} />
                                {error ? 'Spróbuj ponownie' : 'Analizuj dokument'}
                                <ArrowRight size={17} />
                              </button>
                              {!health?.available && (
                                <p className="inline-help">
                                  Usługa niedostępna. Sprawdź połączenie w sekcji pomocy.
                                </p>
                              )}
                            </>
                          )}
                          {busy && (
                            <div className="progress-panel" aria-live="polite">
                              <div className="progress-title">
                                <LoaderCircle className="spin" size={19} />
                                <strong>
                                  {phase === 'ocr'
                                    ? 'Odczytuję skan'
                                    : phase === 'validation'
                                      ? 'Sprawdzam wynik'
                                      : 'Analizuję dokument'}
                                </strong>
                                <span>{elapsed} s</span>
                              </div>
                              <div className="progress-track">
                                <span />
                              </div>
                              <p>{status}</p>
                              <div className="progress-bottom">
                                <small>Długie dokumenty i skany mogą wymagać więcej czasu.</small>
                                <button className="text-button" onClick={cancel}>
                                  Anuluj
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      <div className="privacy-line">
                        <LockKeyhole size={13} />
                        <span>
                          {health
                            ? local
                              ? 'Dokument jest analizowany tylko na tym komputerze.'
                              : 'Tekst i skany trafią do Google do analizy. Nie dodawaj danych poufnych.'
                            : 'Sprawdzam sposób przetwarzania dokumentu…'}
                        </span>
                      </div>
                    </section>
                    <aside className="how-it-works">
                      <h2>Trzy proste kroki</h2>
                      <div className="how-step">
                        <span>1</span>
                        <div>
                          <strong>Wybierz PDF</strong>
                          <p>Własny plik lub gotowy przykład.</p>
                        </div>
                      </div>
                      <div className="how-step">
                        <span>2</span>
                        <div>
                          <strong>Kliknij „Analizuj dokument”</strong>
                          <p>Podsumowanie, kwoty i daty w jednym miejscu.</p>
                        </div>
                      </div>
                      <div className="how-step">
                        <span>3</span>
                        <div>
                          <strong>Pobierz wynik</strong>
                          <p>Zapisz dane przyciskiem „Pobierz JSON”.</p>
                        </div>
                      </div>
                    </aside>
                  </div>
                )}
                {record && <Results key={record.id} record={record} sourceText={document?.text} />}
              </>
            )}
            <footer>
              <span>PDF Insight</span>
              <button onClick={() => dialog.current?.showModal()}>
                <CircleHelp size={16} /> Pomoc i prywatność
              </button>
            </footer>
          </main>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="settings-dialog"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="dialog-heading">
          <span className="small-icon">
            <CircleHelp size={22} />
          </span>
          <button
            className="icon-button"
            aria-label="Zamknij pomoc"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <h2>Pomoc i prywatność</h2>
        <p>
          {!health
            ? 'Sprawdź połączenie, aby rozpocząć analizę.'
            : local
              ? 'Analiza odbywa się na tym komputerze. Dokument nie trafia do chmury.'
              : 'Tekst i obrazy skanów trafiają do Google Gemini do analizy. Nie dodawaj danych poufnych do wersji demonstracyjnej.'}
        </p>
        <dl>
          <div>
            <dt>Dokument</dt>
            <dd>PDF do 10 MB i 200 stron</dd>
          </div>
          <div>
            <dt>Skany</dt>
            <dd>Odczyt do 8 stron ze skanem</dd>
          </div>
          <div>
            <dt>Historia</dt>
            <dd>5 ostatnich wyników, tylko w tej przeglądarce</dd>
          </div>
          <div>
            <dt>Połączenie</dt>
            <dd>{health?.available ? 'Gotowe do analizy' : 'Usługa niedostępna'}</dd>
          </div>
        </dl>
        <p className="settings-detail">
          Długie dokumenty i skany mogą wymagać więcej czasu. Ważne informacje sprawdź w oryginale.
        </p>
        <button className="button primary" onClick={() => void refreshHealth()}>
          Sprawdź połączenie
        </button>
      </dialog>
    </div>
  );
}
