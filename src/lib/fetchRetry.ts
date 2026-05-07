// Fetch-Wrapper mit Timeout (AbortController) und automatischem Retry.
//
// Hintergrund: Auf iOS (mobile Safari, in-App-WebViews) tritt sporadisch
// "TypeError: Load failed" auf, wenn das Netzwerk kurz ausfällt oder eine
// HTTP-Anfrage zu lange unbeantwortet bleibt. Wir umhüllen alle Fetches
// mit:
//   - 15 s Timeout (AbortController)
//   - bis zu 2 Retries mit 1 s Pause bei Netzwerkfehler / Timeout / 5xx
//
// Diese Funktion wird global auf den Supabase-Client (`global.fetch`) und
// in src/lib/onedrive.ts verdrahtet, sodass alle relevanten Calls
// abgesichert sind, ohne pro Aufrufer expliziten Code zu brauchen.

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES    = 2;
const DEFAULT_DELAY_MS   = 1_000;

export interface FetchRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object'
    && (err as { name?: string }).name === 'AbortError';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kombiniert mehrere AbortSignal zu einem. Sobald eines aborted, wird auch
 * das resultierende Signal aborted. Wir brauchen das, damit ein vom
 * Aufrufer übergebenes Signal (z.B. von Supabase) sich mit unserem
 * Timeout-Signal kombinieren lässt.
 */
function composeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  if (a.aborted) return a;
  const ctrl = new AbortController();
  const onA = () => ctrl.abort((a as { reason?: unknown }).reason);
  const onB = () => ctrl.abort((b as { reason?: unknown }).reason);
  a.addEventListener('abort', onA, { once: true });
  b.addEventListener('abort', onB, { once: true });
  return ctrl.signal;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_DELAY_MS,
    signal: externalSignal,
    ...rest
  } = init;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs);
    const combined = composeSignals(externalSignal ?? undefined, ctrl.signal);
    try {
      const resp = await fetch(input, { ...rest, signal: combined });
      clearTimeout(timeoutId);
      // 5xx-Server-Fehler → retry; 4xx wird normal zurückgegeben.
      if (resp.status >= 500 && resp.status < 600 && attempt < retries) {
        await delay(retryDelayMs);
        continue;
      }
      return resp;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      // Externer Abort durch Aufrufer → nicht retryen.
      if (externalSignal?.aborted) throw err;
      // Netzwerk-Fehler oder Timeout → retry.
      if (attempt < retries && (isAbortError(err) || isNetworkError(err))) {
        await delay(retryDelayMs);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('fetchWithRetry: unbekannter Fehler');
}

function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true; // "TypeError: Load failed", "Failed to fetch"
  const msg = (err as { message?: string }).message ?? '';
  return /network|load failed|failed to fetch|timeout/i.test(msg);
}
