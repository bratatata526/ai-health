import json
import os
import threading
import time
import uuid
from datetime import datetime
from io import BytesIO
from typing import Optional

import requests
from fastapi import APIRouter, File, Form, UploadFile

from ..config import settings, Settings
from ..net.predict import TonguePredictor
from ..models.database import SessionLocal
from ..models.models import AnalysisTask

router_tongue_analysis = APIRouter()
_ark_rate_limit_lock = threading.Lock()
_last_ark_request_ts = 0.0

feature_map = {
    "tongue_color": {
        0: "淡白舌",
        1: "淡红舌",
        2: "红舌",
        3: "绛舌",
        4: "青紫舌",
    },
    "coating_color": {
        0: "白苔",
        1: "黄苔",
        2: "灰黑苔",
    },
    "tongue_thickness": {
        0: "薄",
        1: "厚",
    },
    "rot_greasy": {
        0: "腻",
        1: "腐",
    },
}


def ensure_image_dir():
    os.makedirs(Settings.IMG_PATH, exist_ok=True)


def now_ts():
    return int(time.time() * 1000)


def parse_features(result: dict):
    tongue_color_idx = result["tongue_color"]
    coating_color_idx = result["tongue_coat_color"]
    tongue_thickness_idx = result["thickness"]
    rot_greasy_idx = result["rot_and_greasy"]

    return {
        "tongue_color": {
            "index": tongue_color_idx,
            "label": feature_map["tongue_color"].get(tongue_color_idx, "未知"),
        },
        "coating_color": {
            "index": coating_color_idx,
            "label": feature_map["coating_color"].get(coating_color_idx, "未知"),
        },
        "tongue_thickness": {
            "index": tongue_thickness_idx,
            "label": feature_map["tongue_thickness"].get(tongue_thickness_idx, "未知"),
        },
        "rot_greasy": {
            "index": rot_greasy_idx,
            "label": feature_map["rot_greasy"].get(rot_greasy_idx, "未知"),
        },
    }


def _parse_retry_after_seconds(retry_after_value: Optional[str]) -> Optional[float]:
    if not retry_after_value:
        return None
    try:
        return max(0.0, float(retry_after_value))
    except (TypeError, ValueError):
        return None


def _wait_for_ark_min_interval():
    global _last_ark_request_ts
    min_interval = max(0.0, float(settings.ARK_MIN_INTERVAL_SECONDS))
    if min_interval <= 0:
        return
    with _ark_rate_limit_lock:
        now = time.monotonic()
        wait_seconds = min_interval - (now - _last_ark_request_ts)
        if wait_seconds > 0:
            time.sleep(wait_seconds)
        _last_ark_request_ts = time.monotonic()


def call_doubao_multimodal(segmented_image_base64: str, features: dict, user_input: str = ""):
    if not settings.ARK_API_KEY or not settings.ARK_MODEL_ID:
        return {
            "ok": False,
            "error": "ARK_API_KEY 或 ARK_MODEL_ID 未配置",
            "content": "",
        }

    feature_text = (
        f"舌色: {features['tongue_color']['label']}\n"
        f"苔色: {features['coating_color']['label']}\n"
        f"舌苔厚薄: {features['tongue_thickness']['label']}\n"
        f"腐腻特征: {features['rot_greasy']['label']}"
    )

    prompt = (
        "你是一位经验丰富的中医舌诊专家。"
        "请结合舌象分割图和结构化特征进行详细辨证分析。"
        "输出使用 Markdown 格式，必须包含以下标题：\n"
        "## 舌象综合解读\n"
        "## 可能的中医证型\n"
        "## 调理建议\n"
        "## 风险提示\n"
        "请使用中文，表达专业但通俗。"
    )
    if user_input.strip():
        prompt = f"{prompt}\n\n用户补充信息：{user_input.strip()}"

    payload = {
        "model": settings.ARK_MODEL_ID,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"结构化舌象特征如下:\n{feature_text}\n\n{prompt}",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{segmented_image_base64}"
                        },
                    },
                ],
            }
        ],
        "temperature": 0.3,
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.ARK_API_KEY}",
    }

    max_retries = max(0, int(settings.ARK_MAX_RETRIES))
    base_delay = max(0.1, float(settings.ARK_RETRY_BASE_DELAY_SECONDS))
    request_timeout = max(10, int(settings.ARK_TIMEOUT_SECONDS))

    for attempt in range(max_retries + 1):
        try:
            _wait_for_ark_min_interval()
            response = requests.post(
                settings.ARK_BASE_URL,
                json=payload,
                headers=headers,
                timeout=request_timeout,
            )

            if response.status_code == 429:
                retry_after = _parse_retry_after_seconds(response.headers.get("Retry-After"))
                wait_seconds = retry_after if retry_after is not None else base_delay * (2 ** attempt)
                if attempt < max_retries:
                    time.sleep(min(wait_seconds, 60.0))
                    continue
                error_text = response.text[:200] if response.text else "触发限流"
                return {
                    "ok": False,
                    "content": "",
                    "error": f"Doubao 限流(429)，请稍后重试。详情: {error_text}",
                }

            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return {
                "ok": True,
                "content": content,
                "error": "",
            }
        except requests.exceptions.RequestException as error:
            is_retryable = isinstance(
                error,
                (requests.exceptions.Timeout, requests.exceptions.ConnectionError),
            )
            if is_retryable and attempt < max_retries:
                time.sleep(min(base_delay * (2 ** attempt), 60.0))
                continue
            return {
                "ok": False,
                "content": "",
                "error": str(error),
            }
        except (KeyError, IndexError, TypeError, ValueError) as error:
            return {
                "ok": False,
                "content": "",
                "error": f"Doubao 响应解析失败: {error}",
            }

    return {
        "ok": False,
        "content": "",
        "error": "Doubao 请求失败：超过最大重试次数",
    }


def set_task_status(task_id: str, status: str, progress: int = None, error: str = None, result_data: dict = None):
    db = SessionLocal()
    try:
        task = db.query(AnalysisTask).filter(AnalysisTask.task_id == task_id).first()
        if not task:
            return
        task.status = status
        if progress is not None:
            task.progress = progress
        if error is not None:
            task.error = error
        if result_data is not None:
            task.result_json = json.dumps(result_data, ensure_ascii=False)
        task.updated_at = now_ts()
        db.commit()
    finally:
        db.close()


def run_analysis_task(task_id: str, file_location: str, user_input: str):
    import logging
    logger = logging.getLogger(__name__)
    start_time = time.time()

    set_task_status(task_id, "running", progress=1)
    logger.info(f"[Task {task_id}] Starting analysis...")

    try:
        predictor = TonguePredictor()
        with open(file_location, "rb") as f:
            image_bytes = f.read()

        step1_time = time.time()
        set_task_status(task_id, "running", progress=2)
        logger.info(f"[Task {task_id}] Model init done in {step1_time-start_time:.2f}s")

        prediction = predictor.analyze_image(BytesIO(image_bytes))
        step2_time = time.time()
        logger.info(f"[Task {task_id}] CV analysis done in {step2_time-step1_time:.2f}s")

        if prediction["code"] != 0:
            error_messages = {
                201: "未检测到舌头，请上传清晰舌面照片",
                202: "检测到多个舌头目标，请重新上传单人舌象",
                203: "图像处理失败，请更换图片重试",
            }
            set_task_status(
                task_id,
                "failed",
                progress=4,
                error=error_messages.get(prediction["code"], "分析失败"),
            )
            logger.error(f"[Task {task_id}] CV failed: code={prediction['code']}")
            return

        set_task_status(task_id, "running", progress=3)
        features = parse_features(prediction)
        logger.info(f"[Task {task_id}] Parsing features done in {time.time()-step2_time:.2f}s")

        doubao_result = call_doubao_multimodal(
            segmented_image_base64=prediction["segmented_image_base64"],
            features=features,
            user_input=user_input,
        )
        step3_time = time.time()
        logger.info(f"[Task {task_id}] Doubao API done in {step3_time-step2_time:.2f}s")

        if not doubao_result["ok"]:
            result_data = {
                "features": features,
                "analysis_markdown": "",
                "segmented_image": f"data:image/png;base64,{prediction['segmented_image_base64']}",
            }
            set_task_status(
                task_id,
                "failed",
                progress=4,
                error=f"多模态大模型分析失败: {doubao_result['error']}",
                result_data=result_data,
            )
            logger.error(f"[Task {task_id}] Doubao API failed: {doubao_result['error']}")
            return

        result_data = {
            "features": features,
            "analysis_markdown": doubao_result["content"],
            "segmented_image": f"data:image/png;base64,{prediction['segmented_image_base64']}",
        }
        set_task_status(task_id, "success", progress=4, result_data=result_data)
        total_time = time.time() - start_time
        logger.info(f"[Task {task_id}] Success! Total time: {total_time:.2f}s")
    except Exception as error:
        set_task_status(task_id, "failed", progress=4, error=f"任务执行异常: {str(error)}")
        logger.exception(f"[Task {task_id}] Exception: {error}")


def task_to_response(task: AnalysisTask):
    result_data = None
    if task.result_json:
        try:
            result_data = json.loads(task.result_json)
        except Exception:
            result_data = None

    return {
        "task_id": task.task_id,
        "status": task.status,
        "progress": task.progress,
        "error": task.error,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "result": result_data,
    }


@router_tongue_analysis.get("/features")
async def get_feature_definitions():
    return {
        "code": 0,
        "message": "success",
        "data": feature_map,
    }


@router_tongue_analysis.post("/analyze")
async def analyze_tongue(
    file_data: UploadFile = File(...),
    user_input: str = Form(default=""),
):
    ensure_image_dir()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_extension = os.path.splitext(file_data.filename or "")[1] or ".png"
    filename = f"{timestamp}_{uuid.uuid4().hex[:8]}{file_extension}"
    file_location = f"{Settings.IMG_PATH}/{filename}"

    contents = await file_data.read()
    with open(file_location, "wb") as f:
        f.write(contents)

    task_id = uuid.uuid4().hex
    db = SessionLocal()
    try:
        task = AnalysisTask(
            task_id=task_id,
            status="queued",
            progress=0,
            input_text=user_input,
            image_path=file_location,
            error="",
            result_json="",
            created_at=now_ts(),
            updated_at=now_ts(),
        )
        db.add(task)
        db.commit()
    finally:
        db.close()

    thread = threading.Thread(target=run_analysis_task, args=(task_id, file_location, user_input), daemon=True)
    thread.start()

    return {
        "code": 0,
        "message": "task created",
        "data": {
            "task_id": task_id,
            "status": "queued",
            "progress": 0,
        },
    }


@router_tongue_analysis.get("/tasks/{task_id}")
async def get_task(task_id: str):
    db = SessionLocal()
    try:
        task = db.query(AnalysisTask).filter(AnalysisTask.task_id == task_id).first()
        if not task:
            return {
                "code": 404,
                "message": "task not found",
                "data": None,
            }
        return {
            "code": 0,
            "message": "success",
            "data": task_to_response(task),
        }
    finally:
        db.close()


@router_tongue_analysis.get("/tasks")
async def list_tasks(limit: int = 20):
    db = SessionLocal()
    try:
        tasks = (
            db.query(AnalysisTask)
            .order_by(AnalysisTask.created_at.desc())
            .limit(max(1, min(limit, 100)))
            .all()
        )
        return {
            "code": 0,
            "message": "success",
            "data": [task_to_response(task) for task in tasks],
        }
    finally:
        db.close()


@router_tongue_analysis.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    db = SessionLocal()
    try:
        task = db.query(AnalysisTask).filter(AnalysisTask.task_id == task_id).first()
        if not task:
            return {
                "code": 404,
                "message": "task not found",
                "data": None,
            }
        image_path = task.image_path
        db.delete(task)
        db.commit()

        if image_path and os.path.exists(image_path):
            try:
                os.remove(image_path)
            except Exception:
                pass

        return {
            "code": 0,
            "message": "task deleted",
            "data": {"task_id": task_id},
        }
    except Exception as e:
        db.rollback()
        return {
            "code": 500,
            "message": f"delete failed: {str(e)}",
            "data": None,
        }
    finally:
        db.close()
