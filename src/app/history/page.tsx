"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  HISTORY_STORAGE_KEY,
  clearAllHistory,
  parseHistoryFromStorage,
  saveHistoryItems,
  type HistoryItem,
} from "@/lib/history-storage";

const MODE_LABELS: Record<string, string> = {
  career: "Карьера",
  business: "Бизнес",
  life: "Жизнь",
};

function formatCreatedAt(ms: number | undefined): string {
  if (typeof ms !== "number" || Number.isNaN(ms)) {
    return "Дата не указана";
  }
  return new Date(ms).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortGoal(goal: string, maxChars = 140): string {
  const t = goal.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars).trim()}…`;
}

const btnGhost =
  "text-xs font-medium text-gray-500 hover:text-gray-900 border border-transparent hover:border-gray-200 rounded-lg px-2 py-1 transition-colors";
const btnDanger =
  "text-xs font-medium text-gray-600 hover:text-red-700 border border-gray-200 hover:border-red-200 rounded-lg px-2 py-1 transition-colors";

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        setItems(parseHistoryFromStorage(raw));
      }
    } catch {
      // ошибка чтения
    }
    setLoaded(true);
  }, []);

  const removeById = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      saveHistoryItems(next);
      return next;
    });
  }, []);

  const clearEverything = useCallback(() => {
    clearAllHistory();
    setItems([]);
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center p-8 gap-6">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">История запросов</h1>
          <div className="flex flex-wrap items-center gap-3">
            {loaded && items.length > 0 ? (
              <button type="button" onClick={clearEverything} className={btnDanger}>
                Очистить всю историю
              </button>
            ) : null}
            <Link
              href="/"
              className="text-sm text-gray-600 underline underline-offset-2 hover:text-black"
            >
              На главную
            </Link>
          </div>
        </div>

        {!loaded ? (
          <p className="text-gray-500 text-center py-8">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="text-gray-500 text-center py-12 px-6 border rounded-xl bg-white">
            История пока пуста
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {items.map((item) => {
              const modeLabel =
                item.mode && MODE_LABELS[item.mode]
                  ? MODE_LABELS[item.mode]
                  : null;

              return (
                <li
                  key={item.id}
                  className="p-5 border rounded-xl shadow-sm space-y-2 relative"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 pr-0">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <p className="text-xs text-gray-500">
                        {formatCreatedAt(item.createdAt)}
                      </p>
                      {modeLabel ? (
                        <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {modeLabel}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeById(item.id)}
                      className={`shrink-0 ${btnGhost}`}
                      aria-label="Удалить запись"
                    >
                      Удалить
                    </button>
                  </div>
                  <p className="font-medium text-gray-900 whitespace-pre-wrap">
                    {item.input}
                  </p>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    <span className="font-semibold text-gray-800">Цель: </span>
                    {shortGoal(item.result.goal)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
