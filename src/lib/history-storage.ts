// Общие типы и работа с localStorage для истории анализов (используют главная и /history)

export type AnalysisResult = {
  goal: string;
  problem: string;
  steps: string[];
  risks: string[];
  firstStep: string;
};

// createdAt — время сохранения (мс); mode — режим анализа (если был сохранён)
export type HistoryItem = {
  input: string;
  result: AnalysisResult;
  createdAt?: number;
  mode?: string;
};

export const HISTORY_STORAGE_KEY = "mindflow:analysis-history";

// Разбор JSON из localStorage: битые данные не роняют приложение
export function parseHistoryFromStorage(raw: string): HistoryItem[] {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];

    const items: HistoryItem[] = [];
    for (const entry of data) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "input" in entry &&
        "result" in entry &&
        typeof (entry as HistoryItem).input === "string"
      ) {
        const r = (entry as HistoryItem).result;
        if (
          typeof r === "object" &&
          r !== null &&
          typeof r.goal === "string" &&
          typeof r.problem === "string" &&
          Array.isArray(r.steps) &&
          Array.isArray(r.risks) &&
          typeof r.firstStep === "string"
        ) {
          const createdAt =
            "createdAt" in entry &&
            typeof (entry as HistoryItem).createdAt === "number"
              ? (entry as HistoryItem).createdAt
              : undefined;
          const mode =
            "mode" in entry &&
            typeof (entry as HistoryItem).mode === "string"
              ? (entry as HistoryItem).mode
              : undefined;
          items.push({
            input: (entry as HistoryItem).input,
            result: r,
            ...(createdAt !== undefined ? { createdAt } : {}),
            ...(mode !== undefined ? { mode } : {}),
          });
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}

// Добавить запись в начало списка и сохранить (вызывается после успешного анализа)
export function appendHistoryItem(
  input: string,
  result: AnalysisResult,
  mode?: string,
): void {
  const entry: HistoryItem = {
    input,
    result,
    createdAt: Date.now(),
    ...(mode ? { mode } : {}),
  };
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const prev = raw ? parseHistoryFromStorage(raw) : [];
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([entry, ...prev]));
  } catch {
    // Нет места, приватный режим и т.д. — тихо пропускаем
  }
}
