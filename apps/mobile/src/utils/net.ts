/** Délai au-delà duquel une requête est abandonnée : un réseau mobile qui ne répond plus ne bloque pas l'écran. */
export const TIMEOUT_MS = 12_000;

export class TimeoutError extends Error {
  constructor() {
    super('délai dépassé');
    this.name = 'TimeoutError';
  }
}

/**
 * `fetch` puis `read` (lecture du corps comprise) avec un délai maximal, en respectant le signal de
 * l'appelant : son abandon reste un abandon, le délai dépassé devient une `TimeoutError`.
 */
export async function fetchWithin<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
  ms = TIMEOUT_MS,
): Promise<T> {
  const ctl = new AbortController();
  const outer = init.signal;
  const forward = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  else outer?.addEventListener('abort', forward);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, ms);
  try {
    return await read(await fetch(url, { ...init, signal: ctl.signal }));
  } catch (e) {
    throw timedOut ? new TimeoutError() : e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

/** Promesse qui échoue avec `TimeoutError` si elle ne s'est pas réglée à temps (API sans signal). */
export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
