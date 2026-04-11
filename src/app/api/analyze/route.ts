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

  const modeHints: Record<string, string> = {
    career: "карьера, работа и профессиональный рост",
    business: "бизнес, проекты, клиенты и монетизация",
    life: "личная жизнь, отношения, здоровье, быт и саморазвитие вне работы",
  };
  const modeHint = modeHints[selectedMode] ?? modeHints.career;

  const requestId = randomUUID();
  const prompt = `
Проанализируй текст пользователя и верни СТРОГО JSON без лишнего текста.

Формат:
{
  "goal": "краткая цель",
  "problem": "основная проблема",
  "steps": ["шаг 1", "шаг 2", "шаг 3"],
  "risks": ["риск 1", "риск 2"],
  "firstStep": "самый простой первый шаг"
}

Пиши на языке пользователя. Опирайся на конкретные слова и смысл этого текста — не повторяй универсальные шаблоны, если они не следуют из формулировки.

Фокус анализа (обязательно учитывай в трактовке и советах): ${modeHint}.

Текст:
${input}

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
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0].message.content || "";

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return Response.json(
        { error: "Ошибка парсинга", raw: text },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(parsed, {
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
