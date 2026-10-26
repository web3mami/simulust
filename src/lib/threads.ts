export const THREADS_KEY = "simulust-threads";

export type Thread = {
  id: string;
  last: string;
  at: number;
};

export function loadThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Thread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function touchThread(id: string, last: string) {
  const threads = loadThreads().filter((thread) => thread.id !== id);
  threads.unshift({ id, last, at: Date.now() });
  window.localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}
