/* Chat UI of the Ingrave website assistant. Runs inside the iframe opened by widget.js (or full
   page at the Worker URL). One conversation = one IngraveAgent Durable Object, named by a random
   id kept in this browser; "Nova conversa" starts another. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  HeadsetIcon,
  MagnifyingGlassIcon,
  StopIcon,
  UserCircleIcon,
  WhatsappLogoIcon,
  MicrophoneIcon,
  VideoCameraIcon,
  SpeakerHighIcon,
  SpinnerGapIcon,
  StopCircleIcon,
  XIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import type { IngraveAgent } from "./agent";
import { ASSISTANT, type AgentState, type ChatContext, initialAgentState, type MessageMeta, type WidgetMessage } from "./shared";
import { Markdown } from "./ui/Markdown";
import { hintsFor } from "./pages";
import { useVideoAvatar, VideoPanel } from "./ui/VideoAvatar";

const SESSION_KEY = "ingrave-agent-session";
const embedded = typeof window !== "undefined" && window.parent !== window;


function readSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved && /^[0-9a-f-]{36}$/.test(saved)) return saved;
  } catch {
    /* storage blocked: the conversation lives only in this tab */
  }
  return newSession();
}

function newSession() {
  const id = crypto.randomUUID();
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

/** Talks to widget.js on the website (analytics go through the site's own consent). */
function postToSite(message: WidgetMessage) {
  if (embedded) window.parent.postMessage(message, "*");
}
const track = (event: string, props: Record<string, unknown> = {}) => postToSite({ type: "ingrave-agent:track", event, props });

function Avatar({ meta }: { meta?: MessageMeta }) {
  if (meta?.from === "human") {
    return meta.avatarUrl ? <img className="ia-avatar" src={meta.avatarUrl} alt="" /> : <span className="ia-avatar ia-avatar-human"><UserCircleIcon size={18} weight="fill" /></span>;
  }
  return <img className="ia-avatar ia-avatar-iris" src={ASSISTANT.avatar} alt="" />;
}

/* ---------- voice (ElevenLabs) ---------- */

let player: { audio: HTMLAudioElement; stop: () => void } | null = null;

/** "Ouvir" under a reply: the Worker turns the text into speech; one reply plays at a time. */
function SpeakButton({ text, session, autoPlay = false }: { text: string; session: string; autoPlay?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const stopRef = useRef<() => void>(() => undefined);
  const autoPlayed = useRef(false);

  useEffect(() => () => stopRef.current(), []);
  // After a question asked by voice, the answer is read aloud once on its own.
  useEffect(() => {
    if (!autoPlay || autoPlayed.current) return;
    autoPlayed.current = true;
    void play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  const play = async () => {
    if (state === "playing" || state === "loading") return stopRef.current();
    player?.stop();
    setState("loading");
    const controller = new AbortController();
    let url = "";
    const stop = () => {
      controller.abort();
      if (player?.stop === stop) {
        player.audio.pause();
        player = null;
      }
      if (url) URL.revokeObjectURL(url);
      setState("idle");
    };
    stopRef.current = stop;
    try {
      const response = await fetch("/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, session }), signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      player = { audio, stop };
      audio.addEventListener("ended", stop);
      await audio.play();
      setState("playing");
      track("agent_voice_play");
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("voice unavailable", error);
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };

  const label = state === "playing" ? "Parar" : state === "loading" ? "Gerando áudio…" : state === "error" ? "Áudio indisponível" : "Ouvir";
  return (
    <button type="button" className={`ia-speak ${state === "playing" ? "is-on" : ""}`} onClick={play} aria-label={label} title={label}>
      {state === "playing" ? <StopCircleIcon size={15} weight="fill" /> : state === "loading" ? <SpinnerGapIcon size={15} className="ia-spin" /> : <SpeakerHighIcon size={15} />}
      <span>{label}</span>
    </button>
  );
}

/* ---------- feedback (AI Gateway) ---------- */

const FEEDBACK_KEY = "ingrave-agent-feedback";

function readFeedback(): Record<string, 1 | -1> {
  try {
    return JSON.parse(sessionStorage.getItem(FEEDBACK_KEY) || "{}");
  } catch {
    return {};
  }
}

/** 👍/👎 under an assistant reply: recorded on the AI Gateway logs; 👎 also flags the Chatwoot conversation. */
function FeedbackButtons({ messageId, session }: { messageId: string; session: string }) {
  const [value, setValue] = useState<1 | -1 | undefined>(() => readFeedback()[messageId]);
  const send = async (next: 1 | -1) => {
    if (next === value) return;
    setValue(next);
    try {
      sessionStorage.setItem(FEEDBACK_KEY, JSON.stringify({ ...readFeedback(), [messageId]: next }));
    } catch {
      /* storage blocked */
    }
    track(next === 1 ? "agent_feedback_up" : "agent_feedback_down");
    await fetch("/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, message: messageId, value: next }) }).catch(() => undefined);
  };
  return (
    <span className="ia-feedback" role="group" aria-label="Avaliar resposta">
      <button type="button" className={value === 1 ? "is-on" : ""} aria-pressed={value === 1} onClick={() => send(1)} title="Resposta útil" aria-label="Resposta útil">
        <ThumbsUpIcon size={15} weight={value === 1 ? "fill" : "regular"} />
      </button>
      <button type="button" className={value === -1 ? "is-on" : ""} aria-pressed={value === -1} onClick={() => send(-1)} title="Resposta não ajudou" aria-label="Resposta não ajudou">
        <ThumbsDownIcon size={15} weight={value === -1 ? "fill" : "regular"} />
      </button>
      {value && <span className="ia-feedback-thanks">{value === 1 ? "Obrigado!" : "Obrigado, vamos melhorar."}</span>}
    </span>
  );
}

/* ---------- microphone (Workers AI Whisper) ---------- */

const MAX_RECORDING_SECONDS = 60;

const recordingType = () =>
  typeof MediaRecorder === "undefined"
    ? null
    : (["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) ?? null);

/** Tap to record, tap again to send: the recording is transcribed by the Worker and sent as a message. */
function MicButton({ session, disabled, onText, onRecording }: { session: string; disabled: boolean; onText: (text: string) => void; onRecording: (label: string | null) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "working" | "error">("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const type = useMemo(recordingType, []);

  const cleanup = useCallback(() => {
    window.clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  if (!type || !navigator.mediaDevices?.getUserMedia) return null;

  const fail = (message: string) => {
    cleanup();
    setState("error");
    onRecording(message);
    window.setTimeout(() => {
      setState("idle");
      onRecording(null);
    }, 3000);
  };

  const upload = async (blob: Blob) => {
    setState("working");
    onRecording("Transcrevendo…");
    try {
      const response = await fetch("/transcribe", { method: "POST", headers: { "Content-Type": type.split(";")[0], "X-Session": session }, body: blob });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok) return fail(data.error === "audio_too_long" ? "Áudio muito longo. Tente em até 1 minuto." : "Não consegui transcrever agora.");
      if (!data.text) return fail("Não entendi o áudio. Pode repetir?");
      setState("idle");
      onRecording(null);
      track("agent_voice_input");
      onText(data.text);
    } catch {
      fail("Não consegui transcrever agora.");
    }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32000 });
      media.addEventListener("dataavailable", (event) => event.data.size && chunks.push(event.data));
      media.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: type.split(";")[0] });
        cleanup();
        if (blob.size < 1200) return fail("Áudio muito curto. Segure um pouco mais.");
        void upload(blob);
      });
      recorder.current = media;
      media.start();
      setState("recording");
      const startedAt = Date.now();
      onRecording("Gravando… 0:00 · toque para enviar");
      timer.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        onRecording(`Gravando… 0:${String(seconds).padStart(2, "0")} · toque para enviar`);
        if (seconds >= MAX_RECORDING_SECONDS) media.state === "recording" && media.stop();
      }, 250);
    } catch {
      fail("Permita o uso do microfone para falar com o assistente.");
    }
  };

  const toggle = () => {
    if (state === "recording") recorder.current?.state === "recording" && recorder.current.stop();
    else if (state === "idle") void start();
  };

  const label = state === "recording" ? "Parar e enviar" : state === "working" ? "Transcrevendo" : "Falar";
  return (
    <button type="button" className={`ia-mic ${state === "recording" ? "is-on" : ""}`} onClick={toggle} disabled={disabled || state === "working" || state === "error"} aria-label={label} title={label}>
      {state === "working" ? <SpinnerGapIcon size={17} className="ia-spin" /> : state === "recording" ? <StopIcon size={15} weight="fill" /> : <MicrophoneIcon size={18} />}
    </button>
  );
}

/* ---------- tool cards ---------- */

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type Approve = (response: { id: string; approved: boolean }) => void;

function ToolCard({ part, approve, onTrack }: { part: ToolPart; approve: Approve; onTrack: typeof track }) {
  const name = getToolName(part as never);
  const input = (part as { input?: Record<string, unknown> }).input ?? {};
  const output = (part as { output?: Record<string, unknown> }).output;
  const state = part.state;
  const approvalId = (part as { approval?: { id?: string } }).approval?.id;
  const tracked = useRef(false);

  useEffect(() => {
    if (state !== "output-available" || tracked.current || !output) return;
    tracked.current = true;
    if (name === "registrar_contato" && output.ok) onTrack("generate_lead", { form: "agente", page: "assistente" });
    if (name === "transferir_para_humano" && output.ok) onTrack("agent_handoff", { reason: String(input.motivo ?? "") });
  }, [state, output, name, input.motivo, onTrack]);

  if (name === "buscar_conhecimento") {
    const results = (output?.resultados as { titulo: string; url: string }[] | undefined) ?? [];
    if (state !== "output-available") return <div className="ia-chip ia-chip-busy"><MagnifyingGlassIcon size={13} /> Consultando o site da Ingrave…</div>;
    if (!results.length) return null;
    const unique = results.filter((item, index) => results.findIndex((other) => other.url === item.url) === index).slice(0, 3);
    return (
      <div className="ia-sources">
        <span>Fontes</span>
        {unique.map((item) => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">{item.titulo}</a>)}
      </div>
    );
  }

  if (name === "calcular_custo_whatsapp") {
    if (state !== "output-available" || !output) return <div className="ia-chip ia-chip-busy"><WhatsappLogoIcon size={13} /> Calculando…</div>;
    return (
      <div className="ia-card">
        <div className="ia-card-title"><WhatsappLogoIcon size={16} /> Custo estimado da Meta</div>
        <div className="ia-card-big">{String(output.custoMetaMensal)}<small>/mês</small></div>
        {Boolean(output.totalMensal) && <div className="ia-card-row"><span>{String(output.assinaturaIngrave)}</span></div>}
        {Boolean(output.totalMensal) && <div className="ia-card-row ia-strong"><span>Total mensal</span><span>{String(output.totalMensal)}</span></div>}
        <a className="ia-card-link" href="https://ingrave.com.br/ferramentas/calculadora-whatsapp" target="_blank" rel="noopener noreferrer">Abrir a calculadora completa</a>
      </div>
    );
  }

  if (name === "agendar_demonstracao") {
    if (state !== "output-available" || !output) return null;
    return (
      <div className="ia-card">
        <div className="ia-card-title"><CalendarCheckIcon size={16} /> Demonstração com a equipe</div>
        <p className="ia-card-text">{String(output.duracao)}. Escolha o melhor horário na agenda.</p>
        <a className="ia-btn ia-btn-primary" href={String(output.url)} target="_blank" rel="noopener noreferrer" onClick={() => onTrack("booking_click", { page: "assistente" })}>Escolher horário</a>
      </div>
    );
  }

  if (name === "registrar_contato" || name === "transferir_para_humano") {
    const isContact = name === "registrar_contato";
    if (state === "approval-requested" && approvalId) {
      return (
        <div className="ia-card ia-card-ask">
          <div className="ia-card-title">{isContact ? <UserCircleIcon size={16} /> : <HeadsetIcon size={16} />} {isContact ? "Enviar seus dados para a equipe?" : "Transferir para uma pessoa da equipe?"}</div>
          {isContact ? (
            <dl className="ia-facts">
              <dt>Nome</dt><dd>{String(input.nome ?? "")}</dd>
              <dt>E-mail</dt><dd>{String(input.email ?? "")}</dd>
              {Boolean(input.telefone) && <><dt>Telefone</dt><dd>{String(input.telefone)}</dd></>}
              {Boolean(input.empresa) && <><dt>Empresa</dt><dd>{String(input.empresa)}</dd></>}
            </dl>
          ) : (
            <p className="ia-card-text">Vamos enviar o resumo desta conversa para a equipe Ingrave continuar o atendimento por aqui.</p>
          )}
          <div className="ia-actions">
            <button type="button" className="ia-btn ia-btn-primary" onClick={() => approve({ id: approvalId, approved: true })}>{isContact ? "Enviar" : "Transferir"}</button>
            <button type="button" className="ia-btn" onClick={() => approve({ id: approvalId, approved: false })}>{isContact ? "Agora não" : "Continuar com a IA"}</button>
          </div>
          {isContact && <p className="ia-fineprint">Usamos seus dados só para falar sobre a Ingrave, conforme a <a href="https://ingrave.com.br/politica-de-privacidade" target="_blank" rel="noopener noreferrer">política de privacidade</a>.</p>}
        </div>
      );
    }
    if (state === "output-denied" || state === "approval-responded") return null;
    if (state === "output-available" && output) {
      return <div className={`ia-chip ${output.ok ? "ia-chip-ok" : ""}`}><CheckCircleIcon size={13} weight="fill" /> {String(output.message ?? "")}</div>;
    }
    return <div className="ia-chip ia-chip-busy">{isContact ? "Enviando…" : "Transferindo…"}</div>;
  }

  return null;
}

/* ---------- app ---------- */

export default function App() {
  const [session, setSession] = useState(readSession);
  return <Chat key={session} session={session} onReset={() => setSession(newSession())} />;
}

function Chat({ session, onReset }: { session: string; onReset: () => void }) {
  const [input, setInput] = useState("");
  const [agentState, setAgentState] = useState<AgentState>(initialAgentState);
  const [typing, setTyping] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const context = useRef<ChatContext>({});
  const [page, setPage] = useState<string | undefined>();
  const visible = useRef(!embedded);
  const unread = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startedTracked = useRef(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  const video = useVideoAvatar(session);
  const spokenByVideo = useRef<string | null>(null);
  const [recordingLabel, setRecordingLabel] = useState<string | null>(null);
  const [autoSpeakId, setAutoSpeakId] = useState<string | null>(null);
  const voiceTurn = useRef(false);

  // The "Ouvir" button only shows when the Worker has an ElevenLabs key.
  useEffect(() => {
    fetch("/health")
      .then((response) => response.json() as Promise<{ voice?: boolean; video?: boolean }>)
      .then((health) => {
        setVoiceOn(Boolean(health.voice));
        setVideoOn(Boolean(health.video));
      })
      .catch(() => setVoiceOn(false));
  }, []);

  const agent = useAgent<IngraveAgent, AgentState>({
    agent: "IngraveAgent",
    name: session,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onStateUpdate: useCallback((state: AgentState) => setAgentState(state), []),
    onMessage: useCallback((message: MessageEvent) => {
      try {
        const data = JSON.parse(String(message.data));
        if (data?.source === "ingrave-agent" && data.type === "typing") setTyping(data.on ? data.name || "Equipe Ingrave" : null);
      } catch {
        /* chat protocol frames */
      }
    }, []),
  });

  const { messages, sendMessage, addToolApprovalResponse, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 60,
    body: () => ({ context: context.current }),
  });
  const busy = status === "submitted" || status === "streaming";
  const hints = useMemo(() => hintsFor(page), [page]);

  // Context and visibility from widget.js.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as WidgetMessage;
      if (data?.type === "ingrave-agent:context") {
        context.current = data.context ?? {};
        setPage(context.current.page);
        if (data.theme) document.documentElement.dataset.theme = data.theme;
      }
      if (data?.type === "ingrave-agent:visibility") {
        visible.current = data.open;
        if (data.open) {
          unread.current = 0;
          postToSite({ type: "ingrave-agent:unread", count: 0 });
          inputRef.current?.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener("message", onMessage);
    postToSite({ type: "ingrave-agent:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Unread badge on the launcher when the team answers while the panel is closed.
  const lastCount = useRef(messages.length);
  useEffect(() => {
    const added = messages.slice(lastCount.current).filter((message) => message.role === "assistant");
    lastCount.current = messages.length;
    if (added.length && !visible.current) {
      unread.current += added.length;
      postToSite({ type: "ingrave-agent:unread", count: unread.current });
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);

  const send = useCallback(
    (text: string, byVoice = false) => {
      const value = text.trim().slice(0, 2000);
      if (!value || (busy && agentState.mode === "ai")) return;
      if (!startedTracked.current) {
        startedTracked.current = true;
        track("agent_chat_start", { page: context.current.page ?? "" });
      }
      voiceTurn.current = byVoice;
      if (video.state === "live") video.interrupt();
      sendMessage({ role: "user", parts: [{ type: "text", text: value }] });
      setInput("");
    },
    [busy, agentState.mode, sendMessage, video]
  );

  const onLink = useCallback((href: string) => {
    if (href.startsWith("https://app.ingrave.com.br/app/auth/signup")) track("sign_up_click", { page: "assistente", label: "agente-ia" });
  }, []);

  const lastMessage = messages[messages.length - 1];

  // On video, Íris says every finished reply (hers or the team's).
  useEffect(() => {
    if (video.state !== "live" || busy || lastMessage?.role !== "assistant" || spokenByVideo.current === lastMessage.id) return;
    spokenByVideo.current = lastMessage.id;
    const meta = lastMessage.metadata as MessageMeta | undefined;
    if (meta?.from === "system") return;
    const text = lastMessage.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n").trim();
    void video.speak(text);
  }, [busy, lastMessage, video]);
  useEffect(() => {
    // Replies already on screen when the video starts are not read out.
    if (video.state === "live" && !spokenByVideo.current) spokenByVideo.current = lastMessage?.id ?? "";
    if (video.state === "idle") spokenByVideo.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.state]);

  // A question asked by voice gets its answer read aloud when the reply is complete (the video speaks for itself).
  useEffect(() => {
    if (busy || !voiceTurn.current || lastMessage?.role !== "assistant" || video.state === "live") return;
    voiceTurn.current = false;
    if (voiceOn) setAutoSpeakId(lastMessage.id);
  }, [busy, lastMessage, voiceOn, video.state]);
  // "Digitando" until text shows up: while the model thinks, searches or calls a tool.
  const lastPart = lastMessage?.parts[lastMessage.parts.length - 1];
  const waitingForModel =
    agentState.mode === "ai" && busy && (!lastMessage || lastMessage.role === "user" || !(lastPart?.type === "text" && lastPart.text.trim()));
  const typingLabel = typing ? `${typing} está digitando…` : waitingForModel ? `${ASSISTANT.name} está digitando…` : null;
  const banner = useMemo(() => {
    if (agentState.mode === "waiting") return agentState.outsideHours ? "Você está na fila da equipe. Estamos fora do horário agora, e a resposta chega aqui assim que voltarmos." : "Você está na fila. Alguém da equipe responde aqui em instantes.";
    if (agentState.mode === "human") return `${agentState.agent?.name ?? "Equipe Ingrave"} está no atendimento.`;
    return null;
  }, [agentState]);

  return (
    <div className="ia-shell">
      <header className="ia-header">
        <div className="ia-brand">
          <span className={`ia-brand-photo ${connected ? "is-on" : ""}`}>
            {agentState.mode === "human" && agentState.agent?.avatarUrl ? <img src={agentState.agent.avatarUrl} alt="" /> : <img src={ASSISTANT.avatar} alt="" />}
          </span>
          <div>
            <strong>{agentState.mode === "human" ? agentState.agent?.name ?? "Equipe Ingrave" : ASSISTANT.name}</strong>
            <span className="ia-status">{agentState.mode === "human" ? "Equipe Ingrave" : agentState.mode === "waiting" ? "chamando a equipe…" : typingLabel ?? `${ASSISTANT.role} · online`}</span>
          </div>
        </div>
        <div className="ia-header-actions">
          {videoOn && video.state === "idle" && (
            <button type="button" className="ia-video-btn" onClick={() => { track("agent_video_start"); void video.start(); }} title={`Conversar por vídeo com a ${ASSISTANT.name}`}>
              <VideoCameraIcon size={16} weight="fill" /> <span>Vídeo</span>
            </button>
          )}
          <button type="button" className="ia-icon-btn" onClick={onReset} title="Nova conversa" aria-label="Nova conversa"><ArrowClockwiseIcon size={17} /></button>
          {embedded && <button type="button" className="ia-icon-btn" onClick={() => postToSite({ type: "ingrave-agent:close" })} title="Fechar" aria-label="Fechar"><XIcon size={17} /></button>}
        </div>
      </header>

      <VideoPanel video={video} name={ASSISTANT.name} poster={ASSISTANT.avatar} />

      {banner && <div className="ia-banner"><HeadsetIcon size={15} /> {banner}</div>}

      <main className="ia-messages" aria-live="polite">
        {!messages.length && (
          <div className="ia-welcome">
            <img className="ia-welcome-photo" src={ASSISTANT.avatar} alt="" />
            <span className="ia-welcome-hi">Oi, eu sou a {ASSISTANT.name}, assistente virtual da Ingrave.</span>
            <h1>{hints.title}</h1>
            <p>{hints.text}</p>
            <div className="ia-suggestions">
              {hints.suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const meta = message.metadata as MessageMeta | undefined;
          if (message.role === "user") {
            const text = message.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("\n");
            return <div key={message.id} className="ia-row ia-row-user"><div className="ia-bubble-user">{text}</div></div>;
          }
          if (!message.parts.some((part) => (part.type === "text" && part.text.trim()) || isToolUIPart(part))) return null;
          if (meta?.from === "system") {
            return <div key={message.id} className="ia-system">{message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}</div>;
          }
          return (
            <div key={message.id} className="ia-row">
              <Avatar meta={meta} />
              <div className="ia-assistant">
                {meta?.from === "human" && <span className="ia-author">{meta.author}</span>}
                {message.parts.map((part, index) => {
                  if (part.type === "text") return part.text.trim() ? <div key={index} className="ia-md"><Markdown text={part.text} onLink={onLink} /></div> : null;
                  if (isToolUIPart(part)) return <ToolCard key={part.toolCallId} part={part as ToolPart} approve={addToolApprovalResponse} onTrack={track} />;
                  return null;
                })}
                {!(busy && message === lastMessage) && (() => {
                  const spoken = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n").trim();
                  if (!spoken) return null;
                  return (
                    <div className="ia-reply-actions">
                      {voiceOn && <SpeakButton text={spoken} session={session} autoPlay={message.id === autoSpeakId} />}
                      {!meta?.from && <FeedbackButtons messageId={message.id} session={session} />}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}

        {(waitingForModel || typing) && (
          <div className="ia-row">
            {typing ? <span className="ia-avatar ia-avatar-human"><UserCircleIcon size={18} weight="fill" /></span> : <img className="ia-avatar ia-avatar-iris" src={ASSISTANT.avatar} alt="" />}
            <div className="ia-typing-wrap">
              <div className="ia-typing" role="status" aria-label={typingLabel ?? ""}><i /><i /><i /></div>
              <span className="ia-typing-label">{typingLabel}</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <form
        className={`ia-composer ${recordingLabel ? "is-recording" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          maxLength={2000}
          placeholder={recordingLabel ?? (agentState.mode === "ai" ? "Pergunte ou fale com a Ingrave…" : "Escreva para a equipe…")}
          readOnly={Boolean(recordingLabel)}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(input);
            }
          }}
          aria-label="Mensagem"
        />
        {!input.trim() && !(busy && agentState.mode === "ai") && (
          <MicButton session={session} disabled={busy && agentState.mode === "ai"} onText={(text) => send(text, true)} onRecording={setRecordingLabel} />
        )}
        {busy && agentState.mode === "ai" ? (
          <button type="button" className="ia-send" onClick={() => stop()} aria-label="Parar"><StopIcon size={16} weight="fill" /></button>
        ) : (
          <button type="submit" className="ia-send" disabled={!input.trim()} aria-label="Enviar"><ArrowUpIcon size={16} weight="bold" /></button>
        )}
      </form>
      <footer className="ia-footer">
        Respostas geradas por IA podem conter erros. <a href="https://ingrave.com.br/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Privacidade</a>
      </footer>
    </div>
  );
}
