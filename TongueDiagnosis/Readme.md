# 舌相 AI 检测系统 TongueDiagnosis

基于深度学习的舌象分析 + 多模态大模型智能辨证

---

## 功能特性

- **异步任务分析**：上传后立即返回任务，用户可离开页面，稍后返回查看结果
- **SAM 舌象分割**：智能提取舌象区域
- **ResNet 特征识别**：舌色、苔色、厚薄、腐腻四维特征检测
- **豆包多模态分析**：基于分割图 + 结构化特征输出专业中医辨证
- **无需登录**：直接上传即可使用

---

## 一、环境准备

### 1.1 安装基础软件

| 软件 | 版本要求 | 下载地址 |
|------|----------|----------|
| Python | 3.9+ | https://www.python.org/downloads/ |
| Conda | 23.10+ | https://www.anaconda.com/download （或安装 Miniconda） |
| Node.js | 18+ | https://nodejs.org/ |

**推荐使用 Conda 管理 Python 环境。**

### 1.2 克隆项目

```bash
# 克隆代码到本地
git clone https://github.com/huwanguli/tongue_ai.git
cd tongue_ai
```

---

## 二、环境配置

### 2.1 创建 Python 环境

```bash
# 方法一：使用 Conda（推荐）
conda create -n tongueai python=3.9.21
conda activate tongueai

# 方法二：使用 venv（如果不想用 Conda）
python -m venv venv
# Windows 激活：
venv\Scripts\activate
# Linux/Mac 激活：
source venv/bin/activate
```

### 2.2 安装 Python 依赖

```bash
pip install -r requirements.txt
```

### 2.3 安装前端依赖

```bash
cd frontend
npm install
```

---

## 三、模型权重文件配置

### 3.1 创建权重目录

```bash
# 在项目根目录创建 weights 目录
mkdir -p application/net/weights
# Windows:
mkdir application\net\weights
```

### 3.2 放置权重文件

将以下权重文件放入 `application/net/weights/` 目录：

| 文件名 | 大小 | 说明 |
|--------|------|------|
| `yolov5.pt` | ~165MB | YOLOv5 舌象定位模型 |
| `sam_vit_b_01ec64.pth` | ~358MB | SAM 分割模型 |
| `tongue_color.pth` | ~109MB | 舌色识别模型 |
| `tongue_coat_color.pth` | ~109MB | 苔色识别模型 |
| `thickness.pth` | ~109MB | 厚薄识别模型 |
| `rot_and_greasy.pth` | ~109MB | 腐腻识别模型 |

**获取方式**：请联系项目作者获取，或从原始项目 releases 页面下载。

**注意**：这些文件非常大（总计约 1GB），不要提交到 Git。

---

## 四、配置环境变量

### 4.1 复制环境变量模板

```bash
# 复制 .env.example 为 .env
cp .env.example .env
# Windows:
copy .env.example .env
```

### 4.2 编辑 .env 文件

用文本编辑器（如记事本、VS Code）打开 `.env` 文件，填入你的豆包 API 信息：

```bash
ARK_API_KEY=你的APIKey
ARK_MODEL_ID=你的模型ID
```

- **ARK_API_KEY**：火山引擎豆包 API Key（需要到火山引擎开发者平台申请）
- **ARK_MODEL_ID**：豆包模型 ID（如 `doubao-seed-1-6-lite-251015`）

---

## 五、启动服务

### 5.1 启动后端

```bash
# 激活 Python 环境
conda activate tongueai  # 或 source venv/bin/activate

# 启动后端服务
python run.py
```

后端启动成功后，会看到类似输出：
```
INFO:     Started server process [xxxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:5000
```

**后端地址**：`http://localhost:5000`  
**API 文档**：`http://localhost:5000/docs`

### 5.2 启动前端（另开一个终端窗口）

```bash
cd frontend

# 启动开发服务器
npm run dev
```

前端启动成功后，会看到类似输出：
```
VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://xxx.xxx.xxx.xxx:5173/
```

**前端地址**：`http://localhost:5173`

---

## 六、使用流程

1. 打开浏览器访问 `http://localhost:5173`
2. 上传舌象图片
3. 可选择填写症状信息（如口干、睡眠差等）
4. 点击"创建分析任务"
5. 在任务列表中查看分析进度
6. 完成后查看结果（包含特征和分析报告）

---

## 七、常见问题

### Q1：后端启动时报错 "No module named 'xxx'"

**解决**：确保已激活 Conda 环境，然后重新安装依赖：
```bash
conda activate tongueai
pip install -r requirements.txt
```

### Q2：前端启动时报错 "node: internal/errors"

**解决**：删除 node_modules 后重新安装：
```bash
cd frontend
Remove-Item -Recurse -Force node_modules
npm install
```

### Q3：分析时报错 "未检测到舌头"

**解决**：确保上传的图片是清晰的舌象照片，不要有遮挡。

### Q4：分析时报错 "多模态大模型分析失败"

**解决**：
1. 检查 `.env` 文件中的 `ARK_API_KEY` 和 `ARK_MODEL_ID` 是否正确
2. 检查网络连接是否正常
3. 查看后端终端的错误信息

### Q5：权重文件下载后放哪里？

**回答**：放 `application/net/weights/` 目录下，结构如下：
```
application/
└── net/
    └── weights/
        ├── yolov5.pt
        ├── sam_vit_b_01ec64.pth
        ├── tongue_color.pth
        ├── tongue_coat_color.pth
        ├── thickness.pth
        └── rot_and_greasy.pth
```

---

## 八、项目结构

```
tongue_ai/
├── run.py                      # 后端入口
├── requirements.txt            # Python 依赖
├── .env.example               # 环境变量模板
├── .env                       # 环境变量（不要提交到 Git）
├── Readme.md                   # 项目文档
│
├── application/                # 后端代码
│   ├── __init__.py
│   ├── config/              # 配置
│   ├── models/             # 数据模型
│   ├── net/                # 深度学习模型
│   │   ├── predict.py
│   │   ├── model/
│   │   └── weights/        # 权重文件（需要自己下载）
│   ├── orm/               # 数据库
│   └── routes/             # API 路由
│
├── frontend/                # 前端代码
│   ├── src/
│   │   ├── main.js
│   │   ├── App.vue
│   │   ├── views/
│   │   │   └── Check.vue
│   │   └── components/
│   │       └── Header.vue
│   ├── package.json
│   └── vite.config.js
│
└── AppDatabase.db           # SQLite 数据库（自动生成）
```

---

## 九、API 接口文档

### 基础配置

- **Base URL**: `http://localhost:5000/api/model`
- **Content-Type**: `application/json`（除特殊说明外）

### 接口列表

#### 1. 获取特征定义

```
GET /features
```

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "tongue_color": {
      "0": "淡白舌",
      "1": "淡红舌",
      "2": "红舌",
      "3": "绛舌",
      "4": "青紫舌"
    },
    "coating_color": {
      "0": "白苔",
      "1": "黄苔",
      "2": "灰黑苔"
    },
    "tongue_thickness": {
      "0": "薄",
      "1": "厚"
    },
    "rot_greasy": {
      "0": "腻",
      "1": "腐"
    }
  }
}
```

---

#### 2. 创建分析任务

```
POST /analyze
Content-Type: multipart/form-data
```

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file_data | File | 是 | 舌象图片 |
| user_input | String | 否 | 用户补充的症状信息 |

**响应示例**:
```json
{
  "code": 0,
  "message": "task created",
  "data": {
    "task_id": "abc123def456",
    "status": "queued",
    "progress": 0
  }
}
```

---

#### 3. 获取单个任务

```
GET /tasks/{task_id}
```

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "abc123def456",
    "status": "success",
    "progress": 4,
    "error": "",
    "created_at": 1713456789000,
    "updated_at": 1713456815000,
    "result": {
      "features": {
        "tongue_color": { "index": 1, "label": "淡红舌" },
        "coating_color": { "index": 0, "label": "白苔" },
        "tongue_thickness": { "index": 0, "label": "薄" },
        "rot_greasy": { "index": 0, "label": "腻" }
      },
      "analysis_markdown": "## 舌象综合解读\n\n...",
      "segmented_image": "data:image/png;base64,..."
    }
  }
}
```

**任务状态说明**:
| status | 说明 |
|--------|------|
| queued | 排队中 |
| running | 分析中 |
| success | 成功 |
| failed | 失败 |

**进度说明**:
| progress | 说明 |
|----------|------|
| 0 | 排队中 |
| 1 | 初始化模型 |
| 2 | CV分析中 |
| 3 | AI辨证中 |
| 4 | 已完成 |

---

#### 4. 获取任务列表

```
GET /tasks?limit=20
```

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| limit | Integer | 20 | 返回数量上限 |

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "task_id": "abc123def456",
      "status": "success",
      "progress": 4,
      "created_at": 1713456789000,
      "result": { ... }
    }
  ]
}
```

---

#### 5. 删除任务

```
DELETE /tasks/{task_id}
```

**响应示例**:
```json
{
  "code": 0,
  "message": "task deleted",
  "data": {
    "task_id": "abc123def456"
  }
}
```

---

## 十、技术支持

如果部署过程中遇到问题，请：
1. 查看本文档的"常见问题"部分
2. 查看后端终端的错误信息
3. 联系项目作者获取帮助

---

## License

MIT License