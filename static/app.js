const el = (id) => document.getElementById(id);

const messagesEl = el("messages");
const statusEl = el("status");
const textInput = el("textInput");
const sendBtn = el("sendBtn");
const imageInput = el("imageInput");


const SITE_PASSWORD = 'nomichael';

function denyAccess(){
  document.documentElement.innerHTML = '<meta charset="utf-8"><title>Access denied</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}h1{font-size:20px}</style><div><h1>Access denied</h1></div>';
}

function requirePassword(){
  try{
    if (sessionStorage.getItem('site_authed') === '1') return;
  }catch(e){}
  let attempts = 3;
  while(attempts-- > 0){
    const input = prompt('Enter site password:');
    if (input === null) { denyAccess(); return; }
    if (input === SITE_PASSWORD){
      try{ sessionStorage.setItem('site_authed','1'); }catch(e){}
      return;
    }
    alert('Wrong password');
  }
  denyAccess();
}

requirePassword();

const nameModal = el("nameModal");
const nameInput = el("nameInput");
const nameSaveBtn = el("nameSaveBtn");
const nameCancelBtn = el("nameCancelBtn");
const changeNameBtn = el("changeNameBtn");

let username = localStorage.getItem("chat_username") || "";
let ws = null;
let notificationPermission = Notification?.permission || "default";

// Request notification permission
async function requestNotificationPermission(){
  if(!("Notification" in window)) return;
  if(notificationPermission === "granted") return;
  if(notificationPermission === "denied") return;
  
  try{
    const permission = await Notification.requestPermission();
    notificationPermission = permission;
  }catch(e){
    console.log("Notification permission error:", e);
  }
}

// Send a browser notification
function sendNotification(title, options = {}){
  if(!("Notification" in window)) return;
  if(notificationPermission !== "granted") return;
  
  try{
    new Notification(title, {
      icon: "/static/favicon.ico",
      ...options
    });
  }catch(e){
    console.log("Notification error:", e);
  }
}

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
  } else if(msg.kind === "video"){
    const video = document.createElement("video");
    video.src = msg.content;
    video.controls = true;
    video.style.maxWidth = "100%";
    video.style.maxHeight = "400px";
    body.appendChild(video);
  } else {
    // Render markdown if available, otherwise fall back to plain text.
    try {
      if (window.marked && window.DOMPurify) {
        const html = marked.parse(msg.content || "");
        body.innerHTML = DOMPurify.sanitize(html);
      } else {
        body.textContent = msg.content;
      }
    } catch (err) {
      body.textContent = msg.content;
    }
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
      
      // Send notification for messages from other users
      if(data.message.username !== username){
        let notificationText = "";
        if(data.message.kind === "text"){
          notificationText = data.message.content.slice(0, 100);
        } else if(data.message.kind === "image"){
          notificationText = "📷 Sent an image";
        } else if(data.message.kind === "video"){
          notificationText = "🎬 Sent a video";
        }
        
        sendNotification(`New message from ${data.message.username}`, {
          body: notificationText,
          tag: "chat-message"
        });
      }
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

async function uploadFile(file){
  if(!file) return;
  const fd = new FormData();
  fd.append("file", file);

  const isVideo = file.type.startsWith("video/");
  statusEl.textContent = isVideo ? "Uploading video…" : "Uploading image…";

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
  if(file) await uploadFile(file);
});

// Paste to upload: Ctrl+V or Cmd+V on document
document.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items || [];
  for(const item of items){
    if(item.kind === "file"){
      const file = item.getAsFile();
      if(file && (file.type.startsWith("image/") || file.type.startsWith("video/"))){
        e.preventDefault();
        await uploadFile(file);
        break;
      }
    }
  }
});

// --- Markdown preview wiring ---
const previewEl = el("md-preview");
const previewToggle = el("previewToggle");

function renderPreview(){
  if(!previewEl) return;
  const enabled = previewToggle && previewToggle.dataset && previewToggle.dataset.enabled === "true";
  if(enabled){
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(textInput.value || "");
      previewEl.innerHTML = DOMPurify.sanitize(html);
    } else {
      previewEl.textContent = textInput.value;
    }
    previewEl.classList.remove("hidden");
    if(previewToggle) previewToggle.textContent = "Preview: On";
  } else {
    previewEl.classList.add("hidden");
    if(previewToggle) previewToggle.textContent = "Preview: Off";
  }
}

if(previewToggle){
  previewToggle.dataset.enabled = "false";
  previewToggle.addEventListener('click', () => {
    previewToggle.dataset.enabled = previewToggle.dataset.enabled !== "true" ? "true" : "false";
    renderPreview();
  });
}
textInput.addEventListener('input', renderPreview);
renderPreview();

changeNameBtn.addEventListener("click", () => openNameModal(true));

nameSaveBtn.addEventListener("click", () => {
  setUsername(nameInput.value);
  closeNameModal();
  statusEl.textContent = `Online as ${username}`;
  requestNotificationPermission();
});
nameCancelBtn.addEventListener("click", () => {
  if(!username) setUsername("Anonymous");
  closeNameModal();
});

window.addEventListener("load", async () => {
  openNameModal(!username);
  if(!username) setUsername("Anonymous");
  
  requestNotificationPermission();

  await loadHistory();
  connectWS();
});
