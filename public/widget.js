/* Ingrave assistant launcher for ingrave.com.br.
   <script src="https://agente.ingrave.com.br/widget.js" defer></script>
   Optional: data-label, data-greeting (empty to disable), data-position="left".
   Opens the chat in an iframe on demand, sends it the page context (path, title, campaign origin
   saved by the site) and forwards analytics events to Zaraz or the GTM dataLayer, so they follow
   the site's own cookie consent. API: window.IngraveAgent.open() / close() / toggle(); any element
   with data-ingrave-agent or href="#assistente" opens the chat. */
(function () {
  if (window.IngraveAgent) return;
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  // Never inside the assistant itself (a tag manager running on every subdomain would nest a second launcher in the chat).
  if (location.origin === origin) return;
  var data = script.dataset || {};
  var label = data.label || "Fale com a Ingrave";
  // Greeting bubble that matches the page (the chat's own welcome follows the same pages in src/pages.ts).
  var GREETINGS = [
    [/^\/precos/, "Quer ajuda para escolher o plano? Digo qual cabe na sua equipe e quanto fica."],
    [/^\/ferramentas\/calculadora-whatsapp/, "Quer que eu calcule o custo das mensagens do WhatsApp para o seu volume?"],
    [/whatsapp/, "Dúvidas sobre a API oficial do WhatsApp? Posso explicar em poucos minutos."],
    [/^\/comparar/, "Comparando ferramentas? Mostro as diferenças e como funciona a migração."],
    [/^\/produto\/captain|ia-automacao|chatbot/, "Quer ver como a IA pode responder seus clientes? Pergunte aqui."],
    [/^\/contato/, "Prefere resolver agora? Respondo na hora ou chamo a equipe."],
  ];
  function pageGreeting() {
    var path = location.pathname.toLowerCase();
    for (var i = 0; i < GREETINGS.length; i++) if (GREETINGS[i][0].test(path)) return GREETINGS[i][1];
    return "Oi! Posso ajudar a escolher o plano ou tirar dúvidas sobre o WhatsApp?";
  }
  var greeting = data.greeting === undefined ? pageGreeting() : data.greeting;
  var side = data.position === "left" ? "left" : "right";
  var GREETED = "ingrave-agent-greeted";

  var host = document.createElement("div");
  host.id = "ingrave-agent";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  var avatar = origin + "/iris.svg";
  var mark = '<img class="av" src="' + avatar + '" alt="" width="30" height="30">';
  var close = '<svg viewBox="0 0 256 256" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M205.7 194.3a8 8 0 0 1-11.4 11.4L128 139.3l-66.3 66.4a8 8 0 0 1-11.4-11.4l66.4-66.3-66.4-66.3a8 8 0 0 1 11.4-11.4l66.3 66.4 66.3-66.4a8 8 0 0 1 11.4 11.4L139.3 128Z"/></svg>';

  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    ".wrap{position:fixed;" + side + ":20px;bottom:20px;z-index:2147483000;font:600 14.5px/1.2 Inter,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0d1b2a}" +
    ".launch{display:flex;align-items:center;gap:10px;height:52px;padding:0 20px 0 15px;border:0;border-radius:999px;background:#0b6bcb;color:#fff;font:inherit;cursor:pointer;box-shadow:0 10px 30px -6px rgba(11,107,203,.55),0 2px 6px rgba(13,27,42,.15);transition:transform .15s,background .15s}" +
    ".launch:hover{background:#0a5aab;transform:translateY(-1px)}" +
    ".launch:focus-visible{outline:3px solid #9cc8ff;outline-offset:3px}" +
    ".launch .m{position:relative;display:grid;margin-left:-6px}.launch .av{width:34px;height:34px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.85)}.launch .m::after{content:'';position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 2px #0b6bcb}" +
    ".launch .x{display:none}.open .launch .x{display:block}.open .launch .m,.open .launch .t{display:none}.open .launch{width:52px;padding:0;justify-content:center}" +
    ".badge{position:absolute;top:-4px;" + (side === "left" ? "left" : "right") + ":-4px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#e5484d;color:#fff;font-size:12px;line-height:20px;text-align:center;display:none}" +
    ".panel{position:absolute;" + side + ":0;bottom:66px;width:400px;height:min(680px,calc(100vh - 110px));border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 24px 64px -12px rgba(13,27,42,.35),0 0 0 1px rgba(13,27,42,.06);opacity:0;transform:translateY(12px) scale(.98);transform-origin:bottom " + side + ";pointer-events:none;transition:opacity .18s,transform .18s;visibility:hidden}" +
    ".open .panel{opacity:1;transform:none;pointer-events:auto;visibility:visible}" +
    ".panel iframe{width:100%;height:100%;border:0;display:block;background:transparent}" +
    ".hello{position:absolute;" + side + ":0;bottom:66px;width:280px;padding:12px 34px 12px 12px;gap:10px;align-items:flex-start;border-radius:16px;background:#fff;color:#0d1b2a;font-weight:500;font-size:14px;line-height:1.45;box-shadow:0 12px 32px -8px rgba(13,27,42,.3),0 0 0 1px rgba(13,27,42,.06);cursor:pointer;display:none}" +
    ".hello button{position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:#6b7686;cursor:pointer;font-size:16px;line-height:24px}" +
    ".open .hello{display:none!important}" +
    ".hello .av{flex-shrink:0;width:36px;height:36px;border-radius:50%}.hello b{display:block;margin-bottom:2px;font-size:12.5px;font-weight:600;color:#6b7686}" +
    "@media (max-width:520px){.panel{position:fixed;inset:0;width:100%;height:100%;border-radius:0;bottom:0}.open .launch{display:none}}" +
    "@media (prefers-reduced-motion:reduce){.panel,.launch{transition:none}}" +
    "</style>" +
    '<div class="wrap">' +
    '<div class="hello" role="status"><img class="av" src="' + avatar + '" alt=""><div><b>Íris · Ingrave</b><span class="msg"></span></div><button type="button" aria-label="Dispensar">×</button></div>' +
    '<div class="panel" role="dialog" aria-label="Assistente Ingrave"></div>' +
    '<button class="launch" type="button" aria-expanded="false" aria-label="' + label + '"><span class="m">' + mark + '</span><span class="t">' + label + '</span><span class="x">' + close + '</span></button>' +
    '<span class="badge"></span>' +
    "</div>";

  var wrap = root.querySelector(".wrap");
  var panel = root.querySelector(".panel");
  var launch = root.querySelector(".launch");
  var badge = root.querySelector(".badge");
  var hello = root.querySelector(".hello");
  var frame = null;
  var isOpen = false;

  function theme() {
    var attr = document.documentElement.dataset.theme;
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function readTouch(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }

  function context() {
    return { page: location.pathname, title: document.title.slice(0, 200), attribution: { first: readTouch("ig_first_touch"), last: readTouch("ig_last_touch") } };
  }

  function post(message) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, origin);
  }

  function track(event, props) {
    var payload = Object.assign({ page: location.pathname }, props || {});
    try {
      if (window.zaraz && typeof window.zaraz.track === "function") window.zaraz.track(event, payload);
      else if (Array.isArray(window.dataLayer)) window.dataLayer.push(Object.assign({ event: event }, payload));
    } catch (e) { /* analytics unavailable */ }
  }

  function setBadge(count) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.style.display = count > 0 && !isOpen ? "block" : "none";
  }

  function open() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Assistente Ingrave";
      frame.allow = "microphone; autoplay; clipboard-write";
      frame.src = origin + "/?embed=1&theme=" + theme();
      panel.appendChild(frame);
    }
    isOpen = true;
    wrap.classList.add("open");
    launch.setAttribute("aria-expanded", "true");
    launch.setAttribute("aria-label", "Fechar o assistente");
    setBadge(0);
    hideHello(true);
    post({ type: "ingrave-agent:visibility", open: true });
    track("chat_open", { widget: "assistente-ia" });
  }

  function closePanel() {
    isOpen = false;
    wrap.classList.remove("open");
    launch.setAttribute("aria-expanded", "false");
    launch.setAttribute("aria-label", label);
    post({ type: "ingrave-agent:visibility", open: false });
  }

  function hideHello(remember) {
    hello.style.display = "none";
    if (remember) try { sessionStorage.setItem(GREETED, "1"); } catch (e) { /* ignore */ }
  }

  launch.addEventListener("click", function () { isOpen ? closePanel() : open(); });
  hello.addEventListener("click", function (event) {
    if (event.target && event.target.tagName === "BUTTON") return hideHello(true);
    open();
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && isOpen) closePanel(); });
  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-ingrave-agent], a[href="#assistente"]') : null;
    if (!target) return;
    event.preventDefault();
    open();
  });

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !frame || event.source !== frame.contentWindow) return;
    var message = event.data || {};
    if (message.type === "ingrave-agent:ready") {
      post({ type: "ingrave-agent:context", context: context(), theme: theme() });
      post({ type: "ingrave-agent:visibility", open: isOpen });
    } else if (message.type === "ingrave-agent:close") closePanel();
    else if (message.type === "ingrave-agent:unread") setBadge(Number(message.count) || 0);
    else if (message.type === "ingrave-agent:track" && typeof message.event === "string" && /^[a-z_]{2,40}$/.test(message.event)) track(message.event, message.props);
  });

  // Keep the chat in sync when the visitor navigates (SPA) or switches the site theme.
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      post({ type: "ingrave-agent:context", context: context(), theme: theme() });
    }
  }, 1000);
  new MutationObserver(function () { post({ type: "ingrave-agent:context", context: context(), theme: theme() }); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  var greeted = false;
  try { greeted = sessionStorage.getItem(GREETED) === "1"; } catch (e) { /* ignore */ }
  if (greeting && !greeted) {
    setTimeout(function () {
      if (isOpen || frame) return;
      // Picked when shown, so it matches the page the visitor navigated to in the meantime.
      hello.querySelector(".msg").textContent = data.greeting === undefined ? pageGreeting() : greeting;
      hello.style.display = "flex";
    }, 12000);
  }

  window.IngraveAgent = { open: open, close: closePanel, toggle: function () { isOpen ? closePanel() : open(); } };
  (document.body || document.documentElement).appendChild(host);
})();
