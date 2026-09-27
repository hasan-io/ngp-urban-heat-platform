import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import { datasetSummary } from "./uhi-data";
import { createLovableAiGatewayRunIdFetch } from "./lovable-run-id";

const GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

export async function answerUhiQuestion(question: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new Error("AI is not configured for this project.");
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_BASE_URL,
    apiKey,
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    instructions: `You are the analysis assistant of a Nagpur Urban Heat Island (UHI) monitoring platform.
Answer strictly from the dataset below. Be concise: 3-5 short sentences, cite concrete numbers (°C, NDVI, built-up %).
Detect the language of the question and reply in exactly that language:
- English question -> English answer.
- Hindi (Devanagari) -> Hindi in Devanagari.
- Marathi (Devanagari) -> Marathi in Devanagari. Distinguish Marathi from Hindi by vocabulary and grammar (e.g. "भागात", "आहे", "कसा", "का आहे" = Marathi; "इलाके में", "है", "क्या", "क्यों" = Hindi).
- Hinglish (Hindi in Latin script mixed with English) -> natural Hinglish in Latin script.
Keep zone names recognisable and numbers as digits.
If the question is outside this dataset, say briefly that the platform only covers Nagpur UHI data.
Never use markdown formatting.

${datasetSummary}`,
    messages: [{ role: "user", content: question }],
  });

  return (await result.text).trim();
}
