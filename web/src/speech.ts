import { useEffect, useRef, useState } from "react";

const LOCALE: Record<string, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

/**
 * Voice input through the browser's own speech recognition (Chrome, Edge, Safari) — no audio leaves the page
 * through LÜMEN. Calls onText with the recognised phrase; `supported` is false where the browser has no recognition.
 */
export function useSpeech(lang: string, onText: (text: string, final: boolean) => void) {
  const Rec: any = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* already stopped */ } }, []);

  const start = () => {
    if (!Rec || listening) return;
    setError("");
    const r = new Rec();
    r.lang = LOCALE[lang] ?? "ru-RU";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: any) => {
      let text = "";
      let final = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = final || e.results[i].isFinal;
      }
      cb.current(text.trim(), final);
    };
    r.onerror = (e: any) => setError(e.error === "not-allowed" ? "mic" : e.error || "error");
    r.onend = () => setListening(false);
    rec.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  };
  const stop = () => { try { rec.current?.stop(); } catch { /* not running */ } };
  return { supported: !!Rec, listening, error, start, stop, toggle: () => (listening ? stop() : start()) };
}
