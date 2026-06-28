from dataclasses import asdict

from fastapi import APIRouter, Depends

from app.auth import require_auth
from app.engines.registry import ENGINES

router = APIRouter(prefix="/api/engines", tags=["engines"], dependencies=[Depends(require_auth)])


@router.get("")
def list_engines():
    return [asdict(m) for m in ENGINES.values()]
