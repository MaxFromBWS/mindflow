// Общие типы и работа с localStorage для истории анализов (используют главная и /history)

export type AnalysisResult = {
  goal: string;
  problem: string;
  steps: string[];
  risks: string[];
  firstStep: string;
};

// id — стабильный ключ для удаления одной записи; у старых JSON без id он добавится при чтении
export type HistoryItem = {
  id: string;
  input: string;
  result: AnalysisResult;
  createdAt?: number;
  mode?: string;
};

export const HISTORY_STORAGE_KEY = "mindflow:analysis-history";

// У каждой записи должен быть id; для старых данных один раз дописываем в localStorage
function ensureAllItemsHaveId(items: HistoryItem[]): HistoryItem[] {
  let migrated = false;
  const next = items.map((item) => {
    if (typeof item.id === "string" && item.id.length > 0) {
      return item;
    }
    migrated = true;
    return { ...item, id: crypto.randomUUID() };
  });
  if (migrated) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // не удалось записать — всё равно вернём next для UI
    }
  }
  return next;
}

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
          const id =
            "id" in entry &&
            typeof (entry as { id: unknown }).id === "string" &&
            (entry as { id: string }).id.trim().length > 0
              ? (entry as { id: string }).id.trim()
              : "";
          items.push({
            id,
            input: (entry as HistoryItem).input,
            result: r,
            ...(createdAt !== undefined ? { createdAt } : {}),
            ...(mode !== undefined ? { mode } : {}),
          });
        }
      }
    }
    return ensureAllItemsHaveId(items);
  } catch {
    return [];
  }
}

/** Полная перезапись списка в localStorage */
export function saveHistoryItems(items: HistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // квота / приватный режим
  }
}

/** Удалить всю историю */
export function clearAllHistory(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // игнорируем
  }
}

export function appendHistoryItem(
  input: string,
  result: AnalysisResult,
  mode?: string,
): void {
  const entry: HistoryItem = {
    id: crypto.randomUUID(),
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
