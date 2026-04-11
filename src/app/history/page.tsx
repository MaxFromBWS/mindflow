"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  HISTORY_STORAGE_KEY,
  parseHistoryFromStorage,
  type HistoryItem,
} from "@/lib/history-storage";

// Те же id, что сохраняет главная страница; неизвестные значения просто не показываем
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
      // Ошибка чтения — оставляем пустой список
    }
    setLoaded(true);
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center p-8 gap-6">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">История запросов</h1>
          <Link
            href="/"
            className="text-sm text-gray-600 underline underline-offset-2 hover:text-black"
          >
            На главную
          </Link>
        </div>

        {!loaded ? (
          <p className="text-gray-500 text-center py-8">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="text-gray-500 text-center py-12 px-6 border rounded-xl bg-white">
            История пока пуста
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {items.map((item, index) => {
              const modeLabel =
                item.mode && MODE_LABELS[item.mode]
                  ? MODE_LABELS[item.mode]
                  : null;

              return (
                <li
                  key={
                    item.createdAt != null
                      ? `${item.createdAt}-${index}`
                      : `item-${index}`
                  }
                  className="p-5 border rounded-xl shadow-sm space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-gray-500">
                      {formatCreatedAt(item.createdAt)}
                    </p>
                    {modeLabel ? (
                      <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                        {modeLabel}
                      </span>
                    ) : null}
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
