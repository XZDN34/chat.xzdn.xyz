const el = (id) => document.getElementById(id);

const messagesEl = el("messages");
const statusEl = el("status");
const textInput = el("textInput");
const sendBtn = el("sendBtn");
const imageInput = el("imageInput");

const nameModal = el("nameModal");
const nameInput = el("nameInput");
const nameSaveBtn = el("nameSaveBtn");
const nameCancelBtn = el("nameCancelBtn");
const changeNameBtn = el("changeNameBtn");

let username = localStorage.getItem("chat_username") || "";
let ws = null;

function openNameModal(force=false){
  if (!force && username) return;
  nameInput.value = username || "";
  nameModal.classList.add("show");
  setTimeout(() => nameInput.focus(), 20);
}
function closeNameModal(){
  nameModal.classList.remove("show");
}
function setUsername(name){
  username = (name || "").trim().slice(0,24);
  if(!username) username = "Anonymous";
  localStorage.setItem("chat_username", username);
}

function fmtTime(ts){
  const d = new Date(ts * 1000);
  return d.toLocaleString([], {hour:"2-digit", minute:"2-digit"}) + " • " +
         d.toLocaleDateString([], {day:"2-digit", month:"short"});
}

function scrollToBottom(){
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(msg){
  const wrap = document.createElement("div");
  wrap.className = "msg";

  const meta = document.createElement("div");
  meta.className = "meta";
  const u = document.createElement("b");
  u.textContent = msg.username;
  const t = document.createElement("div");
  t.textContent = fmtTime(msg.ts);
  meta.appendChild(u);
  meta.appendChild(t);

  const body = document.createElement("div");
  body.className = "body";

  if(msg.kind === "image"){
    const img = document.createElement("img");
    img.src = msg.content;
    img.loading = "lazy";
    body.appendChild(img);
  }else{
    body.textContent = msg.content;
  }

  wrap.appendChild(meta);
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

async function loadHistory(){
  const res = await fetch("/history?limit=120");
  const data = await res.json();
  messagesEl.innerHTML = "";
  for(const m of data.messages){
    addMessage(m);
  }
}

function connectWS(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    statusEl.textContent = `Online as ${username}`;
  };
  ws.onclose = () => {
    statusEl.textContent = "Disconnected — retrying…";
    setTimeout(connectWS, 700);
  };
  ws.onerror = () => {
    statusEl.textContent = "Connection error";
  };
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if(data.type === "message"){
      addMessage(data.message);
    }else if(data.type === "cleared"){
      messagesEl.innerHTML = "";
    }
  };
}

function sendText(){
  const text = textInput.value.trim();
  if(!text) return;
  if(!ws || ws.readyState !== 1) return;

  ws.send(JSON.stringify({
    type: "message",
    username,
    text
  }));
  textInput.value = "";
  textInput.focus();
}

async function uploadImage(file){
  if(!file) return;
  const fd = new FormData();
  fd.append("file", file);

  statusEl.textContent = "Uploading image…";

  const res = await fetch(`/upload?username=${encodeURIComponent(username)}`, {
    method: "POST",
    body: fd
  });

  if(!res.ok){
    let msg = "Upload failed";
    try{
      const j = await res.json();
      msg = j.detail || msg;
    }catch{}
    statusEl.textContent = `Upload error: ${msg}`;
    return;
  }

  statusEl.textContent = `Online as ${username}`;
}

sendBtn.addEventListener("click", sendText);
textInput.addEventListener("keydown", (e) => {
  // Enter sends the message, Shift+Enter inserts a newline
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if(file) await uploadImage(file);
});

changeNameBtn.addEventListener("click", () => openNameModal(true));

nameSaveBtn.addEventListener("click", () => {
  setUsername(nameInput.value);
  closeNameModal();
  statusEl.textContent = `Online as ${username}`;
});
nameCancelBtn.addEventListener("click", () => {
  if(!username) setUsername("Anonymous");
  closeNameModal();
});

window.addEventListener("load", async () => {
  openNameModal(!username);
  if(!username) setUsername("Anonymous");

  await loadHistory();
  connectWS();
});
