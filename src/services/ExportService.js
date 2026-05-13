import { DeviceService } from './DeviceService';
import { MedicineService } from './MedicineService';
import { ReportService } from './ReportService';
import { AuthService } from './AuthService';
import { AIService } from './AIService';
import { PersonalizedAdviceCache } from './PersonalizedAdviceCache';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import { Platform, Share } from 'react-native';
import { buildHealthReportPdfHtml } from '../utils/reportPdfHtml';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** UTF-8 BOM：便于 Excel（尤其英文区域 Windows）将 CSV 识别为 UTF-8，避免中文乱码 */
const UTF8_BOM = '\uFEFF';

function ensureCsvUtf8Bom(content) {
  const s = typeof content === 'string' ? content : '';
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) return s;
  return UTF8_BOM + s;
}

/** 健康报告 PDF：健康报告-2026年5月6日11时2分.pdf（与导出时刻一致，本地时区） */
function buildHealthReportPdfFilename(at = new Date()) {
  const y = at.getFullYear();
  const m = at.getMonth() + 1;
  const d = at.getDate();
  const h = at.getHours();
  const min = at.getMinutes();
  return `健康报告-${y}年${m}月${d}日${h}时${min}分.pdf`;
}

/**
 * 数据导出服务
 * 支持导出健康数据、药品信息、报告等为CSV、JSON格式
 */
export class ExportService {
  static async ensurePersonalizedAdvice() {
    try {
      const cached = await PersonalizedAdviceCache.get();
      if (cached?.text && cached.text.trim().length > 0) {
        return cached.text.trim();
      }

      const healthData = await DeviceService.getHealthDataForStorage();
      const medicines = await MedicineService.getAllMedicines();
      const userData = {
        heartRate: healthData?.heartRate || [],
        bloodGlucose: healthData?.bloodGlucose || [],
        sleep: healthData?.sleep || [],
        medicines: medicines || [],
      };
      const text = await AIService.generatePersonalizedAdvice(userData);
      const trimmed = (text || '').trim();
      if (trimmed) await PersonalizedAdviceCache.set(trimmed);
      return trimmed;
    } catch (e) {
      console.warn('自动生成个性化建议失败:', e);
      return '';
    }
  }

  /**
   * 导出服药记录（打卡/漏服/稍后）为 CSV
   */
  static async exportIntakeLogsToCSV() {
    try {
      const logs = await MedicineService.getIntakeLogs();
      let csv = '时间,药品ID,提醒ID,动作,计划时间,来源,稍后分钟\n';
      logs.forEach((l) => {
        const at = l.at ? new Date(l.at).toLocaleString('zh-CN') : '';
        csv += `"${at}","${l.medicineId || ''}","${l.reminderId || ''}","${l.action || ''}","${l.scheduledAt || ''}","${l.source || ''}","${l.snoozeMinutes || ''}"\n`;
      });
      return csv;
    } catch (error) {
      console.error('导出服药记录失败:', error);
      throw error;
    }
  }

  /**
   * 导出服药记录（完整流程）
   */
  static async exportIntakeLogs(format = 'csv') {
    try {
      let content, filename, mimeType;
      if (format === 'csv') {
        content = await this.exportIntakeLogsToCSV();
        filename = `服药记录_${new Date().toISOString().split('T')[0]}.csv`;
        mimeType = 'text/csv';
      } else if (format === 'json') {
        content = JSON.stringify(await MedicineService.getIntakeLogs(), null, 2);
        filename = `服药记录_${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
      } else {
        throw new Error('不支持的格式');
      }
      return await this.shareFile(content, filename, mimeType);
    } catch (error) {
      console.error('导出服药记录失败:', error);
      throw error;
    }
  }
  /**
   * 导出健康数据为CSV格式
   */
  static async exportHealthDataToCSV() {
    try {
      const healthData = await DeviceService.getHealthData();
      
      // 构建CSV内容
      let csvContent = '日期,时间,类型,数值,单位\n';
      
      // 导出心率数据
      healthData.heartRate.forEach(item => {
        const date = new Date(item.date);
        csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},心率,${item.value},bpm\n`;
      });
      
      // 导出血糖数据
      healthData.bloodGlucose.forEach(item => {
        const date = new Date(item.date);
        csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},血糖,${item.value},mmol/L\n`;
      });
      
      // 导出睡眠数据
      healthData.sleep.forEach(item => {
        const date = new Date(item.date);
        const total = item.totalHours != null ? item.totalHours : item.value;
        const deep = item.deepHours != null ? item.deepHours : '';
        const light = item.lightHours != null ? item.lightHours : '';
        const rem = item.remHours != null ? item.remHours : '';
        const awake = item.awakeHours != null ? item.awakeHours : '';
        csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},睡眠总时长,${total},小时\n`;
        if (deep !== '') {
          csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},深睡,${deep},小时\n`;
          csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},浅睡,${light},小时\n`;
          csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},REM,${rem},小时\n`;
          csvContent += `${date.toLocaleDateString('zh-CN')},${date.toLocaleTimeString('zh-CN')},清醒,${awake},小时\n`;
        }
      });
      
      return csvContent;
    } catch (error) {
      console.error('导出健康数据失败:', error);
      throw error;
    }
  }

  /**
   * 导出药品信息为CSV格式
   */
  static async exportMedicinesToCSV() {
    try {
      const medicines = await MedicineService.getAllMedicines();
      
      // 构建CSV内容
      let csvContent = '药品名称,服用剂量,服用频率,添加时间\n';
      
      medicines.forEach(medicine => {
        const date = new Date(medicine.createdAt);
        csvContent += `"${medicine.name}","${medicine.dosage}","${medicine.frequency}","${date.toLocaleString('zh-CN')}"\n`;
      });
      
      return csvContent;
    } catch (error) {
      console.error('导出药品信息失败:', error);
      throw error;
    }
  }

  /**
   * 导出所有数据为JSON格式
   */
  static async exportAllDataToJSON() {
    try {
      const healthData = await DeviceService.getHealthData();
      const medicines = await MedicineService.getAllMedicines();
      const devices = await DeviceService.getConnectedDevices();
      
      const exportData = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        healthData,
        medicines,
        devices,
      };
      
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('导出所有数据失败:', error);
      throw error;
    }
  }

  /**
   * 导出健康报告为文本格式
   */
  static async exportReportToText(reportType = 'week', useAI = false) {
    try {
      const report = await ReportService.generateReport(reportType, useAI);
      const assistantAdvice = await this.ensurePersonalizedAdvice();
      const formatMetric = (value, unit) => (value != null ? `${value} ${unit}` : '未填写');
      const formatBmi = (value) => (value != null ? `${value}` : '未填写');
      
      let text = `健康报告 - ${report.period}\n`;
      text += `生成时间: ${new Date(report.generatedAt).toLocaleString('zh-CN')}\n\n`;
      text += `=== 数据概览 ===\n`;
      text += `身高: ${formatMetric(report.heightCm, 'cm')}\n`;
      text += `体重: ${formatMetric(report.weightKg, 'kg')}\n`;
      text += `BMI: ${formatBmi(report.bmi)}\n`;
      text += `平均心率: ${report.avgHeartRate} bpm\n`;
      text += `平均血糖: ${report.avgBloodGlucose} mmol/L\n`;
      text += `平均睡眠: ${report.avgSleep} 小时\n`;
      const ss = report.sleepStages || {};
      text += `平均深睡: ${ss.deep != null ? `${ss.deep} 小时` : '暂无数据'}\n`;
      text += `平均浅睡: ${ss.light != null ? `${ss.light} 小时` : '暂无数据'}\n`;
      text += `平均 REM: ${ss.rem != null ? `${ss.rem} 小时` : '暂无数据'}\n`;
      text += `平均清醒: ${ss.awake != null ? `${ss.awake} 小时` : '暂无数据'}\n`;
      text += `健康评分: ${report.healthScore}/100\n`;
      text += `管理药品数: ${report.medicineCount}\n\n`;
      
      text += `=== 健康建议 ===\n`;
      if (assistantAdvice) {
        text += `${assistantAdvice}\n`;
      } else {
        report.recommendations.forEach((rec, index) => {
          text += `${index + 1}. ${rec}\n`;
        });
      }
      
      return text;
    } catch (error) {
      console.error('导出报告失败:', error);
      throw error;
    }
  }

  /**
   * 导出健康报告为 PDF（HTML → expo-print）
   * @param {string} reportType
   * @param {{ useAI?: boolean }} options
   */
  static async exportReportToPdf(reportType = 'week', options = {}) {
    const { useAI = false } = options;
    const profile = await AuthService.getProfile();
    const displayName =
      profile?.name ||
      profile?.email ||
      '用户';

    const reportPromise = ReportService.generateReport(reportType, useAI);

    const assistantAdvicePromise = this.ensurePersonalizedAdvice();

    const [report, assistantAdvice] = await Promise.all([
      reportPromise,
      assistantAdvicePromise,
    ]);

    const exportedAt = new Date();
    const generatedAtDisplay = exportedAt.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const filename = buildHealthReportPdfFilename(exportedAt);
    const html = buildHealthReportPdfHtml({
      displayName,
      report,
      assistantAdvice,
      generatedAtDisplay,
      reportTitle: filename.replace(/\.pdf$/i, ''),
    });

    if (Platform.OS === 'web') {
      try {
        const reportWindowPath = `/report-print/${encodeURIComponent(
          filename.replace(/\.pdf$/i, '')
        )}`;
        const w =
          typeof globalThis !== 'undefined' && globalThis.window
            ? globalThis.window.open(reportWindowPath, '_blank')
            : null;
        if (w && w.document) {
          w.document.open();
          w.document.write(html);
          w.document.close();
          w.document.title = filename.replace(/\.pdf$/i, '');
          w.focus();
          w.print();
          return {
            success: true,
            message: '请在打印对话框中选择「另存为 PDF」保存报告',
          };
        }
      } catch (e) {
        console.error('Web 导出 PDF 失败:', e);
      }
      return {
        success: false,
        message: '无法打开打印窗口，请允许弹出窗口后重试',
      };
    }

    const result = await Print.printToFileAsync({
      html,
      base64: true,
      width: 612,
      height: 792,
    });

    const rawBase64 = result.base64;
    if (rawBase64 && typeof rawBase64 === 'string') {
      return await this.shareBase64File(rawBase64, filename, 'application/pdf');
    }

    if (result.uri) {
      await Share.share({
        url: result.uri,
        title: filename,
        message: `分享文件: ${filename}`,
      });
      return { success: true, fileUri: result.uri, message: '已生成 PDF，可通过分享保存' };
    }

    throw new Error('无法生成 PDF 文件');
  }

  /**
   * 保存文件到设备（移动端）
   */
  static async saveFileToDevice(content, filename, mimeType = 'text/plain') {
    try {
      if (Platform.OS === 'web') {
        // Web平台：下载文件
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return { success: true, message: '文件已下载' };
      } else {
        // 移动端：保存到文档目录
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        return { success: true, fileUri, message: '文件已保存' };
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      throw error;
    }
  }

  /**
   * 分享二进制文件（内容已 base64 编码，适用于 xlsx 等）
   */
  static async shareBase64File(base64Content, filename, mimeType = MIME_XLSX) {
    try {
      if (Platform.OS === 'web') {
        const binary = atob(base64Content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return { success: true, message: '模板已下载' };
      }

      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, base64Content, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Share.share({
        url: fileUri,
        title: filename,
        message: `分享文件: ${filename}`,
      });
      return { success: true, fileUri, message: '已生成文件，可在分享面板中保存' };
    } catch (error) {
      console.error('分享二进制文件失败:', error);
      throw error;
    }
  }

  /**
   * 分享文件（移动端）
   */
  static async shareFile(content, filename, mimeType = 'text/plain') {
    try {
      const isCsv =
        mimeType === 'text/csv' ||
        (filename && String(filename).toLowerCase().endsWith('.csv'));
      const payload = isCsv ? ensureCsvUtf8Bom(content) : content;

      if (Platform.OS === 'web') {
        // Web平台：使用下载
        return await this.saveFileToDevice(payload, filename, mimeType);
      } else {
        // 移动端：先保存文件，然后分享
        const result = await this.saveFileToDevice(payload, filename, mimeType);
        if (result.success && result.fileUri) {
          await Share.share({
            url: result.fileUri,
            title: filename,
            message: `分享文件: ${filename}`,
          });
        }
        return result;
      }
    } catch (error) {
      console.error('分享文件失败:', error);
      throw error;
    }
  }

  /**
   * 导出健康数据（完整流程）
   */
  static async exportHealthData(format = 'csv') {
    try {
      let content, filename, mimeType;
      
      if (format === 'csv') {
        content = await this.exportHealthDataToCSV();
        filename = `健康数据_${new Date().toISOString().split('T')[0]}.csv`;
        mimeType = 'text/csv';
      } else if (format === 'json') {
        content = await this.exportAllDataToJSON();
        filename = `健康数据_${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
      } else {
        throw new Error('不支持的格式');
      }
      
      return await this.shareFile(content, filename, mimeType);
    } catch (error) {
      console.error('导出健康数据失败:', error);
      throw error;
    }
  }

  /**
   * 导出药品信息（完整流程）
   */
  static async exportMedicines(format = 'csv') {
    try {
      let content, filename, mimeType;
      
      if (format === 'csv') {
        content = await this.exportMedicinesToCSV();
        filename = `药品信息_${new Date().toISOString().split('T')[0]}.csv`;
        mimeType = 'text/csv';
      } else if (format === 'json') {
        content = await this.exportAllDataToJSON();
        filename = `药品信息_${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
      } else {
        throw new Error('不支持的格式');
      }
      
      return await this.shareFile(content, filename, mimeType);
    } catch (error) {
      console.error('导出药品信息失败:', error);
      throw error;
    }
  }

  /**
   * 导出健康报告（完整流程）
   * @param {string} reportType
   * @param {'pdf'|'txt'} format 默认 pdf
   * @param {{ useAI?: boolean }} exportOptions
   */
  static async exportReport(reportType = 'week', format = 'pdf', exportOptions = {}) {
    try {
      const { useAI = false } = exportOptions;

      if (format === 'pdf') {
        return await this.exportReportToPdf(reportType, { useAI });
      }

      let content, filename, mimeType;

      if (format === 'txt') {
        content = await this.exportReportToText(reportType, useAI);
        filename = `健康报告_${reportType === 'week' ? '周' : '月'}_${new Date().toISOString().split('T')[0]}.txt`;
        mimeType = 'text/plain';
      } else {
        throw new Error('不支持的格式');
      }

      return await this.shareFile(content, filename, mimeType);
    } catch (error) {
      console.error('导出报告失败:', error);
      throw error;
    }
  }
}

