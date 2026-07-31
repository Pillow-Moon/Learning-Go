"""API v1 路由汇总。"""
from fastapi import APIRouter

from app.api.v1.analysis import router as analysis_router
from app.api.v1.assessment import router as assessment_router
from app.api.v1.commentary import router as commentary_router
from app.api.v1.course import router as course_router
from app.api.v1.game import router as game_router
from app.api.v1.health import router as health_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(game_router)
api_router.include_router(analysis_router)
api_router.include_router(commentary_router)
api_router.include_router(assessment_router)
api_router.include_router(course_router)
