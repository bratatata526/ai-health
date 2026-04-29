-- SQL 建表脚本：TongueDiagnosis 异步任务版
-- 用途：创建 AnalysisTask 表用于存储异步任务分析结果

-- 任务表：存储舌象分析任务
CREATE TABLE IF NOT EXISTS AnalysisTask (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    input_text VARCHAR(2000) NOT NULL DEFAULT '',
    image_path VARCHAR(255) NOT NULL,
    error VARCHAR(2000) NOT NULL DEFAULT '',
    result_json TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_task_id ON AnalysisTask(task_id);
CREATE INDEX IF NOT EXISTS idx_created_at ON AnalysisTask(created_at DESC);