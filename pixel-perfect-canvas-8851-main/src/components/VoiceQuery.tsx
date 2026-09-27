import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, X, Loader2, Waves } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { askUhiQuestion } from "@/lib/voice-query.functions";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

const EXAMPLES = [
  "What is the temperature trend in Sadar?",
  "सदर इलाके में तापमान का ट्रेंड क्या है?",
  "सदर भागात तापमानाचा ट्रेंड कसा आहे?",
];

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
  if (!Ctor) return null;
  const rec: SpeechRecognitionLike = new Ctor();
  rec.lang = "hi-IN";
  rec.interimResults = true;
  rec.continuous = false;
  return rec;
}

export function VoiceQuery() {
  const ask = useServerFn(askUhiQuestion);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    setSupported(getRecognition() !== null);
    return () => recognitionRef.current?.abort();
  }, []);

  const run = useCallback(
    async (text: string) => {
      setQuestion(text);
      setAnswer("");
      setError("");
      setOpen(true);
      setThinking(true);
      try {
        const res = await ask({ data: { question: text } });
        setAnswer(res.answer);
      } catch {
        setError("The analysis service didn't respond. Please try asking again.");
      } finally {
        setThinking(false);
      }
    },
    [ask],
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const rec = getRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }
    recognitionRef.current = rec;
    setInterim("");
    setListening(true);

    rec.onresult = (event: any) => {
      let finalText = "";
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else partial += result[0].transcript;
      }
      setInterim(partial || finalText);
      if (finalText.trim()) {
        rec.stop();
        setListening(false);
        setInterim("");
        void run(finalText.trim());
      }
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    rec.onend = () => setListening(false);
    rec.start();
  }, [run]);

  return (
    <>
      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          aria-label={listening ? "Stop listening" : "Ask a question by voice"}
          className={`flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            listening ? "mic-pulse" : "shadow-panel"
          }`}
        >
          {listening ? <Square className="h-6 w-6" /> : <Mic className="h-7 w-7" />}
        </button>

        <div className="min-h-10 text-center">
          {listening ? (
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-end gap-1" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-1 animate-pulse rounded-full bg-primary"
                    style={{
                      height: `${8 + ((i * 7) % 18)}px`,
                      animationDelay: `${i * 120}ms`,
                    }}
                  />
                ))}
              </div>
              <p className="text-sm font-medium text-primary">Listening…</p>
              {interim && (
                <p className="max-w-sm text-xs text-muted-foreground italic">{interim}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {supported
                ? "Tap the mic and ask about Nagpur's heat data"
                : "Voice input isn't available in this browser — try an example below"}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void run(q)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-7 py-5">
              <div className="flex items-start gap-3">
                <Waves className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
                    Voice query
                  </p>
                  <h2 className="mt-1 text-lg leading-snug font-semibold text-foreground">
                    {question}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-7 py-7">
              {thinking ? (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Analysing UHI dataset…</span>
                </div>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <p className="text-[15px] leading-7 whitespace-pre-line text-foreground">
                  {answer}
                </p>
              )}
            </div>

            <div className="flex justify-end border-t border-border px-7 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
