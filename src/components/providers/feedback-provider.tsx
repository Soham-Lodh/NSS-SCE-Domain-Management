"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type FeedbackTone = "success" | "error";
type Notice = { id: number; message: string; tone: FeedbackTone };
type Feedback = { success: (message: string) => void; error: (message: string) => void };

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string, tone: FeedbackTone) => {
    const id = ++nextId.current;
    setNotices((current) => [...current, { id, message, tone }].slice(-3));
    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, tone === "error" ? 6_000 : 4_000);
  }, []);

  return (
    <FeedbackContext.Provider value={{ success: (message) => push(message, "success"), error: (message) => push(message, "error") }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {notices.map((notice) => (
          <div
            key={notice.id}
            role={notice.tone === "error" ? "alert" : "status"}
            className={notice.tone === "error" ? "surface-raised border-[color:var(--red-20)] p-3 text-sm font-semibold text-[color:var(--brand-red)]" : "surface-raised p-3 text-sm font-semibold text-[color:var(--brand-navy)]"}
          >
            {notice.message}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("useFeedback must be used within FeedbackProvider.");
  return feedback;
}
