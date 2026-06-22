import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from models import Base
from notification_system import SmartNotificationManager

DATABASE_URL = "sqlite:///./notifications.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# --- WebSocket connection manager ---
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, message: dict):
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                self.active.remove(ws)


ws_manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Run hourly cleanup in background
    task = asyncio.create_task(_hourly_cleanup())
    yield
    task.cancel()


async def _hourly_cleanup():
    while True:
        await asyncio.sleep(3600)
        db = SessionLocal()
        try:
            mgr = SmartNotificationManager(db)
            cleaned = mgr.cleanup_orphaned_notifications()
            archived = mgr.archive_old_notifications()
            await ws_manager.broadcast({"event": "cleanup", "cleaned": cleaned, "archived": archived})
        finally:
            db.close()


app = FastAPI(title="Smart Notification System", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_manager(db: Session = Depends(get_db)) -> SmartNotificationManager:
    return SmartNotificationManager(db)


# --- Schemas ---
class NotificationCreate(BaseModel):
    title: str
    message: str
    severity: str = "INFO"
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None


class CleanupRequest(BaseModel):
    valid_entity_ids: Optional[list[str]] = None


# --- Routes ---
@app.get("/notifications")
def list_notifications(
    include_archived: bool = False,
    severity: Optional[str] = None,
    unread_only: bool = False,
    mgr: SmartNotificationManager = Depends(get_manager),
):
    notifications = mgr.get_notifications(
        include_archived=include_archived,
        severity=severity,
        unread_only=unread_only,
    )
    return [n.to_dict() for n in notifications]


@app.post("/notifications", status_code=201)
async def create_notification(
    payload: NotificationCreate,
    background_tasks: BackgroundTasks,
    mgr: SmartNotificationManager = Depends(get_manager),
):
    n = mgr.add_notification(
        title=payload.title,
        message=payload.message,
        severity=payload.severity,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
    )
    background_tasks.add_task(ws_manager.broadcast, {"event": "new", "notification": n.to_dict()})
    return n.to_dict()


@app.patch("/notifications/{notification_id}/read")
async def mark_read(
    notification_id: int,
    background_tasks: BackgroundTasks,
    mgr: SmartNotificationManager = Depends(get_manager),
):
    n = mgr.mark_as_read(notification_id)
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    background_tasks.add_task(ws_manager.broadcast, {"event": "read", "id": notification_id})
    return n.to_dict()


@app.delete("/notifications/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: int,
    background_tasks: BackgroundTasks,
    mgr: SmartNotificationManager = Depends(get_manager),
):
    if not mgr.delete_notification(notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")
    background_tasks.add_task(ws_manager.broadcast, {"event": "deleted", "id": notification_id})


@app.post("/notifications/cleanup")
def run_cleanup(
    payload: CleanupRequest,
    mgr: SmartNotificationManager = Depends(get_manager),
):
    cleaned = mgr.cleanup_orphaned_notifications(valid_entity_ids=payload.valid_entity_ids)
    archived = mgr.archive_old_notifications()
    return {"cleaned_orphaned": cleaned, "archived": archived}


@app.get("/notifications/stats")
def get_stats(mgr: SmartNotificationManager = Depends(get_manager)):
    return mgr.get_stats()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
