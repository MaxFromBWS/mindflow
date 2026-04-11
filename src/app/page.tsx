"use client";

import { useEffect, useState } from "react";

type AnalysisResult = {
  goal: string;
  problem: string;
  steps: string[];
  risks: string[];
  firstStep: string;
};

// Одна запись истории: что спросили и какой ответ получили
type HistoryItem = {
  input: string;
  result: AnalysisResult;
};

const HISTORY_STORAGE_KEY = "mindflow:analysis-history";

// Безопасно читаем массив истории из JSON (если формат битый — не падаем)
function parseHistoryFromStorage(raw: string): HistoryItem[] {
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
          items.push({ input: (entry as HistoryItem).input, result: r });
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}

export default function HomePage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Пока false — не пишем в storage, чтобы не затереть данные пустым [] до setHistory из чтения
  const [storageHydrated, setStorageHydrated] = useState(false);

  // После монтирования на клиенте подтягиваем историю из localStorage (на сервере не трогаем)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        setHistory(parseHistoryFromStorage(raw));
      }
    } catch {
      // Нет доступа к storage / приватный режим — просто остаёмся с пустой историей
    }
    setStorageHydrated(true);
  }, []);

  // Любое изменение history — пишем в localStorage только после первой загрузки из него
  useEffect(() => {
    if (!storageHydrated) return;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Игнорируем квоту и прочие ошибки записи
    }
  }, [history, storageHydrated]);

  const handleAnalyze = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const rawText = await response.text();
      let data: AnalysisResult | { error?: string };
      if (!rawText.trim()) {
        setError(
          response.ok
            ? "Пустой ответ сервера"
            : `Ошибка ${response.status}: пустой ответ`,
        );
        return;
      }
      try {
        data = JSON.parse(rawText) as AnalysisResult | { error?: string };
      } catch {
        setError("Сервер вернул не JSON. Проверьте консоль сервера и перезапустите dev.");
        return;
      }

      if (!response.ok) {
        setError(
          typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
            ? data.error
            : `Ошибка ${response.status}`,
        );
        return;
      }

      if (
        typeof data === "object" &&
        data !== null &&
        "goal" in data &&
        "problem" in data &&
        "steps" in data &&
        "risks" in data &&
        "firstStep" in data
      ) {
        const analysis = data as AnalysisResult;
        setResult(analysis);
        // Успешный анализ — добавляем в историю (новые сверху)
        setHistory((prev) => [{ input: input.trim(), result: analysis }, ...prev]);
      } else {
        setError("Неожиданный формат ответа");
      }
    } catch (e) {
      console.error(e);
      setError("Не удалось выполнить запрос");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <h1 className="text-4xl font-bold">MindFlow</h1>

      <p className="text-gray-500 text-center whitespace-nowrap">
        Преврати свои мысли в чёткий план действий с помощью AI
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Например: хочу сменить работу, но не понимаю с чего начать"
        className="w-full max-w-xl p-4 border rounded-xl"
      />

      <button
        onClick={handleAnalyze}
        className="px-6 py-3 bg-black text-white rounded-xl"
      >
        Разобрать
      </button>

      {loading && <p className="text-gray-500">Анализируем мысль...</p>}

      {error && (
        <p className="text-red-600 text-center max-w-xl" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">

          <div className="p-5 border rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-2">
              {"\u{1F3AF} Цель"}
            </h2>
            <p>{result.goal}</p>
          </div>

          <div className="p-5 border rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-2">
              {"\u{26A0}\u{FE0F} Проблема"}
            </h2>
            <p>{result.problem}</p>
          </div>

          <div className="p-5 border rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-2">
              {"\u{1F4CC} Шаги"}
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              {result.steps.map((step: string, i: number) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>

          <div className="p-5 border rounded-xl shadow-sm">
            <h2 className="font-bold text-lg mb-2">
              {"\u{1F6A7} Риски"}
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              {result.risks.map((risk: string, i: number) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          </div>

          <div className="p-5 border rounded-xl shadow-sm md:col-span-2 bg-black text-white">
            <h2 className="font-bold text-lg mb-2">
              {"\u{1F680} Первый шаг"}
            </h2>
            <p>{result.firstStep}</p>
          </div>

        </div>
      )}
    </main>
  );
}
