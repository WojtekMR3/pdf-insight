import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  FileCheck2,
  FileSearch,
  FileText,
  FolderOpen,
  History,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  ScanLine,
  Settings2,
  ShieldCheck,
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
      setHealthError('Nie można połączyć się z backendem. Sprawdź połączenie w ustawieniach.');
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
    setStatus('Łączę się z AI…');
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
              <small>MNIEJ CZYTANIA. WIĘCEJ WIEDZY.</small>
            </span>
          </a>
          <div className="workspace-label">TWOJA PRZESTRZEŃ</div>
          <nav aria-label="Nawigacja główna">
            <button
              className={view === 'analyze' ? 'nav-button active' : 'nav-button'}
              onClick={() => setView('analyze')}
            >
              <LayoutDashboard size={18} /> Analiza dokumentu <ChevronRight size={15} />
            </button>
            <button
              className={view === 'history' ? 'nav-button active' : 'nav-button'}
              disabled={busy}
              onClick={() => setView('history')}
            >
              <History size={18} /> Historia analiz{' '}
              <span className="nav-count">{history.length}</span>
            </button>
          </nav>
          <div className="sidebar-note">
            <span className="small-icon">
              <ShieldCheck size={19} />
            </span>
            <strong>{local ? 'Twoje pliki, u Ciebie.' : 'Przejrzyste przetwarzanie.'}</strong>
            <p>
              {health
                ? local
                  ? 'Dokumenty analizuje model na Twoim komputerze. Bez wysyłania do chmury.'
                  : 'Treść dokumentu analizuje Google Gemini API. Klucz pozostaje na backendzie.'
                : 'Sprawdzam dostępność i sposób przetwarzania AI.'}
            </p>
            <span className="local-tag">
              <span className="status-dot" />{' '}
              {health
                ? local
                  ? 'Tryb lokalny'
                  : 'Tryb API'
                : healthError
                  ? 'Brak połączenia'
                  : 'Łączenie…'}
            </span>
          </div>
          <div className="sidebar-bottom">
            <button className="nav-button" onClick={() => dialog.current?.showModal()}>
              <Settings2 size={18} /> Ustawienia analizy
            </button>
            <div className="profile">
              <span className="profile-avatar">TY</span>
              <div>
                <strong>Twoja przestrzeń</strong>
                <span>Wersja demonstracyjna</span>
              </div>
              <span className="profile-dot" />
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              Przestrzeń robocza <ChevronRight size={14} />
              <strong>{view === 'history' ? 'Historia analiz' : 'Analiza dokumentu'}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className={`connection-badge ${health?.available ? '' : 'offline'}`}
                onClick={() => dialog.current?.showModal()}
              >
                <span className="status-dot" />
                {health
                  ? health.available
                    ? local
                      ? 'Lokalne AI połączone'
                      : 'API AI skonfigurowane'
                    : 'AI niedostępne'
                  : healthError
                    ? 'Backend niedostępny'
                    : 'Sprawdzam AI…'}
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
                  <span className="eyebrow">TWOJE DOKUMENTY</span>
                  <h1>Wróć do ważnych informacji.</h1>
                  <p>Ostatnie 5 analiz zapisanych wyłącznie w tej przeglądarce.</p>
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
                    <h2>Historia zaczyna się tutaj.</h2>
                    <p>Przeanalizuj pierwszy dokument, aby wrócić do niego później.</p>
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
                    <span className="eyebrow">
                      <span className="eyebrow-line" /> OD DOKUMENTU DO KONKRETÓW
                    </span>
                    <h1>
                      Twój dokument.
                      <br />
                      <span>Najważniejsze informacje.</span>
                    </h1>
                    <p>
                      Dodaj PDF. Otrzymaj zwięzłe podsumowanie, kluczowe dane
                      <br className="desktop-br" /> i gotowy do pobrania plik JSON.
                    </p>
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
                          <span className="step-number">01</span> Twój dokument
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
                              {dragging ? 'Upuść dokument tutaj' : 'Przeciągnij tutaj swój PDF'}
                            </strong>
                            <span>
                              lub <b>wybierz plik z komputera</b>
                            </span>
                            <small>Umowa, faktura, raport — znajdź to, co istotne.</small>
                          </button>
                          <div className="sample-divider">
                            <span /> LUB WYPRÓBUJ <span />
                          </div>
                          <button
                            className="sample-button"
                            onClick={() => void prepareFile(loadSample)}
                          >
                            <span className="file-symbol">
                              <FileText size={21} />
                            </span>
                            <span>
                              <strong>Przykładowa faktura</strong>
                              <small>1 strona · fikcyjne dane demonstracyjne</small>
                            </span>
                            <ArrowRight size={18} />
                          </button>
                        </>
                      )}
                      {phase === 'extracting' && (
                        <div className="extracting">
                          <LoaderCircle className="spin" size={30} />
                          <h3>Przygotowuję Twój dokument</h3>
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
                                <Check size={15} /> Warstwa tekstowa odczytana
                              </span>
                              {document.scanPages.length > 0 && (
                                <span className="scan-line">
                                  <ScanLine size={15} /> OCR: {document.scanPages.length}{' '}
                                  {document.scanPages.length === 1 ? 'strona' : 'stron'} ze skanem
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
                                {showSource
                                  ? 'Ukryj tekst źródłowy'
                                  : 'Podejrzyj tekst przed analizą'}
                                <ChevronRight size={15} />
                              </button>
                              {showSource && <pre className="source-preview">{document.text}</pre>}
                              <label className="remember">
                                <input
                                  type="checkbox"
                                  checked={remember}
                                  onChange={(event) => setRemember(event.target.checked)}
                                />{' '}
                                Zachowaj wynik w lokalnej historii
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
                                  {local
                                    ? 'Uruchom Ollama i sprawdź połączenie w ustawieniach.'
                                    : 'Sprawdź połączenie i konfigurację AI w ustawieniach.'}
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
                                <small>
                                  {local
                                    ? elapsed > 30
                                      ? 'Model działa na Twoim komputerze. Analiza może potrwać kilka minut.'
                                      : 'Pierwsza analiza może potrwać dłużej — model ładuje się do pamięci.'
                                    : 'Czas analizy zależy od długości dokumentu i dostępności API AI.'}
                                </small>
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
                              ? 'Plik pozostaje na Twoim komputerze. Analiza przez lokalną Ollama.'
                              : 'Tekst i obrazy skanów zostaną wysłane przez backend do Google Gemini API. Nie wysyłaj danych poufnych do wersji demonstracyjnej.'
                            : 'Sprawdzam sposób przetwarzania dokumentu…'}
                        </span>
                      </div>
                    </section>
                    <aside className="how-it-works">
                      <span className="eyebrow">PROSTO, KROK PO KROKU</span>
                      <h2>
                        Mniej przewijania.
                        <br />
                        Więcej konkretów.
                      </h2>
                      <div className="how-step">
                        <span>
                          <Upload size={19} />
                        </span>
                        <div>
                          <strong>Dodaj dokument</strong>
                          <p>Wybierz PDF ze swojego komputera lub użyj przykładowej umowy.</p>
                        </div>
                      </div>
                      <div className="how-step">
                        <span>
                          <Sparkles size={19} />
                        </span>
                        <div>
                          <strong>Pozwól AI go przeczytać</strong>
                          <p>Model wyłuska najważniejsze informacje, kwoty, daty i osoby.</p>
                        </div>
                      </div>
                      <div className="how-step">
                        <span>
                          <ArrowDownToLine size={19} />
                        </span>
                        <div>
                          <strong>Zabierz gotowe dane</strong>
                          <p>Przeczytaj podsumowanie lub pobierz uporządkowany plik JSON.</p>
                        </div>
                      </div>
                      <div className="local-model">
                        <Cpu size={18} />
                        <div>
                          <strong>
                            {health
                              ? local
                                ? 'AI działa lokalnie'
                                : 'Analiza przez API AI'
                              : 'Połączenie z AI'}
                          </strong>
                          <span>{health?.model || 'Sprawdzam model…'}</span>
                        </div>
                        <span className={`status-dot ${health?.available ? '' : 'gray'}`} />
                      </div>
                    </aside>
                  </div>
                )}
                {!record && (
                  <div className="feature-row">
                    <div>
                      <span>
                        <FileText size={19} />
                      </span>
                      <div>
                        <strong>Sedno w kilku zdaniach</strong>
                        <p>Podsumowanie w języku dokumentu.</p>
                      </div>
                    </div>
                    <div>
                      <span>
                        <FolderOpen size={19} />
                      </span>
                      <div>
                        <strong>Porządek w informacjach</strong>
                        <p>Daty, kwoty i podmioty w jednym miejscu.</p>
                      </div>
                    </div>
                    <div>
                      <span>
                        <ShieldCheck size={19} />
                      </span>
                      <div>
                        <strong>Sprawdzona struktura</strong>
                        <p>Każdy wynik przechodzi walidację JSON.</p>
                      </div>
                    </div>
                  </div>
                )}
                {record && <Results key={record.id} record={record} sourceText={document?.text} />}
              </>
            )}
            <footer>
              <span>
                PDF Insight <span className="footer-divider">/</span> Z dokumentów do decyzji.
              </span>
              <button onClick={() => dialog.current?.showModal()}>
                <CircleHelp size={14} /> Jak działa analiza?
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
            <Cpu size={22} />
          </span>
          <button
            className="icon-button"
            aria-label="Zamknij ustawienia"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <h2>
          {health
            ? local
              ? 'AI na Twoim komputerze.'
              : 'AI przez bezpieczny backend.'
            : 'Połączenie z AI.'}
        </h2>
        <p>
          {!health
            ? 'Sprawdź połączenie z backendem, aby potwierdzić model i sposób przetwarzania dokumentów.'
            : local
              ? 'Ta wersja korzysta z lokalnego modelu przez Ollama. Nie wymaga klucza API ani płatnego konta.'
              : 'Tekst dokumentu i obrazy skanów trafiają do Google Gemini API przez backend. Klucz API pozostaje na serwerze. Historia wyników jest zapisywana wyłącznie w tej przeglądarce.'}
        </p>
        <dl>
          <div>
            <dt>Tekst w PDF</dt>
            <dd>PDF.js — odczyt warstwy tekstowej</dd>
          </div>
          <div>
            <dt>Skany i podsumowanie</dt>
            <dd>
              {health
                ? local
                  ? 'Model wizyjny przez Ollama'
                  : 'Model wizyjny przez Gemini API'
                : 'Niepotwierdzone'}
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{health?.model || '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{health?.message || healthError || 'Sprawdzam…'}</dd>
          </div>
          <div>
            <dt>Przetwarzanie</dt>
            <dd>
              {health
                ? local
                  ? 'Wyłącznie na tym komputerze'
                  : 'Google Gemini API'
                : 'Niepotwierdzone'}
            </dd>
          </div>
        </dl>
        <div className="notice info">
          <Clock3 size={18} />
          <span>
            Czas zależy od długości dokumentu, liczby skanów i dostępności modelu. Długie dokumenty
            są analizowane fragmentami.
          </span>
        </div>
        <p className="settings-detail">
          Obsługiwane są pliki do 10 MB, maksymalnie 200 stron i 600 000 znaków. OCR obejmuje do 8
          stron bez warstwy tekstowej. Historia zawiera ostatnie 5 wyników; możesz ją wyczyścić.
        </p>
        <button className="button primary" onClick={() => void refreshHealth()}>
          Sprawdź połączenie
        </button>
      </dialog>
    </div>
  );
}
