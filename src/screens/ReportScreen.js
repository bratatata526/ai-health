import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  Share,
  Platform,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  Text,
  SegmentedButtons,
  ProgressBar,
  Switch,
  ActivityIndicator,
} from 'react-native-paper';
import { LineChart, StackedBarChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { ReportService } from '../services/ReportService';
import { ExportService } from '../services/ExportService';
import { AuthService } from '../services/AuthService';
import { PersonalizedAdviceCache } from '../services/PersonalizedAdviceCache';
import { AI_DISCLAIMER_ZH } from '../constants/aiDisclaimer';
import { Alert } from 'react-native';
import { sanitizeHealthAdviceText } from '../utils/sanitizeAiOutput';

const { width } = Dimensions.get('window');

export default function ReportScreen() {
  const [reportType, setReportType] = useState('week');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [assistantAdvice, setAssistantAdvice] = useState('');

  const refreshAssistantAdvice = useCallback(async () => {
    try {
      const c = await PersonalizedAdviceCache.get();
      setAssistantAdvice(c?.text || '');
    } catch {
      setAssistantAdvice('');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const p = await AuthService.getProfile();
        setProfile(p);
      } catch {
        setProfile(null);
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAssistantAdvice();
    }, [refreshAssistantAdvice])
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ReportService.generateReport(reportType, useAI);
      setReport(data);
      await refreshAssistantAdvice();
    } catch (error) {
      console.error('加载报告失败:', error);
      Alert.alert('错误', '生成报告失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [reportType, useAI, refreshAssistantAdvice]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const shareReport = async () => {
    try {
      const message = `我的${reportType === 'week' ? '周' : '月'}健康报告\n\n` +
        `平均心率: ${report.avgHeartRate} bpm\n` +
        `平均血糖: ${report.avgBloodGlucose} mmol/L\n` +
        `平均睡眠: ${report.avgSleep} 小时\n` +
        `健康评分: ${report.healthScore}/100`;
      
      await Share.share({
        message,
        title: '健康报告',
      });
    } catch (error) {
      console.error('分享失败:', error);
    }
  };

  const exportReport = async () => {
    try {
      const result = await ExportService.exportReport(reportType, 'pdf', {
        useAI,
      });
      if (result?.success) {
        Alert.alert('成功', result.message || '报告已导出');
      } else {
        Alert.alert('提示', result?.message || '导出未完成');
      }
    } catch (error) {
      Alert.alert('错误', '导出报告失败，请重试');
      console.error('导出报告失败:', error);
    }
  };

  const chartConfig = {
    backgroundColor: theme.colors.surface,
    backgroundGradientFrom: theme.colors.surface,
    backgroundGradientTo: theme.colors.surface,
    decimalPlaces: 1,
    color: (opacity = 1) => `rgba(74, 144, 226, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(44, 62, 80, ${opacity})`,
    style: {
      borderRadius: 16,
    },
  };

  const renderTrendInsight = (insight, options = {}) => {
    if (!insight) return null;
    const { unit = '', includeMinuteDetail = false, title = '趋势分析' } = options;
    const fmt = (v) => (v == null ? '暂无' : `${v}${unit ? ` ${unit}` : ''}`);
    return (
      <View style={styles.trendInsightBox}>
        <Text style={styles.trendInsightTitle}>{title}</Text>
        <Text style={styles.trendInsightLine}>正常范围：{insight.normalRange || '暂无'}</Text>
        <Text style={styles.trendInsightLine}>均值判断：{insight.status || '未知'}</Text>
        <Text style={styles.trendInsightLine}>
          统计结果：平均 {fmt(insight.average)} / 最高 {fmt(insight.max)} / 最低 {fmt(insight.min)}
        </Text>
        <Text style={styles.trendInsightLine}>
          最近值：{fmt(insight.latest)}；样本量：{insight.sampleCount ?? 0}
        </Text>
        <Text style={styles.trendInsightLine}>数据解读：{insight.summary || '暂无解读'}</Text>
        {Array.isArray(insight.dailyFindings) && insight.dailyFindings.length > 0 ? (
          <Text style={styles.trendInsightLine}>
            每日重点：
            {insight.dailyFindings.join('；')}
          </Text>
        ) : null}
        {includeMinuteDetail && insight.minuteAverage ? (
          <>
            <Text style={styles.trendInsightLine}>
              分钟级心率统计（报告专用）：均值 {insight.minuteAverage.average} bpm，最高{' '}
              {insight.minuteAverage.max} bpm，最低 {insight.minuteAverage.min} bpm，P95{' '}
              {insight.minuteAverage.p95} bpm，标准差 {insight.minuteAverage.std} bpm。
            </Text>
            {insight.periodSummary ? (
              <Text style={styles.trendInsightLine}>
                分时段结论：静息时段(22:00-06:00)均值{' '}
                {insight.periodSummary.rest.average ?? '暂无'} bpm（{insight.periodSummary.rest.status}）；
                活动时段(06:00-22:00)均值 {insight.periodSummary.active.average ?? '暂无'} bpm（
                {insight.periodSummary.active.status}）。
              </Text>
            ) : null}
            {Array.isArray(insight.abnormalSegments) && insight.abnormalSegments.length > 0 ? (
              <Text style={styles.trendInsightLine}>
                异常连续时段：
                {insight.abnormalSegments
                  .map((seg) => {
                    const typeLabel = seg.type === 'high' ? '偏高' : '偏低';
                    const start = new Date(seg.startAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const end = new Date(seg.endAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return `${typeLabel}${seg.durationMin}分钟(${start}-${end}, 均值${seg.average} bpm)`;
                  })
                  .join('；')}
              </Text>
            ) : (
              <Text style={styles.trendInsightLine}>异常连续时段：未发现连续 3 分钟以上异常区间。</Text>
            )}
          </>
        ) : null}
      </View>
    );
  };

  const stripMarkdownInline = (line) =>
    String(line || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();

  const renderAdviceText = () => {
    const lines = normalizedAssistantAdvice
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    return lines.map((line, idx) => {
      const headingMatch = line.match(/^#{1,6}\s*(.+)$/);
      if (headingMatch) {
        return (
          <Text key={`h-${idx}`} style={styles.assistantAdviceHeading}>
            {stripMarkdownInline(headingMatch[1])}
          </Text>
        );
      }
      const bulletMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) {
        return (
          <Text key={`b-${idx}`} style={styles.assistantAdviceBullet}>
            {`• ${stripMarkdownInline(bulletMatch[1])}`}
          </Text>
        );
      }
      return (
        <Text key={`p-${idx}`} style={styles.assistantAdviceParagraph}>
          {`　　${stripMarkdownInline(line)}`}
        </Text>
      );
    });
  };

  const normalizedAssistantAdvice = sanitizeHealthAdviceText(assistantAdvice || '');
  const sleepStages = report?.trends?.sleepStages;
  const sleepStageChartData = useMemo(() => {
    const labels = sleepStages?.labels || [];
    const deep = sleepStages?.deep || [];
    const rem = sleepStages?.rem || [];
    const light = sleepStages?.light || [];
    return {
      labels,
      legend: ['深睡', 'REM', '浅睡'],
      data: labels.map((_, i) => [
        Number(deep[i] || 0),
        Number(rem[i] || 0),
        Number(light[i] || 0),
      ]),
      barColors: ['#7c83f7', '#98a2ff', '#c3c9ff'],
    };
  }, [sleepStages]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>正在生成报告...</Text>
        </View>
      </View>
    );
  }

  if (!report) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={64} color={theme.colors.textSecondary} />
          <Title style={styles.emptyTitle}>暂无报告数据</Title>
          <Paragraph style={styles.emptyText}>
            请先连接设备并收集健康数据
          </Paragraph>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* 报告类型选择 */}
        <Card style={styles.card}>
          <Card.Content>
            <SegmentedButtons
              value={reportType}
              onValueChange={setReportType}
              buttons={[
                { value: 'week', label: '周报告', labelStyle: styles.segmentLabel },
                { value: 'month', label: '月报告', labelStyle: styles.segmentLabel },
              ]}
            />
            <View style={styles.aiToggleContainer}>
              <Text style={styles.aiToggleLabel}>启用AI深度分析</Text>
              <Switch
                value={useAI}
                onValueChange={setUseAI}
                disabled={loading || aiLoading}
              />
            </View>
            <Paragraph style={styles.userMeta}>
              用户：
              {profile?.name || profile?.email || '未登录 / 本地用户'}
            </Paragraph>
          </Card.Content>
        </Card>

        {/* 健康评分 */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.scoreHeader}>
              <Title style={styles.scoreTitle}>健康评分</Title>
              <Text style={styles.scoreValue}>{report.healthScore}/100</Text>
            </View>
            <ProgressBar
              progress={report.healthScore / 100}
              color={getScoreColor(report.healthScore)}
              style={styles.progressBar}
            />
            <Paragraph style={styles.scoreDescription}>
              {getScoreDescription(report.healthScore)}
            </Paragraph>
          </Card.Content>
        </Card>

        {/* 数据概览 */}
        <Card style={styles.card}>
          <Card.Content>
            <Title style={styles.sectionTitle}>数据概览</Title>
            <View style={styles.overviewGrid}>
              <View style={styles.overviewItem}>
                <Ionicons name="body-outline" size={32} color={theme.colors.primary} />
                <Text style={styles.overviewValue}>{displayMetricValue(report.heightCm)}</Text>
                <Text style={styles.overviewLabel}>身高 (cm)</Text>
              </View>
              <View style={styles.overviewItem}>
                <Ionicons name="barbell-outline" size={32} color={theme.colors.primary} />
                <Text style={styles.overviewValue}>{displayMetricValue(report.weightKg)}</Text>
                <Text style={styles.overviewLabel}>体重 (kg)</Text>
              </View>
              <View style={styles.overviewItem}>
                <Ionicons name="speedometer-outline" size={32} color={theme.colors.primary} />
                <Text style={styles.overviewValue}>{displayMetricValue(report.bmi)}</Text>
                <Text style={styles.overviewLabel}>BMI</Text>
              </View>
              <View style={styles.overviewItem}>
                <Ionicons name="heart" size={32} color={theme.colors.error} />
                <Text style={styles.overviewValue}>{report.avgHeartRate}</Text>
                <Text style={styles.overviewLabel}>平均心率 (bpm)</Text>
              </View>
              <View style={styles.overviewItem}>
                <Ionicons name="water" size={32} color={theme.colors.secondary} />
                <Text style={styles.overviewValue}>{report.avgBloodGlucose}</Text>
                <Text style={styles.overviewLabel}>平均血糖 (mmol/L)</Text>
              </View>
              <View style={styles.overviewItem}>
                <Ionicons name="moon" size={32} color={theme.colors.accent} />
                <Text style={styles.overviewValue}>{report.avgSleep}</Text>
                <Text style={styles.overviewLabel}>平均睡眠 (小时)</Text>
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* 趋势分析 */}
        {report.trends && (
          <>
            <Card style={styles.card}>
              <Card.Content>
                <Title style={styles.sectionTitle}>心率趋势</Title>
                <LineChart
                  data={report.trends.heartRate}
                  width={Math.min(width - 64, 1036)}
                  height={220}
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(231, 76, 60, ${opacity})`,
                  }}
                  bezier
                  style={styles.chart}
                />
                {renderTrendInsight(report.trendInsights?.heartRate, {
                  unit: 'bpm',
                  includeMinuteDetail: true,
                  title: '心率分析',
                })}
              </Card.Content>
            </Card>
            <Card style={styles.card}>
              <Card.Content>
                <Title style={styles.sectionTitle}>血糖趋势</Title>
                <LineChart
                  data={report.trends.bloodGlucose}
                  width={Math.min(width - 64, 1036)}
                  height={220}
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(80, 200, 120, ${opacity})`,
                  }}
                  bezier
                  style={styles.chart}
                />
                {renderTrendInsight(report.trendInsights?.bloodGlucose, {
                  unit: 'mmol/L',
                  title: '血糖分析',
                })}
              </Card.Content>
            </Card>
            <Card style={styles.card}>
              <Card.Content>
                <Title style={styles.sectionTitle}>睡眠趋势</Title>
                <StackedBarChart
                  data={sleepStageChartData}
                  width={Math.min(width - 72, 1028)}
                  height={220}
                  fromZero
                  segments={4}
                  yAxisSuffix="h"
                  formatYLabel={(label) => {
                    const n = Number(label);
                    if (!Number.isFinite(n)) return label;
                    return String(Math.round(n / 2) * 2);
                  }}
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(124, 131, 247, ${opacity})`,
                    barPercentage: 0.56,
                  }}
                  style={styles.sleepChart}
                  hideLegend
                />
                <View style={styles.sleepLegendRow}>
                  <View style={styles.sleepLegendItem}>
                    <View style={[styles.sleepLegendDot, { backgroundColor: '#7c83f7' }]} />
                    <Text style={styles.sleepLegendText}>深睡</Text>
                  </View>
                  <View style={styles.sleepLegendItem}>
                    <View style={[styles.sleepLegendDot, { backgroundColor: '#98a2ff' }]} />
                    <Text style={styles.sleepLegendText}>REM</Text>
                  </View>
                  <View style={styles.sleepLegendItem}>
                    <View style={[styles.sleepLegendDot, { backgroundColor: '#c3c9ff' }]} />
                    <Text style={styles.sleepLegendText}>浅睡</Text>
                  </View>
                </View>
                {renderTrendInsight(report.trendInsights?.sleep, {
                  unit: '小时',
                  title: '睡眠分析',
                })}
              </Card.Content>
            </Card>
          </>
        )}

        {/* AI深度分析 */}
        {report.aiAnalysis && (
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.aiHeader}>
                <Ionicons name="sparkles" size={24} color={theme.colors.primary} />
                <Title style={styles.sectionTitle}>AI深度分析</Title>
              </View>
              <Text style={styles.aiDisclaimer}>{AI_DISCLAIMER_ZH}</Text>
              <Text style={styles.aiAnalysisText}>{report.aiAnalysis}</Text>
            </Card.Content>
          </Card>
        )}

        {/* 健康建议 / 规则简要提示（与 PDF 逻辑一致） */}
        <Card style={styles.card}>
          <Card.Content>
            <Title style={styles.sectionTitle}>
              {assistantAdvice.trim().length > 0
                ? '健康建议（AI 助手个性化建议）'
                : '简要提示（规则引擎）'}
            </Title>
            {normalizedAssistantAdvice.length > 0 ? (
              <>
                <Text style={styles.aiDisclaimer}>{AI_DISCLAIMER_ZH}</Text>
                {renderAdviceText()}
              </>
            ) : (
              <>
                <Paragraph style={styles.adviceHint}>
                  尚未在「AI 助手 › 建议」中生成个性化建议；以下为应用规则生成的简要提示。
                </Paragraph>
                {report.recommendations.map((rec, index) => (
                  <View key={index} style={styles.recommendationItem}>
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={theme.colors.success}
                      style={styles.recommendationIcon}
                    />
                    <Text style={styles.recommendationText}>{rec}</Text>
                  </View>
                ))}
              </>
            )}
          </Card.Content>
        </Card>

        <Paragraph style={styles.reportGeneratedAt}>
          报告数据生成时间：
          {report.generatedAt
            ? new Date(report.generatedAt).toLocaleString('zh-CN')
            : ''}
        </Paragraph>

        {/* 操作按钮 */}
        <View style={styles.actionButtons}>
          <Button
            mode="outlined"
            icon="download"
            onPress={exportReport}
            style={styles.exportButton}
            contentStyle={styles.buttonContent}
          >
            导出报告
          </Button>
          <Button
            mode="contained"
            icon="share"
            onPress={shareReport}
            style={styles.shareButton}
            contentStyle={styles.buttonContent}
          >
            分享报告
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

const getScoreColor = (score) => {
  if (score >= 80) return theme.colors.success;
  if (score >= 60) return theme.colors.warning;
  return theme.colors.error;
};

const getScoreDescription = (score) => {
  if (score >= 80) return '您的健康状况良好，请继续保持！';
  if (score >= 60) return '您的健康状况一般，建议改善生活习惯。';
  return '您的健康状况需要关注，建议咨询医生。';
};

const displayMetricValue = (value) => (value != null ? String(value) : '未填写');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
    maxWidth: 1300,
    width: '100%',
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: theme.spacing.xl * 2,
  },
  segmentLabel: {
    ...textStyles.semi,
    fontSize: 13,
  },
  emptyTitle: {
    ...textStyles.title,
    marginTop: theme.spacing.md,
    color: theme.colors.text,
  },
  emptyText: {
    ...textStyles.body,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      web: {
        shadowColor: theme.shadow.color,
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  scoreTitle: {
    ...textStyles.title,
    fontSize: 18,
  },
  scoreValue: {
    ...textStyles.emphasis,
    fontSize: 32,
    color: theme.colors.primary,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    marginVertical: theme.spacing.sm,
  },
  scoreDescription: {
    ...textStyles.body,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  sectionTitle: {
    ...textStyles.title,
    fontSize: 18,
    marginBottom: theme.spacing.md,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  overviewItem: {
    minWidth: 110,
    alignItems: 'center',
  },
  overviewValue: {
    ...textStyles.emphasis,
    fontSize: 20,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  overviewLabel: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  chart: {
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    alignSelf: 'center',
  },
  sleepChart: {
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    alignSelf: 'center',
    marginLeft: -6,
  },
  trendInsightBox: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceVariant,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  trendInsightTitle: {
    ...textStyles.semi,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  trendInsightLine: {
    ...textStyles.body,
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 2,
  },
  recommendationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  recommendationIcon: {
    marginRight: theme.spacing.sm,
    marginTop: 2,
  },
  recommendationText: {
    ...textStyles.body,
    flex: 1,
    color: theme.colors.text,
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  exportButton: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
  },
  shareButton: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
  },
  buttonContent: {
    paddingVertical: theme.spacing.sm,
  },
  aiToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
  },
  aiToggleLabel: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  aiAnalysisText: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 22,
    textAlign: 'justify',
  },
  aiDisclaimer: {
    ...textStyles.body,
    fontSize: 12,
    color: '#b45309',
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
  },
  assistantAdviceParagraph: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 22,
    textAlign: 'justify',
    marginBottom: theme.spacing.xs,
  },
  assistantAdviceHeading: {
    ...textStyles.title,
    fontSize: 17,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    color: theme.colors.text,
  },
  assistantAdviceBullet: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 22,
    marginBottom: 4,
    paddingLeft: 4,
  },
  sleepLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  sleepLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sleepLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  sleepLegendText: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  adviceHint: {
    ...textStyles.body,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  userMeta: {
    ...textStyles.body,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
  },
  reportGeneratedAt: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
});

