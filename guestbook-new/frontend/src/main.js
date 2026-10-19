import "./style.css";

// Запросы идут на /api/..., дальше их подхватывает Nginx (в dev-режиме — прокси Vite)
const API = "/api";

const $ = (id) => document.getElementById(id);

async function request(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/* ---------- Роутер (SPA на History API) ---------- */

const routes = {
  "/": "view-home",
  "/about": "view-about",
};

function render() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const viewId = routes[path] ?? "view-404";

  for (const section of document.querySelectorAll("main > section")) {
    section.hidden = section.id !== viewId;
  }
  for (const link of document.querySelectorAll("nav a")) {
    link.classList.toggle("active", link.getAttribute("href") === path);
  }

  if (viewId === "view-home") loadMessages();
}

// Перехватываем клики по внутренним ссылкам, чтобы не перезагружать страницу
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link) return;
  e.preventDefault();
  history.pushState(null, "", link.getAttribute("href"));
  render();
});

// Кнопки «назад» и «вперёд» в браузере
window.addEventListener("popstate", render);

/* ---------- Гостевая книга ---------- */

function renderMessages(list) {
  const box = $("messages");
  box.innerHTML = "";
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">Пока никто ничего не написал. Будьте первым!</div>';
    return;
  }
  for (const m of list) {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "msg-head";

    const name = document.createElement("span");
    name.className = "msg-name";
    name.textContent = m.name; // textContent защищает от XSS

    const date = document.createElement("span");
    date.className = "msg-date";
    date.textContent = new Date(m.createdAt).toLocaleString("ru-RU");

    const text = document.createElement("div");
    text.className = "msg-text";
    text.textContent = m.text;

    head.append(name, date);
    card.append(head, text);
    box.append(card);
  }
}

async function loadMessages() {
  try {
    const list = await request("/messages");
    renderMessages(list);
    $("count").textContent = list.length;
  } catch {
    $("messages").innerHTML = '<div class="error">Не удалось загрузить сообщения</div>';
  }
}

async function registerVisit() {
  // один визит на сессию вкладки, а не на каждую перезагрузку
  try {
    if (sessionStorage.getItem("visited")) return;
    await request("/visit", { method: "POST" });
    sessionStorage.setItem("visited", "1");
  } catch {
    // счётчик не критичен (sessionStorage может быть недоступен)
  }
}

async function loadStats() {
  try {
    const s = await request("/stats"); // только чтение
    $("visits").textContent = s.visits;
    $("count").textContent = s.messages;
  } catch {
    // статистика не критична
  }
}

async function checkHealth() {
  try {
    await request("/health");
    $("dot").className = "dot up";
    $("health").textContent = "API и Redis работают";
  } catch {
    $("dot").className = "dot down";
    $("health").textContent = "API недоступен";
  }
}

$("text").addEventListener("input", () => {
  $("left").textContent = 300 - $("text").value.length;
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("send");
  btn.disabled = true;
  $("form-error").textContent = "";
  try {
    await request("/messages", {
      method: "POST",
      body: JSON.stringify({ name: $("name").value, text: $("text").value }),
    });
    $("text").value = "";
    $("left").textContent = 300;
    await loadMessages();
  } catch {
    $("form-error").className = "error";
    $("form-error").textContent = "Не удалось отправить сообщение";
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Старт ---------- */

registerVisit().then(loadStats);
checkHealth();
setInterval(checkHealth, 10000);
render();
