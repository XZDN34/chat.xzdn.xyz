const el = (id) => document.getElementById(id);

const pwEl = el("adminPw");
const loginBtn = el("loginBtn");
const clearBtn = el("clearBtn");
const loginHint = el("loginHint");
const actionHint = el("actionHint");

let token = localStorage.getItem("admin_token") || "";

function setAuthed(ok){
  clearBtn.disabled = !ok;
}

async function login(){
  loginHint.textContent = "Logging in…";
  const res = await fetch("/admin/login", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({password: pwEl.value})
  });

  if(!res.ok){
    loginHint.textContent = "Wrong password (or server misconfigured).";
    setAuthed(false);
    return;
  }

  const data = await res.json();
  token = data.token;
  localStorage.setItem("admin_token", token);
  loginHint.textContent = `Logged in. Token expires in ~${Math.round(data.expires_in/60)} min.`;
  setAuthed(true);
}

async function clearAll(){
  if(!confirm("Clear ALL messages and delete ALL uploaded images?")) return;

  actionHint.textContent = "Clearing…";
  const res = await fetch("/admin/clear", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` }
  });

  if(!res.ok){
    actionHint.textContent = "Failed (token expired?). Try logging in again.";
    setAuthed(false);
    return;
  }

  actionHint.textContent = "Done. Chat + images cleared.";
}

loginBtn.addEventListener("click", login);
clearBtn.addEventListener("click", clearAll);

window.addEventListener("load", () => {
  setAuthed(!!token);
  if(token){
    loginHint.textContent = "Token present. If actions fail, log in again.";
  }
});
