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
    typeof r.timeframe === "string" ? r.timeframe : "",
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
  "rounded-2xl border p-6 backdrop-blur-sm transition-all duration-300";
const resultCardMuted = `${resultCardShell} border-white/10 bg-white/[0.03] shadow-[0_10px_40px_-24px_rgba(56,189,248,0.45)] hover:border-cyan-300/25 hover:bg-white/[0.05]`;
const resultCardTitleClass =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3";
const resultBodyClass = "text-slate-100 leading-relaxed";
const resultListClass = "list-disc pl-5 space-y-2 leading-relaxed text-slate-100/95";

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
  const firstStep = typeof result.firstStep === "string" ? result.firstStep.trim() : "";
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
        const apiError =
          typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
            ? data.error
            : `Ошибка ${response.status}`;
        if (response.status === 429) {
          setError(
            "Провайдер перегружен или достигнут лимит запросов. Мы уже попытались повторить запрос и переключиться на резервную модель. " +
              "Попробуйте еще раз через 1-2 минуты.",
          );
        } else {
          setError(apiError);
        }
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
        const apiError =
          typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
            ? data.error
            : `Ошибка ${response.status}`;
        if (response.status === 429) {
          setError(
            "Провайдер перегружен или достигнут лимит запросов. Мы уже попытались повторить запрос и переключиться на резервную модель. " +
              "Попробуйте еще раз через 1-2 минуты.",
          );
        } else {
          setError(apiError);
        }
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

  const safeTimeframe =
    result && typeof result.timeframe === "string" ? result.timeframe.trim() : "";
  const planWithToday = result ? buildPlanWithToday(result) : [];

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#07090f] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07090f]/75 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(56,189,248,0.95)]" />
            <span className="text-sm font-semibold tracking-wide text-slate-100">MindFlow</span>
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
              AI-first
            </span>
          </div>
          <Link
            href="/history"
            className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-200 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08]"
          >
            История
          </Link>
        </div>
      </header>

      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -top-40 left-1/2 h-[30rem] w-[42rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.24),rgba(99,102,241,0.16),transparent_68%)] blur-2xl" />
        <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent_68%)] blur-3xl" />
        <div className="absolute -left-32 bottom-8 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(129,140,248,0.18),transparent_70%)] blur-3xl" />
      </div>

      <div
        ref={formSectionRef}
        className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 py-10 md:py-14"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
            Premium AI planning workspace
          </span>
          <h1 className="bg-gradient-to-r from-slate-100 via-cyan-100 to-indigo-200 bg-clip-text text-5xl font-semibold tracking-tight text-transparent md:text-6xl">
            MindFlow
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-300/85 md:text-base">
            Преврати идею в персональный план действий: с понятным сроком, этапами
            реализации и приоритетами на сегодня.
          </p>
        </div>

        <section
          className="w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.025] p-5 shadow-[0_20px_70px_-45px_rgba(56,189,248,0.45)] backdrop-blur-md md:p-6"
          aria-labelledby="how-it-works-title"
        >
          <h2
            id="how-it-works-title"
            className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400"
          >
            Как это работает
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <div
                key={step.title}
                className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.04]"
              >
                <p className="mb-2 text-lg" aria-hidden>
                  {step.emoji}
                </p>
                <p className="mb-1.5 text-sm font-semibold text-slate-100">
                  {step.title}
                </p>
                <p className="text-xs leading-relaxed text-slate-300/85">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full max-w-5xl rounded-3xl border border-cyan-300/20 bg-gradient-to-r from-cyan-300/[0.08] via-white/[0.02] to-indigo-300/[0.08] p-5 shadow-[0_20px_70px_-50px_rgba(56,189,248,0.55)] backdrop-blur-md md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/85">
                Дополнительный инструмент
              </p>
              <h3 className="text-xl font-semibold tracking-tight text-slate-100">
                Семейный калькулятор бюджета
              </h3>
              <p className="max-w-2xl text-sm text-slate-300/90">
                Поможет перевести цели в деньги: доходы, расходы, накопления и
                контроль плана по месяцам в одном месте.
              </p>
            </div>
            <a
              href="https://maxfrombws.github.io/Family_Budget_Calculator/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/[0.14] px-5 py-2.5 text-sm font-semibold text-cyan-100 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200/60 hover:bg-cyan-300/[0.2] hover:shadow-[0_16px_36px_-22px_rgba(56,189,248,0.95)]"
            >
              Открыть семейный калькулятор
            </a>
          </div>
        </section>

        <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#0b1220]/80 p-5 shadow-[0_20px_80px_-50px_rgba(56,189,248,0.45)] backdrop-blur-xl md:p-6">
          <div className="w-full flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Режим анализа
            </span>
            <div
              className="flex gap-1 rounded-2xl border border-white/10 bg-white/[0.02] p-1"
              role="group"
              aria-label="Режим анализа"
            >
              {ANALYSIS_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMode(m.id)}
                  disabled={loading}
                  className={`flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 disabled:opacity-60 ${
                    selectedMode === m.id
                      ? "bg-gradient-to-r from-cyan-400/30 to-indigo-400/30 text-cyan-100 shadow-[0_0_0_1px_rgba(103,232,249,0.25)_inset,0_10px_24px_-16px_rgba(56,189,248,0.85)]"
                      : "text-slate-300 hover:bg-white/[0.05] hover:text-slate-100"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.07] to-transparent p-3 shadow-[0_0_0_1px_rgba(103,232,249,0.08)_inset]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Опишите цель и контекст. Например: хочу сменить работу, но нет ясного плана перехода."
              className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-[#0a111d] p-4 text-slate-100 placeholder:text-slate-400/80 outline-none transition-all duration-300 focus:border-cyan-300/45 focus:shadow-[0_0_0_1px_rgba(103,232,249,0.35),0_0_24px_-10px_rgba(56,189,248,0.65)]"
            />
            <p className="mt-2 text-[11px] text-slate-400/90">
              AI-коуч сформирует практичный план с учетом ограничений и реалистичного срока.
            </p>
          </div>

          <div className="mt-4 w-full flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Примеры запросов
            </span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  disabled={loading}
                  onClick={() => applyExample(ex.mode, ex.text)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm font-medium text-slate-200 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] hover:shadow-[0_14px_30px_-20px_rgba(56,189,248,0.8)] active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex w-full flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading}
              className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_10px_36px_-14px_rgba(56,189,248,0.85)] transition-all duration-300 hover:brightness-110 motion-reduce:transition-none motion-reduce:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-80 group-hover:animate-[shimmer_1.5s_ease] motion-reduce:hidden" />
              {loading ? "Анализируем..." : "Разобрать"}
            </button>
            <Link
              href="/history"
              className="rounded-xl border border-white/15 bg-white/[0.03] px-6 py-3 text-center text-sm text-slate-200 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08]"
            >
              Открыть историю
            </Link>
          </div>
          {loading ? (
            <p className="mt-3 text-center text-xs text-cyan-100/85">
              Выполняем анализ. Если провайдер перегружен, автоматически пробуем
              резервные модели.
            </p>
          ) : null}
        </div>
      </div>

      {error && (
        <p className="relative z-10 mx-auto max-w-xl text-center text-rose-300" role="alert">
          {error}
        </p>
      )}

      {loading && (
        <section className="relative z-10 mx-auto mt-6 w-full max-w-6xl px-6 pb-6">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
              AI готовит отчет
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 animate-pulse"
              >
                <div className="h-3 w-28 rounded bg-white/10" />
                <div className="mt-3 h-3 w-full rounded bg-white/10" />
                <div className="mt-2 h-3 w-11/12 rounded bg-white/10" />
                <div className="mt-2 h-3 w-9/12 rounded bg-white/10" />
              </div>
            ))}
          </div>
        </section>
      )}

      {result && (
        <div
          className={`relative z-10 mx-auto mt-6 flex w-full max-w-6xl flex-col gap-6 px-6 pb-12 transition-all duration-500 ease-out ${
            resultVisible
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-3"
          }`}
        >
          <div className="text-center md:text-left">
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-200/85">
              AI Action Report
            </h2>
            <p className="mt-1 text-sm text-slate-300/85">
              Персональный план достижения цели с конкретными этапами и метриками.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/90">
                Actionable
              </span>
              <span className="rounded-full border border-indigo-300/30 bg-indigo-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-100/90">
                Timeframe detected
              </span>
              <span className="rounded-full border border-white/20 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-200">
                AI-ready plan
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div
              className={`${resultCardShell} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none md:col-span-2 border-cyan-300/25 bg-gradient-to-r from-cyan-400/[0.13] via-cyan-200/[0.06] to-indigo-400/[0.12] shadow-[0_18px_60px_-30px_rgba(56,189,248,0.55)]`}
            >
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/85">
                {"\u{1F680} Первый шаг"}
              </h3>
              <p className="text-base leading-relaxed text-slate-100 md:text-[1.02rem]">
                {result.firstStep}
              </p>
            </div>

            {safeTimeframe ? (
              <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:90ms]`}>
                <h3 className={resultCardTitleClass}>
                  {"\u{23F3} Срок"}
                </h3>
                <p className="text-xl font-semibold text-cyan-100">{safeTimeframe}</p>
              </div>
            ) : null}

            {planWithToday.length > 0 ? (
              <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:140ms]`}>
                <h3 className={resultCardTitleClass}>
                  {"\u{1F4C5} План реализации"}
                </h3>
                <ol className="space-y-3">
                  {planWithToday.map((step: string, i: number) => (
                    <li key={i} className="group relative pl-6">
                      <span
                        aria-hidden
                        className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_0_5px_rgba(56,189,248,0.15)]"
                      />
                      <span
                        aria-hidden
                        className="absolute left-[4px] top-4 h-[calc(100%-8px)] w-px bg-cyan-200/20"
                      />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                        {getPlanStageLabel(step, i)}
                      </p>
                      <p className="text-sm leading-relaxed text-slate-100 transition-colors duration-300 group-hover:text-cyan-50">
                        {stripStagePrefix(step) || step}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full">
            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:180ms]`}>
              <h3 className={resultCardTitleClass}>
                {"\u{1F3AF} Цель"}
              </h3>
              <p className={resultBodyClass}>{result.goal}</p>
            </div>

            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:220ms]`}>
              <h3 className={resultCardTitleClass}>
                {"\u{26A0}\u{FE0F} Проблема"}
              </h3>
              <p className={resultBodyClass}>{result.problem}</p>
            </div>

            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:260ms]`}>
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

            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:300ms]`}>
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

            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:340ms]`}>
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

            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:380ms]`}>
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

            <div className={`${resultCardMuted} animate-[fadeUp_0.55s_ease-out_both] motion-reduce:animate-none [animation-delay:420ms] md:col-span-2`}>
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
              className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm text-slate-100 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] motion-reduce:transition-none"
            >
              Скопировать результат
            </button>
            <button
              type="button"
              onClick={handleShareResult}
              className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm text-slate-100 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] motion-reduce:transition-none"
            >
              Поделиться
            </button>
            <button
              type="button"
              onClick={handleNewRequest}
              className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm text-slate-100 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] motion-reduce:transition-none"
            >
              Новый запрос
            </button>
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_14px_40px_-30px_rgba(56,189,248,0.45)]">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Скорректировать план
            </p>
            <textarea
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(e.target.value)}
              placeholder="Добавьте уточнение, например: у меня нет бюджета на обучение в ближайшие 2 месяца."
              className="w-full min-h-24 rounded-xl border border-white/10 bg-[#0a111d] p-3 text-sm text-slate-100 placeholder:text-slate-400/80 outline-none transition-all duration-300 focus:border-cyan-300/45 focus:shadow-[0_0_0_1px_rgba(103,232,249,0.35),0_0_20px_-10px_rgba(56,189,248,0.65)]"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleAdjustPlan}
                disabled={adjusting || !adjustmentInput.trim()}
                className="rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-all duration-300 hover:brightness-110 motion-reduce:transition-none motion-reduce:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {adjusting ? "Обновляем..." : "Обновить план"}
              </button>
            </div>
          </div>
        </div>
      )}
      {actionStatus ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 rounded-xl border border-cyan-300/30 bg-[#0b1220]/95 px-4 py-3 text-sm text-cyan-100 shadow-[0_14px_40px_-20px_rgba(56,189,248,0.85)] backdrop-blur-md"
        >
          {actionStatus}
        </div>
      ) : null}
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(120%);
          }
        }
        @keyframes fadeUp {
          0% {
            opacity: 0;
            transform: translateY(10px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </main>
  );
}
