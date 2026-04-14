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

type AnalysisApiResponse = {
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

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
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
      return Response.json(
        {
          error:
            "Модель вернула пустой ответ. Попробуйте ещё раз или смените OPENAI_MODEL в настройках.",
        },
        {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return Response.json(
        { error: "Не удалось разобрать ответ модели. Попробуйте запрос ещё раз." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const normalized = normalizeAnalysisResponse(parsed);

    return Response.json(normalized, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Vary: "*",
      },
    });
  } catch (e) {
    return Response.json(
      { error: formatProviderError(e) },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
