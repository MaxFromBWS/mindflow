// Общие типы и работа с localStorage для истории анализов (используют главная и /history)

export type AnalysisResult = {
  goal: string;
  problem: string;
  steps: string[];
  risks: string[];
  firstStep: string;
  timeframe: string;
  plan: string[];
  metrics: string[];
  resources: string[];
  mistakes: string[];
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

function asNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function normalizeAnalysisResult(data: unknown): AnalysisResult | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.goal !== "string" ||
    typeof obj.problem !== "string" ||
    !Array.isArray(obj.steps) ||
    !Array.isArray(obj.risks) ||
    typeof obj.firstStep !== "string"
  ) {
    return null;
  }

  return {
    goal: asNonEmptyString(obj.goal, "Цель не определена"),
    problem: asNonEmptyString(obj.problem, "Проблема не определена"),
    steps: asStringArray(obj.steps, ["Определить следующий практический шаг."]),
    risks: asStringArray(obj.risks, ["Риск не определен."]),
    firstStep: asNonEmptyString(
      obj.firstStep,
      "Сегодня выделите 30 минут и запланируйте первое действие.",
    ),
    timeframe: asNonEmptyString(obj.timeframe, "1 месяц"),
    plan: asStringArray(obj.plan ?? obj.plan30Days, [
      "Этап 1: определить цель и зафиксировать действия в календаре.",
      "Этап 2: выполнить ключевые шаги и зафиксировать промежуточный результат.",
      "Этап 3: скорректировать план и убрать узкие места.",
      "Этап 4: закрепить результат и определить следующий цикл.",
    ]),
    metrics: asStringArray(obj.metrics, [
      "Количество выполненных действий за неделю.",
      "Часы, вложенные в ключевую задачу.",
    ]),
    resources: asStringArray(obj.resources, [
      "Время: минимум 30 минут в день.",
      "Навык: 1 ключевая компетенция для усиления.",
    ]),
    mistakes: asStringArray(obj.mistakes, [
      "Слишком общий план без конкретных действий.",
      "Отсутствие еженедельной проверки прогресса.",
    ]),
  };
}

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
        const normalizedResult = normalizeAnalysisResult(
          (entry as { result: unknown }).result,
        );
        if (normalizedResult) {
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
            result: normalizedResult,
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
