import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({ question: z.string().min(2).max(500) });

export const askUhiQuestion = createServerFn({ method: "POST" })
  .validator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { answerUhiQuestion } = await import("./voice-query.server");
    const answer = await answerUhiQuestion(data.question);
    return { answer };
  });
