import os
import re
import uuid
import shutil
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

import aiosqlite
from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect,
    UploadFile, File, HTTPException, Depends, Header
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_DIR / "data"
UPLOADS_DIR = APP_DIR / "uploads"
DB_PATH = DATA_DIR / "chat.db"

DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# 8======> Config
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "nigga123")
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "remember to change")
TOKEN_MAX_AGE_SECONDS = int(os.environ.get("TOKEN_MAX_AGE_SECONDS", "3600"))  # 1 hour
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "8"))
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

serializer = URLSafeTimedSerializer(TOKEN_SECRET)

app = FastAPI(title="Web Chatroom")

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    username TEXT NOT NULL,
    kind TEXT NOT NULL,          
    content TEXT NOT NULL        
);
"""

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(CREATE_TABLES_SQL)
        await db.commit()

@app.on_event("startup")
async def on_startup():
    await init_db()


def sanitize_username(name: str) -> str:
    name = name.strip()
    name = re.sub(r"\s+", " ", name)
    if not name:
        return "Anonymous"
    # Limit length
    return name[:24]

def make_token() -> str:
    return serializer.dumps({"admin": True, "iat": int(time.time())})

def verify_token(token: str) -> bool:
    try:
        data = serializer.loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
        return bool(data.get("admin"))
    except (BadSignature, SignatureExpired):
        return False

async def require_admin(authorization: Optional[str] = Header(None)) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing admin token")
    token = authorization.split(" ", 1)[1].strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid/expired admin token")


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active.remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, payload: Dict[str, Any]):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()


@app.get("/")
async def serve_index():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/admin")
async def serve_admin():
    return FileResponse(STATIC_DIR / "admin.html")


@app.get("/history")
async def get_history(limit: int = 100):
    limit = max(1, min(limit, 300))
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, ts, username, kind, content FROM messages ORDER BY id DESC LIMIT ?",
            (limit,)
        )
        rows = await cur.fetchall()
    # Return oldest -> newest
    rows = list(reversed([dict(r) for r in rows]))
    return {"messages": rows}


@app.post("/upload")
async def upload_image(username: str, file: UploadFile = File(...)):
    username = sanitize_username(username)

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only common image types are allowed")

    # Size limit: read in memory once (simple). For huge files, stream-chunking is better.
    raw = await file.read()
    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Max upload size is {MAX_UPLOAD_MB} MB")

    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif"
    }.get(file.content_type, "")

    fname = f"{uuid.uuid4().hex}{ext}"
    out_path = UPLOADS_DIR / fname
    out_path.write_bytes(raw)

    url_path = f"/uploads/{fname}"
    msg = {
        "ts": int(time.time()),
        "username": username,
        "kind": "image",
        "content": url_path
    }

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO messages (ts, username, kind, content) VALUES (?, ?, ?, ?)",
            (msg["ts"], msg["username"], msg["kind"], msg["content"])
        )
        await db.commit()

    await manager.broadcast({"type": "message", "message": msg})
    return {"ok": True, "url": url_path}


@app.post("/admin/login")
async def admin_login(payload: Dict[str, Any]):
    pw = str(payload.get("password", ""))
    if pw != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")
    return {"token": make_token(), "expires_in": TOKEN_MAX_AGE_SECONDS}


@app.post("/admin/clear")
async def admin_clear(_: None = Depends(require_admin)):
    # Delete messages
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM messages;")
        await db.execute("DELETE FROM sqlite_sequence WHERE name='messages';")
        await db.commit()

    # Delete uploads
    if UPLOADS_DIR.exists():
        for p in UPLOADS_DIR.iterdir():
            if p.is_file():
                try:
                    p.unlink()
                except Exception:
                    pass

    await manager.broadcast({"type": "cleared"})
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_json()
            # expected: {type:"message", username:"", text:"..."}
            if data.get("type") != "message":
                continue

            username = sanitize_username(str(data.get("username", "")))
            text = str(data.get("text", "")).strip()
            if not text:
                continue
            text = text[:2000]

            msg = {
                "ts": int(time.time()),
                "username": username,
                "kind": "text",
                "content": text
            }

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO messages (ts, username, kind, content) VALUES (?, ?, ?, ?)",
                    (msg["ts"], msg["username"], msg["kind"], msg["content"])
                )
                await db.commit()

            await manager.broadcast({"type": "message", "message": msg})

    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)
