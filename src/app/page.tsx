"use client";

import { useState } from "react";

type AnalysisResult = {
  goal: string;
  problem: string;
  steps: string[];
  risks: string[];
  firstStep: string;
};

export default function HomePage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = () => {
    if (!input.trim()) return;

    setLoading(true);
    setResult(null);

    setTimeout(() => {
      setResult({
        goal: "Понять, как достичь желаемого результата",
        problem: "Сейчас цель сформулирована общо, без конкретного плана и опоры на первый шаг",
        steps: [
          "Уточнить, что именно ты хочешь получить в итоге",
          "Разбить большую цель на маленькие шаги",
          "Выбрать один простой шаг, который можно сделать сегодня",
        ],
        risks: [
          "Прокрастинация из-за слишком общей формулировки",
          "Потеря мотивации без быстрого результата",
        ],
        firstStep: "Запиши на листе бумаги или в заметках, что для тебя будет конкретным успешным результатом",
      });
      setLoading(false);
    }, 1500);
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

      {result && (
        <section className="w-full max-w-4xl grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h2 className="mb-2 text-xl font-semibold">Цель</h2>
            <p>{result.goal}</p>
          </div>

          <div className="rounded-xl border p-4">
            <h2 className="mb-2 text-xl font-semibold">Проблема</h2>
            <p>{result.problem}</p>
          </div>

          <div className="rounded-xl border p-4">
            <h2 className="mb-2 text-xl font-semibold">Шаги</h2>
            <ul className="list-disc pl-5 space-y-2">
              {result.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border p-4">
            <h2 className="mb-2 text-xl font-semibold">Риски</h2>
            <ul className="list-disc pl-5 space-y-2">
              {result.risks.map((risk, index) => (
                <li key={index}>{risk}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border p-4 md:col-span-2">
            <h2 className="mb-2 text-xl font-semibold">Первый шаг</h2>
            <p>{result.firstStep}</p>
          </div>
        </section>
      )}
    </main>
  );
}