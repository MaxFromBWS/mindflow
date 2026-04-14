import OpenAI from "openai";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Человекочитаемое сообщение для типичных отказов провайдера (регион, ключ и т.д.). */
function formatProviderError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (
    (lower.includes("country") && lower.includes("not supported")) ||
    lower.includes("unsupported country") ||
    lower.includes("region") && lower.includes("not supported")
  ) {
    return (
      "Сервис модели недоступен из вашего региона (ограничение провайдера). " +
      "Что можно сделать: подключиться через VPN в поддерживаемую страну; " +
      "или использовать OpenAI-совместимый шлюз — задайте в .env.local переменную OPENAI_BASE_URL (и при необходимости OPENAI_MODEL), затем перезапустите dev-сервер."
    );
  }
  if (
    lower.includes("missing authentication") ||
    (lower.includes("401") && lower.includes("authentication"))
  ) {
    return (
      "Нет или неверный заголовок авторизации. Если в .env.local указан OpenRouter (OPENAI_BASE_URL с openrouter), " +
      "нужен ключ OpenRouter вида sk-or-v1-... — задайте OPENROUTER_API_KEY или подставьте его в OPENAI_API_KEY. " +
      "Ключ OpenAI (sk-proj- / sk-) для OpenRouter не подходит. Перезапустите dev-сервер после правок."
    );
  }
  if (
    lower.includes("incorrect api key") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized")
  ) {
    return "Неверный или просроченный API-ключ. Проверьте ключ в .env.local.";
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return (
      "Провайдер временно ограничил запросы (429): подождите 1–2 минуты и попробуйте снова. " +
      "На бесплатных моделях лимиты жёстче — при необходимости смените OPENAI_MODEL в .env.local " +
      "на другую модель с пометкой :free или пополните баланс в OpenRouter."
    );
  }
  return msg;
}

/** Заголовки для OpenAI-совместимых шлюзов (например OpenRouter: атрибуция приложения). */
function buildDefaultHeaders(): Record<string, string> | undefined {
  const referer = process.env.OPENAI_HTTP_REFERER;
  const title = process.env.OPENAI_APP_TITLE;
  if (!referer && !title) return undefined;
  const h: Record<string, string> = {};
  if (referer) h["HTTP-Referer"] = referer;
  if (title) {
    h["X-Title"] = title;
    h["X-OpenRouter-Title"] = title;
  }
  return h;
}

/** Ключ без пробелов/CRLF; для OpenRouter можно использовать OPENROUTER_API_KEY. */
function resolveApiKey(): string | undefined {
  const base = process.env.OPENAI_BASE_URL?.trim().toLowerCase() ?? "";
  const openrouter = base.includes("openrouter");
  const keyOpenRouter = process.env.OPENROUTER_API_KEY?.trim();
  const keyOpenAI = process.env.OPENAI_API_KEY?.trim();
  if (openrouter) {
    return keyOpenRouter || keyOpenAI || undefined;
  }
  return keyOpenAI || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  );
}

function isModelUnavailableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  return (
    lower.includes("404") ||
    lower.includes("no endpoints found") ||
    lower.includes("model not found") ||
    lower.includes("unknown model")
  );
}

function resolveModelCandidates(): string[] {
  const base = process.env.OPENAI_BASE_URL?.trim().toLowerCase() ?? "";
  const isOpenRouter = base.includes("openrouter");
  const primary = (process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();
  const fallbackRaw = process.env.OPENAI_FALLBACK_MODELS?.trim() ?? "";
  const fallback = fallbackRaw
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  const defaultOpenRouterFree = [
    "openrouter/free",
    "meta-llama/llama-3.1-8b-instruct:free",
  ];
  const forceFree = (process.env.OPENROUTER_FORCE_FREE ?? "1").trim() !== "0";
  const preferred = isOpenRouter && forceFree ? defaultOpenRouterFree : [];
  return Array.from(new Set([primary, ...fallback, ...preferred]));
}

type DynamicFreeModelsCache = {
  models: string[];
  expiresAt: number;
};

let dynamicFreeModelsCache: DynamicFreeModelsCache | null = null;
const DYNAMIC_FREE_MODELS_TTL_MS = 10 * 60 * 1000; // 10 минут

function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  return (baseUrl ?? "").toLowerCase().includes("openrouter");
}

async function fetchOpenRouterFreeModels(
  apiKey: string,
  baseUrl: string | undefined,
): Promise<string[]> {
  if (!isOpenRouterBaseUrl(baseUrl)) return [];

  const now = Date.now();
  if (dynamicFreeModelsCache && now < dynamicFreeModelsCache.expiresAt) {
    return dynamicFreeModelsCache.models;
  }

  const endpointBase = (baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const modelsUrl = `${endpointBase}/models`;

  try {
    const response = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) return [];

    const payload: unknown = await response.json();
    const list =
      typeof payload === "object" &&
      payload !== null &&
      "data" in payload &&
      Array.isArray((payload as { data: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];

    const freeModels = list
      .map((item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        typeof (item as { id: unknown }).id === "string"
          ? (item as { id: string }).id.trim()
          : "",
      )
      .filter((id) => id.length > 0 && (id.endsWith(":free") || id === "openrouter/free"));

    const unique = Array.from(new Set(freeModels));
    dynamicFreeModelsCache = {
      models: unique,
      expiresAt: now + DYNAMIC_FREE_MODELS_TTL_MS,
    };
    return unique;
  } catch {
    return [];
  }
}

function resolveRetryDelays(): number[] {
  const maxWaitEnv = Number(process.env.OPENAI_RATE_LIMIT_MAX_WAIT_MS);
  const maxWaitMs = Number.isFinite(maxWaitEnv)
    ? Math.max(2000, Math.min(120000, maxWaitEnv))
    : 45000;

  const retryCountEnv = Number(process.env.OPENAI_RATE_LIMIT_RETRY_COUNT);
  const retryCount = Number.isFinite(retryCountEnv)
    ? Math.max(1, Math.min(12, Math.floor(retryCountEnv)))
    : 6;

  const delays: number[] = [];
  let total = 0;
  for (let i = 0; i < retryCount; i += 1) {
    const raw = Math.min(12000, 1000 * 2 ** i);
    const jitter = Math.floor(Math.random() * 600);
    const d = raw + jitter;
    if (total + d > maxWaitMs) break;
    delays.push(d);
    total += d;
  }
  return delays.length > 0 ? delays : [1200, 2500];
}

function resolveGlobalBudgetMs(): number {
  const env = Number(process.env.OPENAI_GLOBAL_TIMEOUT_MS);
  if (!Number.isFinite(env)) return 30000;
  return Math.max(8000, Math.min(90000, Math.floor(env)));
}

function resolveMaxModelsToTry(): number {
  const env = Number(process.env.OPENAI_MAX_MODELS_TO_TRY);
  if (!Number.isFinite(env)) return 4;
  return Math.max(1, Math.min(12, Math.floor(env)));
}

function shouldUseAllOpenRouterFree(): boolean {
  return (process.env.OPENROUTER_USE_ALL_FREE ?? "1").trim() !== "0";
}

function parseModelsEnv(raw: string | undefined, defaults: string[]): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return Array.from(new Set(list.length > 0 ? list : defaults));
}

function extractTextFromOpenAILikeResponse(response: {
  choices?: Array<{ message?: { content?: unknown } }>;
}): string {
  const messageContent = response.choices?.[0]?.message?.content;
  return typeof messageContent === "string" ? messageContent : "";
}

async function callGeminiJson(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
): Promise<string> {
  const combinedPrompt = `${systemPrompt.trim()}\n\n${userPrompt.trim()}`;
  const payloadBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: combinedPrompt }],
      },
    ],
    generationConfig: {
      temperature,
    },
  };

  const versions = ["v1beta", "v1"] as const;
  let lastError = "";

  for (const version of versions) {
    const url =
      `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });

    if (!response.ok) {
      const raw = await response.text();
      lastError = `Gemini ${response.status}: ${raw}`;
      continue;
    }

    const payload: unknown = await response.json();
    const text =
      typeof payload === "object" &&
      payload !== null &&
      "candidates" in payload &&
      Array.isArray((payload as { candidates: unknown }).candidates) &&
      (payload as { candidates: unknown[] }).candidates.length > 0 &&
      typeof (payload as { candidates: unknown[] }).candidates[0] === "object" &&
      (payload as { candidates: unknown[] }).candidates[0] !== null &&
      "content" in ((payload as { candidates: unknown[] }).candidates[0] as object) &&
      typeof ((payload as { candidates: unknown[] }).candidates[0] as { content?: unknown }).content ===
        "object" &&
      ((payload as { candidates: unknown[] }).candidates[0] as { content?: unknown }).content !== null &&
      "parts" in (((payload as { candidates: unknown[] }).candidates[0] as { content: unknown }).content as object) &&
      Array.isArray(
        (((payload as { candidates: unknown[] }).candidates[0] as { content: { parts?: unknown } }).content.parts),
      )
        ? ((((payload as { candidates: unknown[] }).candidates[0] as {
            content: { parts: Array<{ text?: unknown }> };
          }).content.parts[0]?.text as string) ?? "")
        : "";

    return typeof text === "string" ? text : "";
  }

  throw new Error(lastError || "Gemini: не удалось получить ответ.");
}

type GeminiModelCandidate = { model: string; apiVersion: "v1beta" | "v1" };

async function fetchGeminiAvailableModels(
  apiKey: string,
): Promise<GeminiModelCandidate[]> {
  const versions: Array<"v1beta" | "v1"> = ["v1beta", "v1"];
  const out: GeminiModelCandidate[] = [];

  for (const version of versions) {
    const url = `https://generativelanguage.googleapis.com/${version}/models?key=${encodeURIComponent(apiKey)}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const payload: unknown = await response.json();
      const list =
        typeof payload === "object" &&
        payload !== null &&
        "models" in payload &&
        Array.isArray((payload as { models: unknown }).models)
          ? (payload as { models: unknown[] }).models
          : [];

      for (const item of list) {
        if (typeof item !== "object" || item === null) continue;
        const name =
          "name" in item && typeof (item as { name?: unknown }).name === "string"
            ? (item as { name: string }).name
            : "";
        const methods =
          "supportedGenerationMethods" in item &&
          Array.isArray((item as { supportedGenerationMethods?: unknown }).supportedGenerationMethods)
            ? (item as { supportedGenerationMethods: unknown[] }).supportedGenerationMethods
            : [];
        const canGenerate = methods.some((m) => m === "generateContent");
        if (!canGenerate) continue;
        const model = name.replace(/^models\//, "").trim();
        if (!model) continue;
        out.push({ model, apiVersion: version });
      }
    } catch {
      continue;
    }
  }

  const unique = new Map<string, GeminiModelCandidate>();
  for (const candidate of out) {
    const key = `${candidate.apiVersion}:${candidate.model}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return Array.from(unique.values());
}

async function callGeminiJsonWithVersion(
  apiKey: string,
  apiVersion: "v1beta" | "v1",
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
): Promise<string> {
  const combinedPrompt = `${systemPrompt.trim()}\n\n${userPrompt.trim()}`;
  const payloadBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: combinedPrompt }],
      },
    ],
    generationConfig: {
      temperature,
    },
  };
  const url =
    `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloadBody),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Gemini ${response.status}: ${raw}`);
  }
  const payload: unknown = await response.json();
  const text =
    typeof payload === "object" &&
    payload !== null &&
    "candidates" in payload &&
    Array.isArray((payload as { candidates: unknown }).candidates) &&
    (payload as { candidates: unknown[] }).candidates.length > 0 &&
    typeof (payload as { candidates: unknown[] }).candidates[0] === "object" &&
    (payload as { candidates: unknown[] }).candidates[0] !== null &&
    "content" in ((payload as { candidates: unknown[] }).candidates[0] as object) &&
    typeof ((payload as { candidates: unknown[] }).candidates[0] as { content?: unknown }).content ===
      "object" &&
    ((payload as { candidates: unknown[] }).candidates[0] as { content?: unknown }).content !== null &&
    "parts" in (((payload as { candidates: unknown[] }).candidates[0] as { content: unknown }).content as object) &&
    Array.isArray(
      (((payload as { candidates: unknown[] }).candidates[0] as { content: { parts?: unknown } }).content.parts),
    )
      ? ((((payload as { candidates: unknown[] }).candidates[0] as {
          content: { parts: Array<{ text?: unknown }> };
        }).content.parts[0]?.text as string) ?? "")
      : "";

  return typeof text === "string" ? text : "";
}

function estimateTimeframe(input: string, adjustment: string): string {
  const text = `${input} ${adjustment}`.toLowerCase();
  if (
    text.includes("срочно") ||
    text.includes("быстро") ||
    text.includes("сегодня") ||
    text.includes("завтра")
  ) {
    return "2 недели";
  }
  if (
    text.includes("работ") ||
    text.includes("бизнес") ||
    text.includes("клиент") ||
    text.includes("доход")
  ) {
    return "2 месяца";
  }
  return "1 месяц";
}

function buildLocalFallbackPlan(
  input: string,
  modeHint: string,
  adjustment: string,
  currentResult: AnalysisApiResponse | null,
): AnalysisApiResponse {
  const normalizeLoose = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const timeframe = estimateTimeframe(input, adjustment);
  const focus = adjustment || input;
  const focusLower = normalizeLoose(focus);
  const isPurchaseGoal =
    focusLower.includes("купить") ||
    focusLower.includes("покупк") ||
    focusLower.includes("накопить");
  const isMotoGoal =
    focusLower.includes("мотоцикл") || focusLower.includes("байк");
  const isAutoGoal =
    focusLower.includes("машин") || focusLower.includes("авто");
  const isBigPurchase = isMotoGoal || isAutoGoal;
  const targetName = isMotoGoal
    ? "мотоцикл"
    : isAutoGoal
      ? "автомобиль"
      : "покупку";

  const goalBase =
    currentResult?.goal ||
    (isPurchaseGoal
      ? `Подготовить реалистичный план, чтобы накопить и купить ${targetName} без критичной финансовой перегрузки.`
      : `Достичь практического результата по направлению: ${modeHint}.`);
  const constraintPart = adjustment
    ? `С учётом уточнения: ${adjustment}.`
    : "";

  if (isPurchaseGoal) {
    const buyTimeframe = isBigPurchase ? "3-6 месяцев" : "1-3 месяца";
    return {
      goal: goalBase,
      problem:
        `Сейчас нет прозрачной финансовой модели покупки: итоговой суммы, ежемесячного темпа накоплений и плана действий по доходам/расходам. ${constraintPart}`.trim(),
      steps: [
        `Собрать полную стоимость ${targetName}: цена, оформление, экипировка/обслуживание, резерв 10-15%.`,
        "Рассчитать целевой ежемесячный взнос: (нужная сумма - текущие накопления) / срок в месяцах.",
        "Сократить 2-3 необязательные категории расходов и направить высвобожденные деньги в отдельный накопительный счет.",
        "Найти минимум один дополнительный источник дохода на период накопления (подработка, проект, продажа ненужного).",
      ],
      risks: [
        "Недооценить полную стоимость покупки и сопутствующие траты.",
        "Копить без отдельного счета и регулярно тратить часть накоплений.",
        "Не учитывать сезонные/разовые расходы и срывать ежемесячный план.",
      ],
      firstStep:
        `Сегодня за 40 минут открыть заметку/таблицу и зафиксировать: целевую сумму покупки ${targetName}, текущие накопления и дедлайн.`,
      timeframe: buyTimeframe,
      plan: [
        `Этап 1 (7 дней): собрать реальные цены на ${targetName}, посчитать полную сумму и определить дедлайн.`,
        "Этап 2 (2-4 недели): пересобрать бюджет, зафиксировать лимиты расходов и автоматический перевод в накопления.",
        "Этап 3: выполнять еженедельный план накоплений и усиливать доход на фиксированную сумму.",
        `Финальный этап (${buyTimeframe}): проверить достижение суммы, сравнить варианты покупки и принять решение.`,
      ],
      metrics: [
        "Сумма накоплений на конец недели/месяца.",
        "Процент выполнения месячного плана накоплений.",
        "Фактическая экономия по сокращенным категориям расходов.",
      ],
      resources: [
        "Финансовый трекер (таблица или приложение) для еженедельного контроля.",
        "Отдельный накопительный счет/копилка без быстрых трат.",
        "Резерв 10-15% от целевой суммы на непредвиденные расходы.",
      ],
      mistakes: [
        "Ориентироваться только на цену покупки без учета сопутствующих расходов.",
        "Не фиксировать еженедельный прогресс накоплений.",
        "Ставить нереалистичный срок и быстро терять мотивацию.",
      ],
    };
  }

  return {
    goal: goalBase,
    problem: `Сейчас нет стабильного плана с измеримыми этапами и понятными ограничениями. ${constraintPart}`.trim(),
    steps: [
      "Определить конечный результат в одном измеримом критерии на выбранный срок.",
      "Собрать ограничения: доступное время, бюджет, обязательства и доступные ресурсы.",
      "Разбить цель на 3-5 действий и поставить их в календарь на ближайшие 7 дней.",
    ],
    risks: [
      "Слишком общий план без конкретных действий по дням.",
      "Потеря фокуса из-за отсутствия еженедельной проверки прогресса.",
    ],
    firstStep:
      "Сегодня выделить 30 минут, зафиксировать 1 измеримую цель и поставить в календарь первое действие на завтра.",
    timeframe,
    plan: [
      `Этап 1 (первые 7 дней): уточнить цель, критерий результата и рабочие ограничения.`,
      `Этап 2: выполнить ключевые действия по плану и зафиксировать первый измеримый прогресс.`,
      `Этап 3: провести ревизию плана, убрать узкие места и усилить работающие действия.`,
      `Финальный этап (${timeframe}): закрепить результат и определить следующий цикл роста.`,
    ],
    metrics: [
      "Количество выполненных запланированных действий за неделю.",
      "Часы фокусной работы над целью в неделю.",
      "Главный результат в цифрах (доход, отклики, заявки, встречи и т.д.).",
    ],
    resources: [
      "Время: минимум 30-60 минут в день на приоритетные задачи.",
      "Навыки: 1-2 ключевых навыка, которые прямо влияют на цель.",
      "Инструменты: календарь/трекер задач и еженедельный обзор прогресса.",
    ],
    mistakes: [
      "Откладывать практические действия и заниматься только подготовкой.",
      "Не фиксировать прогресс и не корректировать план каждую неделю.",
      "Игнорировать реальные ограничения по времени и ресурсам.",
    ],
  };
}

const MODEL_UNAVAILABLE_CACHE = new Map<string, number>();
const MODEL_UNAVAILABLE_TTL_MS = 10 * 60 * 1000; // 10 минут

function markModelUnavailable(model: string): void {
  MODEL_UNAVAILABLE_CACHE.set(model, Date.now() + MODEL_UNAVAILABLE_TTL_MS);
}

function isModelTemporarilyUnavailable(model: string): boolean {
  const until = MODEL_UNAVAILABLE_CACHE.get(model);
  if (!until) return false;
  if (Date.now() > until) {
    MODEL_UNAVAILABLE_CACHE.delete(model);
    return false;
  }
  return true;
}

function filterAvailableModels(models: string[]): string[] {
  const available = models.filter((m) => !isModelTemporarilyUnavailable(m));
  return available.length > 0 ? available : models;
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

function normalizeAnalysisResponse(data: unknown): AnalysisApiResponse {
  const obj =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};

  return {
    goal: sanitizeString(obj.goal, "Сформулировать конкретную цель на реалистичный срок."),
    problem: sanitizeString(
      obj.problem,
      "Недостаточно ясности в приоритетах и следующем практическом действии.",
    ),
    steps: sanitizeStringArray(obj.steps, [
      "Определить конкретный результат с числовым критерием.",
      "Собрать исходные данные: время, бюджет, текущие ограничения.",
      "Запланировать 3 обязательных действия в календаре на ближайшую неделю.",
    ]),
    risks: sanitizeStringArray(obj.risks, [
      "Переоценка доступного времени и откладывание ключевых задач.",
      "Слишком общий план без ежедневных действий и проверок прогресса.",
    ]),
    firstStep: sanitizeString(
      obj.firstStep,
      "Сегодня выделить 30 минут, записать цель одним предложением и добавить в календарь первое действие на завтра.",
    ),
    timeframe: sanitizeString(obj.timeframe, "1 месяц"),
    plan: sanitizeStringArray(obj.plan ?? obj.plan30Days, [
      "Этап 1: уточнить цель, ограничения и ежедневный минимум действий.",
      "Этап 2: выполнить базовые шаги и зафиксировать промежуточные результаты.",
      "Этап 3: усилить темп, устранить узкие места и скорректировать план.",
      "Этап 4: закрепить результат и определить следующий цикл.",
    ]),
    metrics: sanitizeStringArray(obj.metrics, [
      "Количество выполненных запланированных действий за неделю.",
      "Время, вложенное в ключевую задачу (часы/неделя).",
      "Измеримый итог: доход, отклики, заявки, встречи или другой релевантный показатель.",
    ]),
    resources: sanitizeStringArray(obj.resources, [
      "Время: минимум 30-60 минут в день на приоритетные действия.",
      "Навыки: 1-2 ключевых компетенции, которые нужно подтянуть в первую очередь.",
      "Деньги: минимальный бюджет на инструменты, обучение или тесты.",
    ]),
    mistakes: sanitizeStringArray(obj.mistakes, [
      "Ставить слишком большую цель без недельных контрольных точек.",
      "Изучать бесконечно и не переходить к действиям.",
      "Не фиксировать прогресс и не корректировать план раз в неделю.",
    ]),
  };
}

export async function POST(req: Request) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Не задан API-ключ. Для OpenRouter: OPENROUTER_API_KEY или OPENAI_API_KEY (ключ sk-or-v1-... с openrouter.ai). " +
          "Для прямого OpenAI: OPENAI_API_KEY. Перезапустите dev-сервер после изменения .env.local.",
      },
      { status: 503 },
    );
  }

  const defaultHeaders = buildDefaultHeaders();
  const openai = new OpenAI({
    apiKey,
    ...(process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : {}),
    ...(defaultHeaders ? { defaultHeaders } : {}),
  });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const input =
    typeof body === "object" &&
    body !== null &&
    "input" in body &&
    typeof (body as { input: unknown }).input === "string"
      ? (body as { input: string }).input.trim()
      : "";

  if (!input) {
    return Response.json(
      { error: "Поле input обязательно" },
      { status: 400 },
    );
  }

  const rawMode =
    typeof body === "object" &&
    body !== null &&
    "selectedMode" in body &&
    typeof (body as { selectedMode: unknown }).selectedMode === "string"
      ? (body as { selectedMode: string }).selectedMode.trim()
      : "career";

  const allowedModes = new Set(["career", "business", "life"]);
  const selectedMode = allowedModes.has(rawMode) ? rawMode : "career";

  const adjustment =
    typeof body === "object" &&
    body !== null &&
    "adjustment" in body &&
    typeof (body as { adjustment: unknown }).adjustment === "string"
      ? (body as { adjustment: string }).adjustment.trim()
      : "";

  const currentResultRaw =
    typeof body === "object" &&
    body !== null &&
    "currentResult" in body &&
    typeof (body as { currentResult: unknown }).currentResult === "object" &&
    (body as { currentResult: unknown }).currentResult !== null
      ? (body as { currentResult: unknown }).currentResult
      : null;

  const currentResult = currentResultRaw
    ? normalizeAnalysisResponse(currentResultRaw)
    : null;

  const modeHints: Record<string, string> = {
    career: "карьера, работа и профессиональный рост",
    business: "бизнес, проекты, клиенты и монетизация",
    life: "личная жизнь, отношения, здоровье, быт и саморазвитие вне работы",
  };
  const modeHint = modeHints[selectedMode] ?? modeHints.career;

  const requestId = randomUUID();
  const systemPrompt = `
Ты — практический коуч по достижению результата. Пиши как персональный наставник:
- без абстракций и мотивационных штампов;
- только прикладные действия, которые можно выполнить в реальной жизни;
- советы должны опираться на конкретный текст пользователя.

Требования к качеству:
1) steps: каждый пункт начинается с глагола действия (например: "Сделать", "Найти", "Рассчитать", "Позвонить", "Записать", "Проверить").
2) firstStep: выполним за 1 день, максимально конкретен (что сделать, сколько времени, какой результат должен получиться).
3) timeframe: реалистичный срок достижения цели (например: "2 недели", "1 месяц", "3 месяца").
4) plan: план по этапам/фазам, который соответствует timeframe.
4) metrics: измеримые показатели прогресса (числа, частота, дедлайны).
5) resources: нужные ресурсы (время, деньги, навыки, люди/инструменты).
6) mistakes: частые ошибки именно в таком типе ситуации.

Верни строго JSON-объект без markdown и без пояснений вне JSON.
`;

  const userPrompt = `
${adjustment ? "Это запрос на корректировку существующего плана." : "Это первичный запрос на анализ цели."}
Проанализируй запрос пользователя с фокусом: ${modeHint}.

Верни JSON строго такого формата:
{
  "goal": "краткая и практичная цель",
  "problem": "главное ограничение/узкое место",
  "steps": ["действие 1", "действие 2", "действие 3"],
  "risks": ["риск 1", "риск 2"],
  "firstStep": "конкретное действие на 1 день",
  "timeframe": "реалистичный срок достижения цели",
  "plan": ["этап/фаза 1", "этап/фаза 2", "этап/фаза 3"],
  "metrics": ["метрика 1", "метрика 2"],
  "resources": ["ресурс 1", "ресурс 2"],
  "mistakes": ["ошибка 1", "ошибка 2"]
}

Ограничения:
- Пиши на языке пользователя.
- Не давай общих фраз.
- Каждый пункт должен быть применим на практике.
- Сам оцени реалистичный timeframe по сложности цели, ограничениям и вводным.
- План обязан соответствовать timeframe и быть разбит по этапам/фазам с понятными результатами.
- В steps и plan избегай формулировок "подумать", "постараться", "улучшать" без конкретного действия.
- Если передана корректировка, пересобери план с учетом новых ограничений и обнови ресурсы/риски/ошибки.

Текст пользователя:
${input}

${
  currentResult
    ? `Текущий план (его нужно скорректировать, а не игнорировать):
${JSON.stringify(currentResult)}`
    : ""
}

${
  adjustment
    ? `Дополнительная информация для корректировки:
${adjustment}`
    : ""
}

Служебно (не цитируй в ответе): запрос id ${requestId}.
`;

  const tEnv = Number(process.env.OPENAI_TEMPERATURE);
  const temperature = Number.isFinite(tEnv)
    ? Math.min(2, Math.max(0, tEnv))
    : 0.75;

  const configuredCandidates = resolveModelCandidates();
  const dynamicFreeCandidates = await fetchOpenRouterFreeModels(
    apiKey,
    process.env.OPENAI_BASE_URL,
  );
  const maxModelsToTry = resolveMaxModelsToTry();
  const baseModelCandidates = filterAvailableModels(
    Array.from(new Set([...configuredCandidates, ...dynamicFreeCandidates])),
  );
  const useAllFreeModels =
    isOpenRouterBaseUrl(process.env.OPENAI_BASE_URL) && shouldUseAllOpenRouterFree();
  const modelCandidates = useAllFreeModels
    ? baseModelCandidates
    : baseModelCandidates.slice(0, maxModelsToTry);
  const retryDelaysMs = resolveRetryDelays();
  const globalBudgetMs = resolveGlobalBudgetMs();
  const startedAt = Date.now();
  const progressHeader = {
    "X-Mindflow-Max-Models": String(modelCandidates.length),
  };
  const strictRemoteOnly = (process.env.OPENAI_STRICT_REMOTE_ONLY ?? "1").trim() !== "0";
  const enableLocalFallback = (process.env.OPENAI_ENABLE_LOCAL_FALLBACK ?? "0").trim() === "1";
  const providerErrors: string[] = [];

  try {
    let lastError: unknown = null;
    let normalized: AnalysisApiResponse | null = null;
    let modelUnavailableCount = 0;

    for (const model of modelCandidates) {
      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        if (Date.now() - startedAt > globalBudgetMs) {
          break;
        }
        try {
          const response = await openai.chat.completions.create({
            model,
            temperature,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          });

          // У части моделей/провайдеров choices может быть пустым — не обращаемся к [0] напрямую
          const messageContent = response.choices?.[0]?.message?.content;
          const text = typeof messageContent === "string" ? messageContent : "";
          if (!text.trim()) {
            throw new Error(
              "Модель вернула пустой ответ. Попробуйте ещё раз или смените OPENAI_MODEL в настройках.",
            );
          }

          let parsed: unknown;

          try {
            parsed = JSON.parse(text);
          } catch {
            throw new Error("Не удалось разобрать ответ модели. Попробуйте запрос ещё раз.");
          }

          normalized = normalizeAnalysisResponse(parsed);
          break;
        } catch (e) {
          lastError = e;
          if (isModelUnavailableError(e)) {
            modelUnavailableCount += 1;
            markModelUnavailable(model);
            // У модели нет активных endpoint'ов — сразу пробуем следующую модель
            break;
          }
          const canRetry =
            isRateLimitError(e) &&
            attempt < retryDelaysMs.length &&
            Date.now() - startedAt < globalBudgetMs;
          if (canRetry) {
            await sleep(retryDelaysMs[attempt]);
            continue;
          }
          break;
        }
      }
      if (normalized) break;
      if (Date.now() - startedAt > globalBudgetMs) break;
    }

    if (!normalized) {
      providerErrors.push(
        modelUnavailableCount >= modelCandidates.length
          ? "OpenRouter free: нет доступных endpoint'ов."
          : `OpenRouter free: ${formatProviderError(lastError)}`,
      );

      // 2) Groq fallback (если задан ключ)
      const groqKey = process.env.GROQ_API_KEY?.trim();
      if (groqKey) {
        const groq = new OpenAI({
          apiKey: groqKey,
          baseURL: "https://api.groq.com/openai/v1",
        });
        const groqModels = parseModelsEnv(process.env.GROQ_MODELS, [
          "llama-3.1-8b-instant",
          "llama-3.3-70b-versatile",
        ]);

        for (const model of groqModels) {
          try {
            const response = await groq.chat.completions.create({
              model,
              temperature,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            });
            const text = extractTextFromOpenAILikeResponse(response);
            if (!text.trim()) continue;
            const parsed = JSON.parse(text) as unknown;
            normalized = normalizeAnalysisResponse(parsed);
            break;
          } catch (e) {
            lastError = e;
            continue;
          }
        }
        if (!normalized) {
          providerErrors.push(`Groq: ${formatProviderError(lastError)}`);
        }
      } else {
        providerErrors.push("Groq: API ключ не задан.");
      }

      // 3) Gemini fallback (если задан ключ)
      if (!normalized) {
        const geminiKey = process.env.GEMINI_API_KEY?.trim();
        if (geminiKey) {
          const configuredGeminiModels = parseModelsEnv(process.env.GEMINI_MODELS, [
            "gemini-1.5-flash-latest",
            "gemini-1.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
          ]);
          const availableGemini = await fetchGeminiAvailableModels(geminiKey);
          const configuredAvailable = availableGemini.filter((c) =>
            configuredGeminiModels.includes(c.model),
          );

          const candidatesToTry =
            configuredAvailable.length > 0
              ? configuredAvailable
              : availableGemini.length > 0
                ? availableGemini
                : configuredGeminiModels.flatMap((model) => [
                    { model, apiVersion: "v1beta" as const },
                    { model, apiVersion: "v1" as const },
                  ]);

          for (const candidate of candidatesToTry) {
            try {
              const text = await callGeminiJsonWithVersion(
                geminiKey,
                candidate.apiVersion,
                candidate.model,
                systemPrompt,
                userPrompt,
                temperature,
              );
              if (!text.trim()) continue;
              const parsed = JSON.parse(text) as unknown;
              normalized = normalizeAnalysisResponse(parsed);
              break;
            } catch (e) {
              lastError = e;
              continue;
            }
          }
          if (!normalized) {
            providerErrors.push(`Gemini: ${formatProviderError(lastError)}`);
          }
        } else {
          providerErrors.push("Gemini: API ключ не задан.");
        }
      }

      if (!normalized) {
        if (enableLocalFallback && !strictRemoteOnly) {
          const localPlan = buildLocalFallbackPlan(
            input,
            modeHint,
            adjustment,
            currentResult,
          );
          return Response.json(localPlan, {
            headers: {
              "Cache-Control": "no-store, max-age=0",
              Vary: "*",
              ...progressHeader,
            },
          });
        }

        return Response.json(
          {
            error:
              "Сейчас не удалось получить ответ от удаленных AI-провайдеров. Подождите 1-2 минуты и попробуйте снова.",
          },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", ...progressHeader },
          },
        );
      }
    }

    return Response.json(normalized, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Vary: "*",
        ...progressHeader,
      },
    });
  } catch (e) {
    return Response.json(
      { error: formatProviderError(e) },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
          "X-Mindflow-Max-Models": String(resolveMaxModelsToTry()),
        },
      },
    );
  }
}
