import React, { useState, useEffect, useCallback } from 'react';
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
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { theme, textStyles } from '../theme';
import { ReportService } from '../services/ReportService';
import { ExportService } from '../services/ExportService';
import { AuthService } from '../services/AuthService';
import { PersonalizedAdviceCache } from '../services/PersonalizedAdviceCache';
import { AI_DISCLAIMER_ZH } from '../constants/aiDisclaimer';
import { Alert } from 'react-native';

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
        (() => {
          const ss = report.sleepStages || {};
          const line = (label, v) =>
            `${label}: ${v != null ? `${v} 小时` : '暂无数据'}`;
          return (
            `${line('平均深睡', ss.deep)}\n` +
            `${line('平均浅睡', ss.light)}\n` +
            `${line('平均 REM', ss.rem)}\n` +
            `${line('平均清醒', ss.awake)}\n`
          );
        })() +
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
            <Paragraph style={styles.sleepStagesCaption}>
              睡眠结构（夜间平均，仅统计含分项记录的日期）
            </Paragraph>
            <View style={styles.sleepStagesGrid}>
              {[
                { label: '深睡', key: 'deep', icon: 'moon', color: '#6c3483' },
                {
                  label: '浅睡',
                  key: 'light',
                  icon: 'partly-sunny-outline',
                  color: '#2874a6',
                },
                { label: 'REM', key: 'rem', icon: 'pulse-outline', color: '#1e8449' },
                { label: '清醒', key: 'awake', icon: 'eye-outline', color: '#b7950b' },
              ].map(({ label, key, icon, color }) => {
                const v = report.sleepStages?.[key];
                return (
                  <View key={key} style={styles.sleepStageItem}>
                    <Ionicons name={icon} size={28} color={color} />
                    <Text style={styles.overviewValue}>{v != null ? v : '—'}</Text>
                    <Text style={styles.overviewLabel}>{label} (小时)</Text>
                  </View>
                );
              })}
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
                  width={width - 64}
                  height={220}
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(231, 76, 60, ${opacity})`,
                  }}
                  bezier
                  style={styles.chart}
                />
              </Card.Content>
            </Card>
            <Card style={styles.card}>
              <Card.Content>
                <Title style={styles.sectionTitle}>血糖趋势</Title>
                <LineChart
                  data={report.trends.bloodGlucose}
                  width={width - 64}
                  height={220}
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(80, 200, 120, ${opacity})`,
                  }}
                  bezier
                  style={styles.chart}
                />
              </Card.Content>
            </Card>
            <Card style={styles.card}>
              <Card.Content>
                <Title style={styles.sectionTitle}>睡眠趋势</Title>
                <LineChart
                  data={report.trends.sleep}
                  width={width - 64}
                  height={220}
                  chartConfig={{
                    ...chartConfig,
                    color: (opacity = 1) => `rgba(155, 89, 182, ${opacity})`,
                  }}
                  bezier
                  style={styles.chart}
                />
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
            {assistantAdvice.trim().length > 0 ? (
              <>
                <Text style={styles.aiDisclaimer}>{AI_DISCLAIMER_ZH}</Text>
                <Text style={styles.assistantAdviceText}>{assistantAdvice.trim()}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
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
    justifyContent: 'space-around',
    marginTop: theme.spacing.md,
  },
  overviewItem: {
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
  sleepStagesCaption: {
    ...textStyles.body,
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.md,
  },
  sleepStagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
  },
  sleepStageItem: {
    width: '48%',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  chart: {
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
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
  assistantAdviceText: {
    ...textStyles.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 22,
    textAlign: 'justify',
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

