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
  SpeakerHighIcon,
  SpinnerGapIcon,
  StopCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { IngraveAgent } from "./agent";
import { type AgentState, type ChatContext, initialAgentState, type MessageMeta, type WidgetMessage } from "./shared";
import { Markdown } from "./ui/Markdown";

const SESSION_KEY = "ingrave-agent-session";
const embedded = typeof window !== "undefined" && window.parent !== window;

const SUGGESTIONS = [
  "Quanto custa a Ingrave?",
  "Como funciona o WhatsApp com vários atendentes?",
  "Quero migrar do Octadesk",
  "Falar com a equipe",
];

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

function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <path fill="#1f93ff" d="M403.3,218.6l-174.2,263.9c-11.8,17.9-38.4,17.3-49.3-1.3l-67.2-114.1-26.3-44.7-19.8-33.7c-4.5-9.1,5.8-18.3,14.4-13l25.9,15.9,50.2,30.8,39.6,24.2,156.7-158.7,50.2,30.7Z" />
      <path fill="#2086c4" d="M509.5,57.7l-85.7,129.9-20.4,30.9-50.2-30.8,44.3-44.8,96.3-97.5c8.2-8.4,21.9,2.1,15.7,12.3Z" />
      <path fill="#2086c4" d="M86.4,322.4l26.3,44.7-96.3,97.5c-8.4,8.5-22-2-15.9-12.3l85.8-129.9Z" />
      <path fill="#1f93ff" d="M429.2,234.4l-25.9-15.9-50.2-30.8-39.6-24.2-156.7,158.7-50.2-30.8L280.8,27.5c11.8-17.9,38.4-17.3,49.2,1.3l67.2,114.1,26.3,44.7,19.8,33.7c4.5,9.2-5.6,18.4-14.2,13.1Z" />
    </svg>
  );
}

function Avatar({ meta }: { meta?: MessageMeta }) {
  if (meta?.from === "human") {
    return meta.avatarUrl ? <img className="ia-avatar" src={meta.avatarUrl} alt="" /> : <span className="ia-avatar ia-avatar-human"><UserCircleIcon size={18} weight="fill" /></span>;
  }
  return <span className="ia-avatar"><Logo size={16} /></span>;
}

/* ---------- voice (ElevenLabs) ---------- */

let player: { audio: HTMLAudioElement; stop: () => void } | null = null;

/** "Ouvir" under a reply: the Worker turns the text into speech; one reply plays at a time. */
function SpeakButton({ text, session }: { text: string; session: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => () => stopRef.current(), []);

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
  const visible = useRef(!embedded);
  const unread = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startedTracked = useRef(false);
  const [voiceOn, setVoiceOn] = useState(false);

  // The "Ouvir" button only shows when the Worker has an ElevenLabs key.
  useEffect(() => {
    fetch("/health")
      .then((response) => response.json() as Promise<{ voice?: boolean }>)
      .then((health) => setVoiceOn(Boolean(health.voice)))
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

  // Context and visibility from widget.js.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as WidgetMessage;
      if (data?.type === "ingrave-agent:context") {
        context.current = data.context ?? {};
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
    (text: string) => {
      const value = text.trim().slice(0, 2000);
      if (!value || (busy && agentState.mode === "ai")) return;
      if (!startedTracked.current) {
        startedTracked.current = true;
        track("agent_chat_start", { page: context.current.page ?? "" });
      }
      sendMessage({ role: "user", parts: [{ type: "text", text: value }] });
      setInput("");
    },
    [busy, agentState.mode, sendMessage]
  );

  const onLink = useCallback((href: string) => {
    if (href.startsWith("https://app.ingrave.com.br/app/auth/signup")) track("sign_up_click", { page: "assistente", label: "agente-ia" });
  }, []);

  const lastMessage = messages[messages.length - 1];
  const waitingForModel = agentState.mode === "ai" && busy && (!lastMessage || lastMessage.role === "user");
  const banner = useMemo(() => {
    if (agentState.mode === "waiting") return agentState.outsideHours ? "Você está na fila da equipe. Estamos fora do horário agora, e a resposta chega aqui assim que voltarmos." : "Você está na fila. Alguém da equipe responde aqui em instantes.";
    if (agentState.mode === "human") return `${agentState.agent?.name ?? "Equipe Ingrave"} está no atendimento.`;
    return null;
  }, [agentState]);

  return (
    <div className="ia-shell">
      <header className="ia-header">
        <div className="ia-brand">
          <span className="ia-brand-mark"><Logo size={20} /></span>
          <div>
            <strong>Assistente Ingrave</strong>
            <span className={`ia-status ${connected ? "is-on" : ""}`}>{agentState.mode === "human" ? `com ${agentState.agent?.name ?? "a equipe"}` : agentState.mode === "waiting" ? "aguardando a equipe" : "IA · responde na hora"}</span>
          </div>
        </div>
        <div className="ia-header-actions">
          <button type="button" className="ia-icon-btn" onClick={onReset} title="Nova conversa" aria-label="Nova conversa"><ArrowClockwiseIcon size={17} /></button>
          {embedded && <button type="button" className="ia-icon-btn" onClick={() => postToSite({ type: "ingrave-agent:close" })} title="Fechar" aria-label="Fechar"><XIcon size={17} /></button>}
        </div>
      </header>

      {banner && <div className="ia-banner"><HeadsetIcon size={15} /> {banner}</div>}

      <main className="ia-messages" aria-live="polite">
        {!messages.length && (
          <div className="ia-welcome">
            <span className="ia-welcome-mark"><Logo size={28} /></span>
            <h1>Olá! Como posso ajudar?</h1>
            <p>Tire dúvidas sobre a Ingrave, planos e WhatsApp, ou peça para falar com a equipe.</p>
            <div className="ia-suggestions">
              {SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}
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
                {voiceOn && !(busy && message === lastMessage) && (() => {
                  const spoken = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n").trim();
                  return spoken ? <SpeakButton text={spoken} session={session} /> : null;
                })()}
              </div>
            </div>
          );
        })}

        {(waitingForModel || typing) && (
          <div className="ia-row">
            <span className="ia-avatar">{typing ? <UserCircleIcon size={18} weight="fill" /> : <Logo size={16} />}</span>
            <div className="ia-typing" aria-label={typing ? `${typing} está digitando` : "Pensando"}><i /><i /><i /></div>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <form
        className="ia-composer"
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
          placeholder={agentState.mode === "ai" ? "Pergunte sobre a Ingrave…" : "Escreva para a equipe…"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(input);
            }
          }}
          aria-label="Mensagem"
        />
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
