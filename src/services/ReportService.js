import { DeviceService } from './DeviceService';
import { MedicineService } from './MedicineService';
import { AIService } from './AIService';

export class ReportService {
  static async generateReport(type = 'week', useAI = false) {
    try {
      const healthData = await DeviceService.getHealthData();
      const medicines = await MedicineService.getAllMedicines();

      // 计算时间范围
      const now = new Date();
      const startDate = new Date(now);
      if (type === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else {
        startDate.setMonth(startDate.getMonth() - 1);
      }

      // 筛选时间范围内的数据
      const filteredHeartRate = healthData.heartRate.filter(
        (item) => new Date(item.date) >= startDate
      );
      const filteredBloodGlucose = healthData.bloodGlucose.filter(
        (item) => new Date(item.date) >= startDate
      );
      const filteredSleep = healthData.sleep.filter(
        (item) => new Date(item.date) >= startDate
      );

      // 计算平均值
      const avgHeartRate =
        filteredHeartRate.length > 0
          ? Math.round(
              filteredHeartRate.reduce((sum, item) => sum + item.value, 0) /
                filteredHeartRate.length
            )
          : 0;

      const avgBloodGlucose =
        filteredBloodGlucose.length > 0
          ? (
              filteredBloodGlucose.reduce((sum, item) => sum + parseFloat(item.value), 0) /
              filteredBloodGlucose.length
            ).toFixed(1)
          : 0;

      const avgSleep =
        filteredSleep.length > 0
          ? (
              filteredSleep.reduce(
                (sum, item) =>
                  sum +
                  parseFloat(
                    item.totalHours != null ? item.totalHours : item.value != null ? item.value : 0
                  ),
                0
              ) / filteredSleep.length
            ).toFixed(1)
          : 0;

      // 计算健康评分（0-100）
      const healthScore = this.calculateHealthScore({
        heartRate: avgHeartRate,
        bloodGlucose: parseFloat(avgBloodGlucose),
        sleep: parseFloat(avgSleep),
        medicineCount: medicines.length,
      });

      // 生成趋势数据
      const trends = this.generateTrendData(
        filteredHeartRate,
        filteredBloodGlucose,
        filteredSleep,
        type
      );

      // 生成健康建议（优先使用AI，失败则使用规则）
      let recommendations = [];
      let aiAnalysis = null;

      if (useAI) {
        try {
          aiAnalysis = await AIService.generateHealthAnalysis({
            avgHeartRate,
            avgBloodGlucose,
            avgSleep,
            healthScore,
            medicineCount: medicines.length,
          });
          // AI分析作为详细分析，规则建议作为快速建议
          recommendations = this.generateRecommendations({
            heartRate: avgHeartRate,
            bloodGlucose: parseFloat(avgBloodGlucose),
            sleep: parseFloat(avgSleep),
            medicineCount: medicines.length,
          });
        } catch (error) {
          console.warn('AI分析失败，使用规则建议:', error);
          recommendations = this.generateRecommendations({
            heartRate: avgHeartRate,
            bloodGlucose: parseFloat(avgBloodGlucose),
            sleep: parseFloat(avgSleep),
            medicineCount: medicines.length,
          });
        }
      } else {
        recommendations = this.generateRecommendations({
          heartRate: avgHeartRate,
          bloodGlucose: parseFloat(avgBloodGlucose),
          sleep: parseFloat(avgSleep),
          medicineCount: medicines.length,
        });
      }

      return {
        type,
        period: type === 'week' ? '最近一周' : '最近一月',
        avgHeartRate,
        avgBloodGlucose,
        avgSleep,
        healthScore,
        trends,
        recommendations,
        aiAnalysis, // AI生成的详细分析
        medicineCount: medicines.length,
        generatedAt: now.toISOString(),
      };
    } catch (error) {
      console.error('生成报告失败:', error);
      throw error;
    }
  }

  static calculateHealthScore(data) {
    let score = 100;

    // 心率评分（正常范围：60-100 bpm）
    if (data.heartRate < 60 || data.heartRate > 100) {
      score -= 20;
    } else if (data.heartRate < 70 || data.heartRate > 90) {
      score -= 10;
    }

    // 血糖评分（正常范围：3.9-6.1 mmol/L）
    if (data.bloodGlucose < 3.9 || data.bloodGlucose > 6.1) {
      score -= 20;
    } else if (data.bloodGlucose < 4.5 || data.bloodGlucose > 5.5) {
      score -= 10;
    }

    // 睡眠评分（正常范围：7-9小时）
    if (data.sleep < 6 || data.sleep > 10) {
      score -= 20;
    } else if (data.sleep < 7 || data.sleep > 9) {
      score -= 10;
    }

    // 服药依从性加分
    if (data.medicineCount > 0) {
      score += Math.min(data.medicineCount * 2, 10);
    }

    return Math.max(0, Math.min(100, score));
  }

  static generateTrendData(heartRate, bloodGlucose, sleep, type) {
    // 按日期分组数据
    const days = type === 'week' ? 7 : 30;
    const labels = [];
    const heartRateData = [];
    const bloodGlucoseData = [];
    const sleepData = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      labels.push(dateStr);

      // 计算当天的平均值
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const dayHeartRate = heartRate.filter(
        (item) =>
          new Date(item.date) >= dayStart && new Date(item.date) <= dayEnd
      );
      const dayBloodGlucose = bloodGlucose.filter(
        (item) =>
          new Date(item.date) >= dayStart && new Date(item.date) <= dayEnd
      );
      const daySleep = sleep.find(
        (item) =>
          new Date(item.date) >= dayStart && new Date(item.date) <= dayEnd
      );

      heartRateData.push(
        dayHeartRate.length > 0
          ? Math.round(
              dayHeartRate.reduce((sum, item) => sum + item.value, 0) /
                dayHeartRate.length
            )
          : 0
      );

      bloodGlucoseData.push(
        dayBloodGlucose.length > 0
          ? parseFloat(
              (
                dayBloodGlucose.reduce(
                  (sum, item) => sum + parseFloat(item.value),
                  0
                ) / dayBloodGlucose.length
              ).toFixed(1)
            )
          : 0
      );

      sleepData.push(
        daySleep
          ? parseFloat(
              daySleep.totalHours != null ? daySleep.totalHours : daySleep.value != null ? daySleep.value : 0
            )
          : 0
      );
    }

      return {
        labels,
        heartRate: {
          labels,
          datasets: [{ data: heartRateData }],
        },
        bloodGlucose: {
          labels,
          datasets: [{ data: bloodGlucoseData }],
        },
        sleep: {
          labels,
          datasets: [{ data: sleepData }],
        },
      };
  }

  static generateRecommendations(data) {
    const recommendations = [];

    if (data.heartRate < 60) {
      recommendations.push('您的心率偏低，建议适当增加运动量');
    } else if (data.heartRate > 100) {
      recommendations.push('您的心率偏高，建议减少剧烈运动，注意休息');
    }

    if (data.bloodGlucose < 3.9) {
      recommendations.push('您的血糖偏低，建议适当补充糖分');
    } else if (data.bloodGlucose > 6.1) {
      recommendations.push('您的血糖偏高，建议控制饮食，减少糖分摄入');
    }

    if (data.sleep < 7) {
      recommendations.push('您的睡眠时间不足，建议保证每天7-9小时的睡眠');
    } else if (data.sleep > 9) {
      recommendations.push('您的睡眠时间较长，建议保持规律的作息');
    }

    if (data.medicineCount > 0) {
      recommendations.push('请按时服药，保持良好的服药习惯');
    }

    if (recommendations.length === 0) {
      recommendations.push('您的健康状况良好，请继续保持！');
      recommendations.push('建议定期进行健康检查');
    }

    return recommendations;
  }
}

