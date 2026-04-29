import { DeviceService } from './DeviceService';
import { MedicineService } from './MedicineService';
import { ReportService } from './ReportService';
import * as FileSystem from 'expo-file-system';
import { Platform, Share } from 'react-native';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 数据导出服务
 * 支持导出健康数据、药品信息、报告等为CSV、JSON格式
 */
export class ExportService {
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
  static async exportReportToText(reportType = 'week') {
    try {
      const report = await ReportService.generateReport(reportType);
      
      let text = `健康报告 - ${report.period}\n`;
      text += `生成时间: ${new Date(report.generatedAt).toLocaleString('zh-CN')}\n\n`;
      text += `=== 数据概览 ===\n`;
      text += `平均心率: ${report.avgHeartRate} bpm\n`;
      text += `平均血糖: ${report.avgBloodGlucose} mmol/L\n`;
      text += `平均睡眠: ${report.avgSleep} 小时\n`;
      text += `健康评分: ${report.healthScore}/100\n`;
      text += `管理药品数: ${report.medicineCount}\n\n`;
      
      text += `=== 健康建议 ===\n`;
      report.recommendations.forEach((rec, index) => {
        text += `${index + 1}. ${rec}\n`;
      });
      
      return text;
    } catch (error) {
      console.error('导出报告失败:', error);
      throw error;
    }
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
      if (Platform.OS === 'web') {
        // Web平台：使用下载
        return await this.saveFileToDevice(content, filename, mimeType);
      } else {
        // 移动端：先保存文件，然后分享
        const result = await this.saveFileToDevice(content, filename, mimeType);
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
   */
  static async exportReport(reportType = 'week', format = 'txt') {
    try {
      let content, filename, mimeType;
      
      if (format === 'txt') {
        content = await this.exportReportToText(reportType);
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

