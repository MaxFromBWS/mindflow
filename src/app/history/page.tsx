"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  "text-xs font-medium text-slate-400 hover:text-cyan-100 border border-transparent hover:border-cyan-300/25 rounded-lg px-2 py-1 transition-all duration-300";
const btnDanger =
  "text-xs font-medium text-slate-300 hover:text-rose-200 border border-white/15 hover:border-rose-300/35 rounded-lg px-2 py-1 transition-all duration-300";

function encodeResultForUrl(result: HistoryItem["result"]): string {
  const json = JSON.stringify(result);
  return btoa(unescape(encodeURIComponent(json)));
}

export default function HistoryPage() {
  const router = useRouter();
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

  const openHistoryItem = useCallback(
    (item: HistoryItem) => {
      try {
        const encoded = encodeResultForUrl(item.result);
        router.push(`/?data=${encodeURIComponent(encoded)}`);
      } catch {
        // если запись повреждена, просто игнорируем клик
      }
    },
    [router],
  );

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#07090f] text-slate-100">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.2),rgba(99,102,241,0.12),transparent_68%)] blur-2xl" />
        <div className="absolute -left-24 bottom-8 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(14,165,233,0.16),transparent_68%)] blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
              MindFlow
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">История запросов</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {loaded && items.length > 0 ? (
              <button type="button" onClick={clearEverything} className={btnDanger}>
                Очистить всю историю
              </button>
            ) : null}
            <Link
              href="/"
              className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-200 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08]"
            >
              На главную
            </Link>
          </div>
        </div>

        {!loaded ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] py-8 text-center text-slate-300">
            Загрузка…
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-slate-300">
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
                  key={item.id?.length ? item.id : `row-${index}`}
                  className="relative space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_10px_40px_-24px_rgba(56,189,248,0.45)] cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.05]"
                  role="button"
                  tabIndex={0}
                  onClick={() => openHistoryItem(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openHistoryItem(item);
                    }
                  }}
                  aria-label="Открыть результат из истории"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 pr-0">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <p className="text-xs text-slate-400">
                        {formatCreatedAt(item.createdAt)}
                      </p>
                      {modeLabel ? (
                        <span className="inline-block rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100/90">
                          {modeLabel}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeById(item.id);
                      }}
                      className={`shrink-0 ${btnGhost}`}
                      aria-label="Удалить запись"
                    >
                      Удалить
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap font-medium text-slate-100">
                    {item.input}
                  </p>
                  <p className="text-sm leading-relaxed text-slate-300">
                    <span className="font-semibold text-slate-100">Цель: </span>
                    {shortGoal(
                      typeof item.result?.goal === "string"
                        ? item.result.goal
                        : "",
                    )}
                  </p>
                  <p className="text-xs text-slate-400">Нажмите, чтобы открыть полный результат</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
