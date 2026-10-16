/* Íris on video (HeyGen LiveAvatar, LITE mode). The Worker starts the session; here the browser
   joins the LiveKit room to show the avatar and feeds the avatar's WebSocket with the reply audio
   (ElevenLabs PCM 16-bit 24 kHz, ~1 s chunks), which the avatar lip-syncs. */
import { useCallback, useEffect, useRef, useState } from "react";

type Started = { ok: true; sessionId: string; livekitUrl: string; livekitToken: string; wsUrl: string; maxSeconds: number };
export type VideoState = "idle" | "connecting" | "live" | "error";

const CHUNK_BYTES = 48_000; // 1 s of 16-bit mono audio at 24 kHz

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function useVideoAvatar(session: string) {
  const [state, setState] = useState<VideoState>("idle");
  const [talking, setTalking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const live = useRef<{ room: { disconnect: () => Promise<void> }; ws: WebSocket; timers: number[] } | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const speaking = useRef(0);

  const send = (event: Record<string, unknown>) => {
    const ws = live.current?.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };

  const stop = useCallback(() => {
    const current = live.current;
    live.current = null;
    ready.current = null;
    if (current) {
      current.timers.forEach((timer) => clearInterval(timer));
      try {
        current.ws.close();
      } catch {
        /* already closed */
      }
      void current.room.disconnect();
      void fetch("/video/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session }), keepalive: true }).catch(() => undefined);
    }
    setTalking(false);
    setState((value) => (value === "error" ? value : "idle"));
  }, [session]);

  const start = useCallback(async () => {
    if (live.current || state === "connecting") return;
    setState("connecting");
    try {
      const response = await fetch("/video/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session }) });
      const data = (await response.json()) as Started | { ok: false; error?: string };
      if (!response.ok || !data.ok) throw new Error(("error" in data && data.error) || String(response.status));

      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
        if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
      });
      room.on(RoomEvent.Disconnected, () => stop());
      await room.connect(data.livekitUrl, data.livekitToken);

      const ws = new WebSocket(data.wsUrl);
      ready.current = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("avatar websocket timeout")), 20_000);
        ws.addEventListener("message", (message) => {
          let event: { type?: string; state?: string; new_state?: string };
          try {
            event = JSON.parse(String(message.data));
          } catch {
            return;
          }
          if (event.type === "session.state_updated" && event.state === "connected") {
            clearTimeout(timeout);
            resolve();
          }
          if (event.type === "session.state_updated" && event.state === "disconnected") stop();
          if (event.type === "agent.state_updated") setTalking(event.new_state === "talking");
        });
        ws.addEventListener("close", () => stop());
      });

      const endsAt = Date.now() + data.maxSeconds * 1000;
      const timers = [
        window.setInterval(() => send({ type: "session.keep_alive" }), 30_000),
        window.setInterval(() => {
          const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
          setSecondsLeft(left);
          if (!left) stop();
        }, 1000),
      ];
      live.current = { room, ws, timers };
      await ready.current;
      setSecondsLeft(data.maxSeconds);
      setState("live");
    } catch (error) {
      console.warn("video unavailable", error);
      stop();
      setState("error");
    }
  }, [session, state, stop]);

  /** Stops whatever the avatar is saying (a new question from the visitor). */
  const interrupt = useCallback(() => {
    speaking.current += 1;
    send({ type: "agent.interrupt" });
  }, []);

  /** Speaks a reply: ElevenLabs PCM sent to the avatar in ~1 s chunks. */
  const speak = useCallback(
    async (text: string) => {
      if (!live.current || !text.trim()) return;
      const turn = ++speaking.current;
      try {
        await ready.current;
        const response = await fetch("/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, session, format: "pcm" }) });
        if (!response.ok) throw new Error(String(response.status));
        const audio = new Uint8Array(await response.arrayBuffer());
        const pcm = audio.subarray(0, audio.length - (audio.length % 2));
        if (turn !== speaking.current) return;
        send({ type: "agent.interrupt" });
        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
          const chunk = toBase64(pcm.subarray(offset, offset + CHUNK_BYTES));
          const last = offset + CHUNK_BYTES >= pcm.length;
          send({ type: last ? "agent.speak_end" : "agent.speak", audio: chunk });
        }
      } catch (error) {
        console.warn("avatar speech failed", error);
      }
    },
    [session]
  );

  useEffect(() => {
    const onHide = () => live.current && navigator.sendBeacon?.("/video/stop", new Blob([JSON.stringify({ session })], { type: "application/json" }));
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      stop();
    };
  }, [session, stop]);

  /** Closes the error notice. */
  const dismiss = useCallback(() => setState("idle"), []);

  return { state, talking, secondsLeft, start, stop, dismiss, speak, interrupt, videoRef, audioRef };
}

export function VideoPanel({
  video,
  name,
  poster,
}: {
  video: ReturnType<typeof useVideoAvatar>;
  name: string;
  poster: string;
}) {
  if (video.state === "idle") return null;
  const minutes = `${Math.floor(video.secondsLeft / 60)}:${String(video.secondsLeft % 60).padStart(2, "0")}`;
  return (
    <section className={`ia-video ${video.talking ? "is-talking" : ""}`} aria-label={`${name} em vídeo`}>
      <video ref={video.videoRef} autoPlay playsInline poster={poster} />
      <audio ref={video.audioRef} autoPlay />
      {video.state === "connecting" && <div className="ia-video-veil">Conectando com a {name}…</div>}
      {video.state === "error" && (
        <div className="ia-video-veil">
          O vídeo não está disponível agora. Continue por aqui, por texto ou voz.
          <button type="button" className="ia-btn" onClick={video.dismiss}>Fechar</button>
        </div>
      )}
      <span className="ia-video-badge">Assistente virtual (IA)</span>
      {video.state === "live" && (
        <div className="ia-video-bar">
          <span>{minutes}</span>
          <button type="button" onClick={video.stop}>Encerrar vídeo</button>
        </div>
      )}
    </section>
  );
}
