import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Divider,
  Paragraph,
  Text,
  TextInput,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { theme, appFontFamilies } from '../theme';
import { TongueService } from '../services/TongueService';
import { SecureStorage } from '../utils/secureStorage';

const HISTORY_KEY = '@tongue_analysis_history';
const POLL_INTERVAL_MS = 3000;

function prettyTime(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '未知';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function normalizeError(error) {
  const message = String(error?.message || '操作失败，请稍后重试');
  if (message.includes('Network request failed') || message.includes('无法连接舌诊服务')) {
    return '无法连接舌诊后端，请确认 Python 服务已启动且地址可访问。';
  }
  return message;
}

async function saveHistory(tasks) {
  await SecureStorage.setItem(HISTORY_KEY, tasks || []);
}

function mergeVisualFields(existing, incoming) {
  return {
    ...incoming,
    original_image_uri:
      incoming?.original_image_uri || existing?.original_image_uri || null,
  };
}

export default function TongueScreen() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showSelectedPreview, setShowSelectedPreview] = useState(false);
  const [showResultImages, setShowResultImages] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [currentTask, setCurrentTask] = useState(null);
  const pollingRef = useRef(null);

  const isTaskRunning = useMemo(() => {
    const status = currentTask?.status;
    return status === 'queued' || status === 'running';
  }, [currentTask?.status]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const loadLocalHistory = useCallback(async () => {
    const local = (await SecureStorage.getItem(HISTORY_KEY)) || [];
    if (Array.isArray(local) && local.length > 0) {
      setTasks(local);
      setCurrentTask(local[0] || null);
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const latest = await TongueService.listTasks(20);
      const list = Array.isArray(latest) ? latest : [];
      setTasks((prev) => {
        const byId = new Map((prev || []).map((x) => [x.task_id, x]));
        const merged = list.map((item) => mergeVisualFields(byId.get(item.task_id), item));
        if (!currentTask && merged[0]) setCurrentTask(merged[0]);
        saveHistory(merged).catch(() => {});
        return merged;
      });
    } catch (error) {
      await loadLocalHistory();
      if (!tasks.length) {
        Alert.alert('获取任务失败', normalizeError(error));
      }
    } finally {
      setLoadingTasks(false);
    }
  }, [currentTask, loadLocalHistory, tasks.length]);

  const updateTaskInList = useCallback(async (task) => {
    setTasks((prev) => {
      const exists = prev.some((item) => item.task_id === task.task_id);
      const next = exists
        ? prev.map((item) =>
            item.task_id === task.task_id ? mergeVisualFields(item, task) : item
          )
        : [task, ...prev];
      saveHistory(next).catch(() => {});
      return next;
    });
    setCurrentTask((prev) => mergeVisualFields(prev, task));
  }, []);

  const pollTask = useCallback(
    async (taskId) => {
      try {
        const latest = await TongueService.getTask(taskId);
        await updateTaskInList(latest);
        if (latest.status === 'success' || latest.status === 'failed') {
          stopPolling();
        }
      } catch (error) {
        stopPolling();
        Alert.alert('轮询失败', normalizeError(error));
      }
    },
    [stopPolling, updateTaskInList]
  );

  const startPolling = useCallback(
    (taskId) => {
      stopPolling();
      pollingRef.current = setInterval(() => {
        pollTask(taskId).catch(() => {});
      }, POLL_INTERVAL_MS);
    },
    [pollTask, stopPolling]
  );

  useEffect(() => {
    refreshTasks().catch(() => {});
    return () => stopPolling();
  }, [refreshTasks, stopPolling]);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '请允许访问相册后再选择舌象图片。');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.[0]) {
      setSelectedImage(result.assets[0]);
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '请允许访问相机后再拍摄舌象图片。');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.[0]) {
      setSelectedImage(result.assets[0]);
    }
  };

  const submit = async () => {
    if (!selectedImage || submitting) {
      Alert.alert('提示', '请先选择或拍摄舌象图片。');
      return;
    }
    setSubmitting(true);
    try {
      const created = await TongueService.createTask(selectedImage, userInput.trim());
      const task = {
        task_id: created.task_id,
        status: created.status || 'queued',
        progress: created.progress || 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        original_image_uri: selectedImage?.uri || null,
      };
      await updateTaskInList(task);
      startPolling(task.task_id);
      Alert.alert('任务已创建', '已开始分析舌象，请稍候查看结果。');
    } catch (error) {
      Alert.alert('创建任务失败', normalizeError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const openTask = async (task) => {
    setCurrentTask(task);
    if (task?.status === 'queued' || task?.status === 'running') {
      startPolling(task.task_id);
      await pollTask(task.task_id);
    }
  };

  const deleteTask = async (taskId) => {
    try {
      await TongueService.deleteTask(taskId);
      const next = tasks.filter((item) => item.task_id !== taskId);
      setTasks(next);
      await saveHistory(next);
      if (currentTask?.task_id === taskId) setCurrentTask(next[0] || null);
    } catch (error) {
      Alert.alert('删除失败', normalizeError(error));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Card.Content>
          <Text style={styles.title}>AI 舌诊分析</Text>
          <Paragraph style={styles.hint}>
            在 APP 内直接完成舌象上传与分析。后端默认地址可通过环境变量配置。
          </Paragraph>
          <View style={styles.buttonRow}>
            <Button mode="outlined" icon="image" onPress={pickImage}>
              选择图片
            </Button>
            <Button mode="outlined" icon="camera" onPress={takePhoto}>
              拍照上传
            </Button>
          </View>

          {selectedImage?.uri ? (
            <>
              <Button
                mode="text"
                compact
                icon={showSelectedPreview ? 'eye-off' : 'eye'}
                onPress={() => setShowSelectedPreview((v) => !v)}
                style={styles.toggleImageButton}
              >
                {showSelectedPreview ? '隐藏原图预览' : '显示原图预览'}
              </Button>
              {showSelectedPreview ? (
                <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} resizeMode="contain" />
              ) : null}
            </>
          ) : null}

          <TextInput
            mode="outlined"
            label="补充症状（可选）"
            placeholder="例如：口干、睡眠差、近期上火"
            value={userInput}
            onChangeText={setUserInput}
            multiline
            style={styles.input}
          />

          <Button mode="contained" onPress={submit} loading={submitting} disabled={submitting || isTaskRunning}>
            {isTaskRunning ? '分析中...' : '开始舌诊分析'}
          </Button>
          {isTaskRunning ? (
            <View style={styles.runningRow}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.runningText}>任务正在进行，请保持网络通畅。</Text>
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.historyHeader}>
            <Text style={styles.sectionTitle}>历史任务</Text>
            <Button compact onPress={refreshTasks} loading={loadingTasks}>
              刷新
            </Button>
          </View>
          <Divider style={styles.divider} />
          {tasks.length === 0 ? (
            <Paragraph style={styles.emptyText}>暂无舌诊任务，先上传一张舌象图片吧。</Paragraph>
          ) : (
            <View style={styles.taskList}>
              {tasks.map((task) => {
                const selected = currentTask?.task_id === task.task_id;
                return (
                  <View key={task.task_id} style={styles.taskItem}>
                    <Chip selected={selected} onPress={() => openTask(task)} style={styles.taskChip}>
                      {`${task.status || 'unknown'} · ${prettyTime(task.created_at)}`}
                    </Chip>
                    <Button compact textColor={theme.colors.error} onPress={() => deleteTask(task.task_id)}>
                      删除
                    </Button>
                  </View>
                );
              })}
            </View>
          )}
        </Card.Content>
      </Card>

      {currentTask ? (
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.sectionTitle}>当前任务详情</Text>
            <Paragraph style={styles.metaText}>任务ID：{currentTask.task_id}</Paragraph>
            <Paragraph style={styles.metaText}>状态：{currentTask.status || 'unknown'}</Paragraph>
            <Paragraph style={styles.metaText}>进度：{currentTask.progress ?? 0} / 4</Paragraph>
            {currentTask.error ? <Paragraph style={styles.errorText}>失败原因：{currentTask.error}</Paragraph> : null}

            {currentTask?.original_image_uri || currentTask?.result?.segmented_image ? (
              <>
                <Button
                  mode="text"
                  compact
                  icon={showResultImages ? 'eye-off' : 'eye'}
                  onPress={() => setShowResultImages((v) => !v)}
                  style={styles.toggleImageButton}
                >
                  {showResultImages ? '隐藏舌诊图片' : '显示舌诊图片（原图/分析图）'}
                </Button>
                {showResultImages ? (
                  <View style={styles.resultImageRow}>
                    {currentTask?.original_image_uri ? (
                      <View style={styles.resultImageCol}>
                        <Text style={styles.resultImageTitle}>原图</Text>
                        <Image
                          source={{ uri: currentTask.original_image_uri }}
                          style={styles.segmentedImage}
                          resizeMode="contain"
                        />
                      </View>
                    ) : null}
                    {currentTask?.result?.segmented_image ? (
                      <View style={styles.resultImageCol}>
                        <Text style={styles.resultImageTitle}>舌头图像分析结果</Text>
                        <Image
                          source={{ uri: currentTask.result.segmented_image }}
                          style={styles.segmentedImage}
                          resizeMode="contain"
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}

            {currentTask?.result?.features ? (
              <View style={styles.featuresBox}>
                <Text style={styles.featuresTitle}>舌象特征</Text>
                <Paragraph style={styles.featureLine}>
                  舌色：{currentTask.result.features.tongue_color?.label || '未知'}
                </Paragraph>
                <Paragraph style={styles.featureLine}>
                  苔色：{currentTask.result.features.coating_color?.label || '未知'}
                </Paragraph>
                <Paragraph style={styles.featureLine}>
                  厚薄：{currentTask.result.features.tongue_thickness?.label || '未知'}
                </Paragraph>
                <Paragraph style={styles.featureLine}>
                  腐腻：{currentTask.result.features.rot_greasy?.label || '未知'}
                </Paragraph>
              </View>
            ) : null}

            {currentTask?.result?.analysis_markdown ? (
              <View style={styles.markdownBox}>
                <Text style={styles.featuresTitle}>AI 分析报告</Text>
                <Text style={styles.markdownText}>{currentTask.result.analysis_markdown}</Text>
              </View>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  card: {
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
  },
  title: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
    fontSize: 20,
    marginBottom: theme.spacing.xs,
    color: theme.colors.text,
  },
  hint: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    backgroundColor: '#f8fafc',
  },
  toggleImageButton: {
    alignSelf: 'flex-start',
    marginBottom: theme.spacing.xs,
  },
  input: {
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  runningText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
    fontSize: 16,
    color: theme.colors.text,
  },
  divider: {
    marginVertical: theme.spacing.sm,
  },
  emptyText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
  },
  taskList: {
    gap: theme.spacing.xs,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  taskChip: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceVariant,
  },
  metaText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
  },
  errorText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
  segmentedImage: {
    width: '100%',
    height: 220,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.xs,
    backgroundColor: '#f8fafc',
  },
  resultImageRow: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  resultImageCol: {
    flex: 1,
  },
  resultImageTitle: {
    fontFamily: appFontFamilies.medium,
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  featuresBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
  },
  featuresTitle: {
    fontFamily: appFontFamilies.bold,
    fontWeight: Platform.OS === 'web' ? '700' : 'normal',
    marginBottom: theme.spacing.xs,
    color: theme.colors.text,
  },
  featureLine: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  markdownBox: {
    marginTop: theme.spacing.md,
  },
  markdownText: {
    fontFamily: appFontFamilies.regular,
    color: theme.colors.text,
    lineHeight: 22,
  },
});
