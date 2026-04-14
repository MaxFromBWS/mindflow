"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  appendHistoryItem,
  normalizeAnalysisResult,
  type AnalysisResult,
} from "@/lib/history-storage";

const ANALYSIS_MODES = [
  { id: "career", label: "Карьера" },
  { id: "business", label: "Бизнес" },
  { id: "life", label: "Жизнь" },
] as const;

type AnalysisModeId = (typeof ANALYSIS_MODES)[number]["id"];

const EXAMPLE_PROMPTS: {
  id: string;
  mode: AnalysisModeId;
  label: string;
  text: string;
}[] = [
  {
    id: "ex-career-1",
    mode: "career",
    label: "Рост до senior",
    text:
      "Хочу перейти из middle в senior, но не понимаю, чего не хватает в моём профиле и с чего начать.",
  },
  {
    id: "ex-career-2",
    mode: "career",
    label: "Смена сферы",
    text:
      "Работаю бухгалтером и хочу войти в IT как аналитик — с чего начать без опыта в новой области?",
  },
  {
    id: "ex-business-1",
    mode: "business",
    label: "Первые клиенты",
    text:
      "Запускаю небольшую студию по дизайну. Как найти первых заказчиков и не продешевить на старте?",
  },
  {
    id: "ex-life-1",
    mode: "life",
    label: "Баланс и усталость",
    text:
      "После работы нет сил на семью и спорт. Хочу расставить приоритеты и перестать выгорать — с чего начать?",
  },
];

function formatAnalysisForClipboard(r: AnalysisResult): string {
  const stepsBlock = r.steps.map((s) => `• ${s}`).join("\n");
  const risksBlock = r.risks.map((s) => `• ${s}`).join("\n");
  const planWithToday = buildPlanWithToday(r);
  const planBlock = planWithToday.map((s) => `• ${s}`).join("\n");
  const metricsBlock = r.metrics.map((s) => `• ${s}`).join("\n");
  const resourcesBlock = r.resources.map((s) => `• ${s}`).join("\n");
  const mistakesBlock = r.mistakes.map((s) => `• ${s}`).join("\n");
  return [
    "Цель",
    r.goal,
    "",
    "Проблема",
    r.problem,
    "",
    "Шаги",
    stepsBlock,
    "",
    "Риски",
    risksBlock,
    "",
    "Срок",
    r.timeframe,
    "",
    "План",
    planBlock,
    "",
    "Метрики прогресса",
    metricsBlock,
    "",
    "Ресурсы",
    resourcesBlock,
    "",
    "Частые ошибки",
    mistakesBlock,
  ].join("\n");
}

// UTF-8 → base64 для кириллицы в JSON
function encodeResultForUrl(result: AnalysisResult): string {
  const json = JSON.stringify(result);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeResultFromParam(encoded: string): AnalysisResult | null {
  try {
    const trimmed = encoded.trim();
    if (!trimmed) return null;
    const json = decodeURIComponent(escape(atob(trimmed)));
    const data: unknown = JSON.parse(json);
    return normalizeAnalysisResult(data);
  } catch {
    return null;
  }
}

function stripDataParamFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("data")) return;
  url.searchParams.delete("data");
  const qs = url.searchParams.toString();
  window.history.replaceState({}, "", `${url.pathname}${qs ? `?${qs}` : ""}`);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // продолжим с fallback
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const HOW_IT_WORKS_STEPS = [
  {
    emoji: "\u{270F}\u{FE0F}",
    title: "Ввод мысли",
    description:
      "Опишите ситуацию своими словами и при необходимости выберите фокус: карьера, бизнес или жизнь.",
  },
  {
    emoji: "\u{2728}",
    title: "Анализ AI",
    description:
      "Модель структурирует запрос: цель, проблема, шаги, риски — с опорой на ваш текст.",
  },
  {
    emoji: "\u{1F4CB}",
    title: "Готовый план",
    description:
      "Сразу видно, с чего начать: конкретный первый шаг и ясная последовательность действий.",
  },
] as const;

const resultCardShell =
  "rounded-2xl border p-6 shadow-[0_2px_20px_-4px_rgba(0,0,0,0.08)]";
const resultCardMuted = `${resultCardShell} border-gray-200/90 bg-white`;
const resultCardTitleClass =
  "text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3";
const resultBodyClass = "text-gray-800 leading-relaxed";
const resultListClass = "list-disc pl-5 space-y-2 leading-relaxed text-gray-800";

function getPlanStageLabel(rawStep: string, index: number): string {
  const trimmed = rawStep.trim();
  const weekMatch = /^неделя\s*(\d+)/i.exec(trimmed);
  if (weekMatch?.[1]) return `Неделя ${weekMatch[1]}`;
  const stageMatch = /^этап\s*(\d+)/i.exec(trimmed);
  if (stageMatch?.[1]) return `Этап ${stageMatch[1]}`;
  return `Этап ${index + 1}`;
}

function stripStagePrefix(rawStep: string): string {
  return rawStep
    .replace(/^неделя\s*\d+\s*:\s*/i, "")
    .replace(/^этап\s*\d+\s*:\s*/i, "")
    .trim();
}

function buildPlanWithToday(result: AnalysisResult): string[] {
  const plan = Array.isArray(result.plan) ? result.plan : [];
  const firstStep = result.firstStep.trim();
  if (!firstStep) return plan;

  const normalizedFirst = firstStep.toLowerCase();
  const alreadyContains = plan.some((step) =>
    step.toLowerCase().includes(normalizedFirst),
  );
  if (alreadyContains) return plan;

  return [`Сегодня: ${firstStep}`, ...plan];
}

export default function HomePage() {
  const [selectedMode, setSelectedMode] = useState<AnalysisModeId>("career");
  const [input, setInput] = useState("");
  const [adjustmentInput, setAdjustmentInput] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultVisible, setResultVisible] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const formSectionRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Открытие результата по ссылке ?data=... (без запроса к серверу)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("data");
    if (!raw) return;
    const decoded = decodeResultFromParam(raw);
    if (decoded) {
      setResult(decoded);
      setError(null);
    } else {
      setError("Не удалось открыть результат по ссылке.");
    }
  }, []);

  useEffect(() => {
    if (!result) {
      setResultVisible(false);
      return;
    }
    setResultVisible(false);
    const id = window.setTimeout(() => setResultVisible(true), 30);
    return () => window.clearTimeout(id);
  }, [result]);

  useEffect(() => {
    if (!actionStatus) return;
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setActionStatus(null);
      toastTimerRef.current = null;
    }, 2600);

    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [actionStatus]);

  const applyExample = (mode: AnalysisModeId, text: string) => {
    setSelectedMode(mode);
    setInput(text);
    setError(null);
  };

  const handleAnalyze = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    setLoading(true);
    setResult(null);
    setError(null);
    setActionStatus(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: trimmedInput,
          selectedMode,
        }),
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

      const analysis = normalizeAnalysisResult(data);
      if (analysis) {
        setResult(analysis);
        appendHistoryItem(trimmedInput, analysis, selectedMode);
        setInput("");
        setAdjustmentInput("");
        stripDataParamFromUrl();
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

  const handleAdjustPlan = async () => {
    const trimmedAdjustment = adjustmentInput.trim();
    if (!result || !trimmedAdjustment) return;

    setAdjusting(true);
    setError(null);
    setActionStatus(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: input.trim() || "Уточнение и корректировка текущего плана",
          selectedMode,
          adjustment: trimmedAdjustment,
          currentResult: result,
        }),
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

      const analysis = normalizeAnalysisResult(data);
      if (!analysis) {
        setError("Неожиданный формат ответа");
        return;
      }

      setResult(analysis);
      appendHistoryItem(`Корректировка: ${trimmedAdjustment}`, analysis, selectedMode);
      setAdjustmentInput("");
      stripDataParamFromUrl();
      setActionStatus("План обновлён с учетом уточнений.");
    } catch (e) {
      console.error(e);
      setError("Не удалось скорректировать план");
    } finally {
      setAdjusting(false);
    }
  };

  const handleCopyResult = async () => {
    if (!result) return;
    const ok = await copyTextToClipboard(formatAnalysisForClipboard(result));
    setActionStatus(
      ok
        ? "Результат скопирован в буфер."
        : "Не удалось скопировать автоматически. Проверьте права браузера.",
    );
  };

  // Полная ссылка с ?data=... в адресной строке + копирование в буфер
  const handleShareResult = async () => {
    if (!result) return;
    try {
      const encoded = encodeResultForUrl(result);
      const url = new URL(window.location.href);
      url.searchParams.set("data", encoded);
      window.history.replaceState({}, "", url.toString());
      const shareUrl = url.toString();

      if (navigator.share) {
        try {
          await navigator.share({
            title: "Результат анализа MindFlow",
            url: shareUrl,
          });
          setActionStatus("Ссылка отправлена.");
          return;
        } catch {
          // если пользователь закрыл системное окно share, просто продолжим с копированием
        }
      }

      const copied = await copyTextToClipboard(shareUrl);
      setActionStatus(
        copied
          ? "Ссылка скопирована в буфер."
          : "Не удалось поделиться автоматически. Скопируйте ссылку из адресной строки.",
      );
    } catch {
      setActionStatus("Не удалось подготовить ссылку для отправки.");
    }
  };

  const handleNewRequest = () => {
    setResult(null);
    setInput("");
    setAdjustmentInput("");
    setError(null);
    setActionStatus(null);
    stripDataParamFromUrl();
    formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <h1 className="text-4xl font-bold">MindFlow</h1>

      <div
        ref={formSectionRef}
        className="flex flex-col items-center gap-6 w-full max-w-xl"
      >
        <p className="text-gray-500 text-center whitespace-nowrap">
          Преврати свои мысли в чёткий план действий с помощью AI
        </p>

        <section
          className="w-full max-w-3xl"
          aria-labelledby="how-it-works-title"
        >
          <h2
            id="how-it-works-title"
            className="text-center text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3"
          >
            Как это работает
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <div
                key={step.title}
                className="rounded-xl border border-gray-200/90 bg-white px-4 py-4 shadow-[0_1px_12px_-4px_rgba(0,0,0,0.06)]"
              >
                <p className="text-lg mb-2" aria-hidden>
                  {step.emoji}
                </p>
                <p className="text-sm font-semibold text-gray-900 mb-1.5">
                  {step.title}
                </p>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="w-full flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Режим анализа
          </span>
          <div
            className="flex rounded-xl border border-gray-200 bg-gray-50/80 p-1 gap-1"
            role="group"
            aria-label="Режим анализа"
          >
            {ANALYSIS_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMode(m.id)}
                disabled={loading}
                className={`flex-1 min-w-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                  selectedMode === m.id
                    ? "bg-black text-white shadow-sm"
                    : "text-gray-700 hover:bg-white/90"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Например: хочу сменить работу, но не понимаю с чего начать"
          className="w-full max-w-xl p-4 border rounded-xl"
        />

        <div className="w-full flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Примеры запросов
          </span>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                disabled={loading}
                onClick={() => applyExample(ex.mode, ex.text)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-800 shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 justify-center w-full">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loading}
            className="px-6 py-3 bg-black text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Анализируем..." : "Разобрать"}
          </button>
          <Link
            href="/history"
            className="px-6 py-3 border border-gray-300 rounded-xl text-center hover:border-gray-400 transition-colors"
          >
            Открыть историю
          </Link>
        </div>
      </div>

      {error && (
        <p className="text-red-600 text-center max-w-xl" role="alert">
          {error}
        </p>
      )}

      {result && (
        (() => {
          const planWithToday = buildPlanWithToday(result);
          return (
        <div
          className={`w-full max-w-4xl mt-6 flex flex-col gap-6 transition-all duration-500 ease-out ${
            resultVisible
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-3"
          }`}
        >
          <div className="text-center md:text-left">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
              Результат анализа
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full">
            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F3AF} Цель"}
              </h3>
              <p className={resultBodyClass}>{result.goal}</p>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{26A0}\u{FE0F} Проблема"}
              </h3>
              <p className={resultBodyClass}>{result.problem}</p>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F4CC} Шаги"}
              </h3>
              <ul className={resultListClass}>
                {(Array.isArray(result.steps) ? result.steps : []).map(
                  (step: string, i: number) => (
                    <li key={i}>{step}</li>
                  ),
                )}
              </ul>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F6A7} Риски"}
              </h3>
              <ul className={resultListClass}>
                {(Array.isArray(result.risks) ? result.risks : []).map(
                  (risk: string, i: number) => (
                    <li key={i}>{risk}</li>
                  ),
                )}
              </ul>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{23F3} Срок"}
              </h3>
              <p className={resultBodyClass}>{result.timeframe}</p>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F4C5} План по этапам"}
              </h3>
              <ol className="space-y-3">
                {planWithToday.map(
                  (step: string, i: number) => (
                    <li key={i} className="relative pl-4">
                      <span
                        aria-hidden
                        className="absolute left-0 top-1 h-2.5 w-2.5 rounded-full bg-gray-900"
                      />
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {getPlanStageLabel(step, i)}
                      </p>
                      <p className="text-sm leading-relaxed text-gray-800">
                        {stripStagePrefix(step) || step}
                      </p>
                    </li>
                  ),
                )}
              </ol>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F4CA} Метрики прогресса"}
              </h3>
              <ul className={resultListClass}>
                {(Array.isArray(result.metrics) ? result.metrics : []).map(
                  (metric: string, i: number) => (
                    <li key={i}>{metric}</li>
                  ),
                )}
              </ul>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F9F0} Ресурсы"}
              </h3>
              <ul className={resultListClass}>
                {(Array.isArray(result.resources) ? result.resources : []).map(
                  (resource: string, i: number) => (
                    <li key={i}>{resource}</li>
                  ),
                )}
              </ul>
            </div>

            <div className={resultCardMuted}>
              <h3 className={resultCardTitleClass}>
                {"\u{26D4} Частые ошибки"}
              </h3>
              <ul className={resultListClass}>
                {(Array.isArray(result.mistakes) ? result.mistakes : []).map(
                  (mistake: string, i: number) => (
                    <li key={i}>{mistake}</li>
                  ),
                )}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 justify-center w-full pt-1">
            <button
              type="button"
              onClick={handleCopyResult}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
            >
              Скопировать результат
            </button>
            <button
              type="button"
              onClick={handleShareResult}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
            >
              Поделиться
            </button>
            <button
              type="button"
              onClick={handleNewRequest}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
            >
              Новый запрос
            </button>
          </div>
          <div className="w-full rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Скорректировать план
            </p>
            <textarea
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(e.target.value)}
              placeholder="Добавьте уточнение, например: у меня нет бюджета на обучение в ближайшие 2 месяца."
              className="w-full min-h-24 rounded-lg border border-gray-200 p-3 text-sm text-gray-900"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleAdjustPlan}
                disabled={adjusting || !adjustmentInput.trim()}
                className="px-4 py-2 text-sm bg-black text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adjusting ? "Обновляем..." : "Обновить план"}
              </button>
            </div>
          </div>
        </div>
          );
        })()
      )}
      {actionStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-lg"
        >
          {actionStatus}
        </div>
      ) : null}
    </main>
  );
}
