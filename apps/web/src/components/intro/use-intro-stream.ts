import { env } from "@taskaws/env/web";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type IntroStreamState = {
  text: string;
  thinking: boolean;
  done: boolean;
  error: Error | null;
  reload: () => void;
};

type DonePayload = {
  userId?: string;
  name?: string;
  intro?: string;
};

/**
 * Streams a personal intro from the Go microservice via SSE.
 *
 * Why useEffect instead of react-query: this is a streaming side-effect
 * (ReadableStream), not a one-shot query — TanStack Query has no native
 * SSE consumer, so we drive the reader manually and surface errors via toast.
 */
export function useIntroStream(userId: string | undefined): IntroStreamState {
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const controller = new AbortController();
    // Reset for a fresh stream on userId/reload change.
    setText("");
    setThinking(false);
    setDone(false);
    setError(null);

    const processEvent = (raw: string) => {
      let eventType = "";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) {
          eventType = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }
      const data = dataLines.join("\n").trim();

      if (eventType === "thinking") {
        setThinking(true);
        return;
      }

      if (eventType === "done") {
        setThinking(false);
        setDone(true);
        // The done payload carries the authoritative full intro; prefer it
        // over the accumulated word stream to guard against any dropped chunk.
        let handled = false;
        if (data) {
          try {
            const parsed = JSON.parse(data) as DonePayload;
            if (typeof parsed.intro === "string") {
              setText(parsed.intro);
              handled = true;
            }
          } catch {
            // Data wasn't JSON — ignore, fall back to trimming accumulated text.
          }
        }
        if (!handled) {
          setText((prev) => prev.trimEnd());
        }
        return;
      }

      // No `event:` field → a plain word data event.
      if (data) {
        setText((prev) => prev + data + " ");
      }
    };

    const run = async () => {
      try {
        const res = await fetch(
          `${env.VITE_INTRO_SERVICE_URL}/api/intro/stream?userId=${encodeURIComponent(userId!)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "User not found in intro service"
              : `Intro service error (${res.status})`,
          );
        }
        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("Streaming is not supported by this browser");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          // SSE events are separated by a blank line. The trailing fragment
          // (after the last separator) may be incomplete — keep it buffered.
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (part.trim()) {
              processEvent(part);
            }
          }
        }
        // Flush any final buffered event.
        const tail = decoder.decode();
        buffer += tail;
        if (buffer.trim()) {
          processEvent(buffer);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setThinking(false);
        toast.error(e.message || "Failed to stream intro");
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [userId, reloadToken]);

  return { text, thinking, done, error, reload };
}
