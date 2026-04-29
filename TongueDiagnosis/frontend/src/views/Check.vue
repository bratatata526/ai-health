<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const file = ref(null)
const previewImage = ref('')
const userInput = ref('')
const creatingTask = ref(false)
const taskList = ref([])
const selectedTaskId = ref('')
let timer = null

const selectedTask = computed(() => {
  return taskList.value.find((task) => task.task_id === selectedTaskId.value) || null
})

const selectedResult = computed(() => selectedTask.value?.result || null)

const renderedAnalysis = computed(() => {
  const markdown = selectedResult.value?.analysis_markdown || ''
  return markdown ? md.render(markdown) : ''
})

const onFileChange = (uploadFile) => {
  if (!uploadFile || !uploadFile.raw) return
  file.value = uploadFile.raw
  const reader = new FileReader()
  reader.onload = (e) => {
    previewImage.value = e.target?.result || ''
  }
  reader.readAsDataURL(uploadFile.raw)
}

const featureRows = (result) => {
  if (!result || !result.features) return []
  const f = result.features
  return [
    { key: '舌色', value: f.tongue_color?.label || '未知' },
    { key: '苔色', value: f.coating_color?.label || '未知' },
    { key: '舌苔厚薄', value: f.tongue_thickness?.label || '未知' },
    { key: '腐腻特征', value: f.rot_greasy?.label || '未知' },
  ]
}

const statusTagType = (status) => {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'warning'
  return 'info'
}

const stepLabels = {
  0: '排队中',
  1: '初始化模型',
  2: 'CV分析中',
  3: 'AI辨证中',
  4: '已完成',
}

const progressLabel = (progress) => {
  return stepLabels[progress] || `进度 ${progress}/4`
}

const statusLabel = (status) => {
  if (status === 'success') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '分析中'
  return '排队中'
}

const formatTime = (ts) => {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

const mergeTask = (task) => {
  const idx = taskList.value.findIndex((item) => item.task_id === task.task_id)
  if (idx >= 0) {
    taskList.value[idx] = task
  } else {
    taskList.value.unshift(task)
  }
}

const fetchTasks = async () => {
  const response = await axios.get('/model/tasks', { timeout: 15000 })
  if (response.data.code !== 0) return
  taskList.value = response.data.data || []
  if (!selectedTaskId.value && taskList.value.length > 0) {
    selectedTaskId.value = taskList.value[0].task_id
  }
}

const fetchTaskById = async (taskId) => {
  const response = await axios.get(`/model/tasks/${taskId}`, { timeout: 15000 })
  if (response.data.code !== 0 || !response.data.data) return
  mergeTask(response.data.data)
}

const pollRunningTasks = async () => {
  const runningTasks = taskList.value.filter((task) => task.status === 'queued' || task.status === 'running')
  for (const task of runningTasks) {
    await fetchTaskById(task.task_id)
  }
}

const startPolling = () => {
  if (timer) return
  timer = setInterval(() => {
    pollRunningTasks().catch((error) => console.error(error))
  }, 4000)
}

const stopPolling = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

const submitAnalyze = async () => {
  if (!file.value) {
    ElMessage.error('请先上传舌象图片')
    return
  }

  creatingTask.value = true
  try {
    const formData = new FormData()
    formData.append('file_data', file.value)
    formData.append('user_input', userInput.value)
    const response = await axios.post('/model/analyze', formData, {
      timeout: 30000,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    if (response.data.code !== 0) {
      ElMessage.error(response.data.message || '创建任务失败')
      return
    }

    const createdTask = {
      task_id: response.data.data.task_id,
      status: response.data.data.status,
      progress: response.data.data.progress,
      error: '',
      created_at: Date.now(),
      updated_at: Date.now(),
      result: null,
    }
    mergeTask(createdTask)
    selectedTaskId.value = createdTask.task_id
    ElMessage.success('任务已创建，你可以先去做别的事情，稍后回来查看结果')
  } catch (error) {
    ElMessage.error('请求失败，请检查后端服务是否启动')
    console.error(error)
  } finally {
    creatingTask.value = false
  }
}

const deleteTask = async (taskId) => {
  try {
    await axios.delete(`/model/tasks/${taskId}`)
    taskList.value = taskList.value.filter((t) => t.task_id !== taskId)
    if (selectedTaskId.value === taskId) {
      selectedTaskId.value = taskList.value[0]?.task_id || ''
    }
    ElMessage.success('任务已删除')
  } catch (error) {
    ElMessage.error('删除失败')
    console.error(error)
  }
}

onMounted(async () => {
  try {
    await fetchTasks()
  } catch (error) {
    console.error(error)
  }
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="page-wrap">
    <div class="container">
      <section class="panel upload-panel">
        <h1>舌相 AI 检测</h1>
        <p class="desc">上传后会立即创建任务。你可以离开页面，稍后返回查看结果。</p>

        <el-upload
          class="upload"
          drag
          :auto-upload="false"
          :on-change="onFileChange"
          :show-file-list="false"
          accept=".jpg,.jpeg,.png,.bmp"
        >
          <div class="upload-text">点击或拖拽上传舌象图片</div>
        </el-upload>

        <el-input
          v-model="userInput"
          type="textarea"
          :rows="4"
          placeholder="可选：补充症状信息（如口干、睡眠差、食欲差）"
        />

        <div class="actions">
          <el-button type="primary" size="large" :loading="creatingTask" @click="submitAnalyze">
            创建分析任务
          </el-button>
          <el-button size="large" @click="fetchTasks">刷新任务</el-button>
        </div>

        <div v-if="previewImage" class="preview-block">
          <h3>当前上传预览</h3>
          <img :src="previewImage" alt="当前上传舌象" />
        </div>
      </section>

      <section class="panel task-panel">
        <h2>任务列表</h2>
        <div v-if="taskList.length === 0" class="placeholder">暂无任务</div>
        <div v-else class="task-list">
          <div
            v-for="task in taskList"
            :key="task.task_id"
            :class="['task-item', { active: selectedTaskId === task.task_id }]"
            @click="selectedTaskId = task.task_id"
          >
            <div class="task-head">
              <div class="task-id">{{ task.task_id.slice(0, 12) }}...</div>
              <div class="task-actions">
                <el-tag :type="statusTagType(task.status)">{{ statusLabel(task.status) }}</el-tag>
                <el-button type="danger" size="small" link @click.stop="deleteTask(task.task_id)">删除</el-button>
              </div>
            </div>
            <div class="step-progress">
              <span class="step-label">{{ progressLabel(task.progress) }}</span>
              <el-progress :percentage="(task.progress / 4) * 100" :stroke-width="8" :show-text="false" />
            </div>
            <div class="task-time">创建时间：{{ formatTime(task.created_at) }}</div>
          </div>
        </div>
      </section>
    </div>

    <div class="result-wrap panel">
      <h2>任务详情</h2>
      <div v-if="!selectedTask" class="placeholder">请选择一个任务查看详情</div>

      <div v-else>
        <div class="detail-head">
          <div><b>任务ID：</b>{{ selectedTask.task_id }}</div>
          <div><b>状态：</b>{{ statusLabel(selectedTask.status) }}</div>
          <div><b>进度：</b>{{ progressLabel(selectedTask.progress) }}</div>
        </div>

        <div v-if="selectedTask.error" class="error-box">{{ selectedTask.error }}</div>

        <div v-if="selectedResult" class="image-group">
          <div v-if="selectedResult.segmented_image" class="image-card">
            <h3>SAM 分割舌象</h3>
            <img :src="selectedResult.segmented_image" alt="分割舌象" />
          </div>
        </div>

        <div v-if="selectedResult && selectedResult.features" class="feature-grid">
          <div v-for="row in featureRows(selectedResult)" :key="row.key" class="feature-item">
            <span class="k">{{ row.key }}</span>
            <span class="v">{{ row.value }}</span>
          </div>
        </div>

        <div v-if="renderedAnalysis" class="analysis markdown-body" v-html="renderedAnalysis"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-wrap {
  min-height: 100vh;
  background: linear-gradient(135deg, #fef7ed 0%, #eff6ff 100%);
  padding: 24px;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.panel {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

h1, h2, h3 {
  margin: 0 0 10px;
  color: #0f172a;
}

.desc {
  color: #475569;
  margin-bottom: 14px;
}

.upload {
  margin-bottom: 14px;
}

.upload-text {
  color: #334155;
  font-weight: 600;
}

.actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.preview-block {
  margin-top: 14px;
}

.preview-block img {
  width: 100%;
  border-radius: 8px;
  background: #e2e8f0;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
}

.step-progress {
  margin: 8px 0;
}

.step-label {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 4px;
}

.task-item.active {
  border-color: #2563eb;
  background: #eff6ff;
}

.task-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-id {
  font-size: 13px;
  color: #1f2937;
}

.task-time {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}

.result-wrap {
  max-width: 1200px;
  margin: 20px auto 0;
}

.detail-head {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
  color: #334155;
}

.error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
}

.image-group {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.image-card {
  background: #f8fafc;
  border-radius: 12px;
  padding: 10px;
}

.image-card img {
  width: 100%;
  border-radius: 8px;
  object-fit: contain;
  background: #e2e8f0;
}

.feature-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.feature-item {
  background: #f1f5f9;
  border-radius: 10px;
  padding: 10px;
}

.k {
  display: block;
  color: #64748b;
  font-size: 13px;
}

.v {
  display: block;
  color: #0f172a;
  font-weight: 600;
  margin-top: 4px;
}

.analysis {
  margin-top: 16px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 10px;
  color: #1e293b;
  line-height: 1.65;
}

.placeholder {
  margin-top: 14px;
  color: #64748b;
}

@media (max-width: 900px) {
  .container {
    grid-template-columns: 1fr;
  }

  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 12px 0 8px;
}

.markdown-body p,
.markdown-body li {
  line-height: 1.65;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 20px;
}
</style>
