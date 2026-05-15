import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { BAIDU_OCR_CONFIG } from '../config/baiduOCR';
import { WEB_PROXY_CONFIG } from '../config/webProxy';
import { SecureStorage } from '../utils/secureStorage';
import { MedicineDBService } from './MedicineDBService';
import { AIService } from './AIService';

const MED_GUIDE_CACHE_PREFIX = '@medicine_guide_cache:';
const MED_GUIDE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

/**
 * 百度OCR服务
 * 负责处理图片识别、Token管理等
 */
export class OCRService {
  static normalizeOcrText(text) {
    const s = String(text || '');
    if (!s) return '';
    return s
      .replace(/[，、]/g, ',')
      .replace(/[：]/g, ':')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[【]/g, '[')
      .replace(/[】]/g, ']')
      .replace(/([0-9])O(?=[0-9mgMG])/g, '$10')
      .replace(/([0-9])I(?=[0-9mgMG])/g, '$11')
      .replace(/([A-Za-z])0([A-Za-z])/g, '$1O$2')
      .replace(/([A-Za-z])1([A-Za-z])/g, '$1I$2')
      .replace(/\s+/g, ' ')
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();
  }

  static buildNameCandidatesFromLines(lines = []) {
    const suffixPattern = /[\u4e00-\u9fa5A-Za-z0-9·\-]{2,30}(片|胶囊|颗粒|滴丸|丸|散|口服液|糖浆|注射液|凝胶|喷雾剂|乳膏|贴膏)$/;
    const prefixPattern = /^(复方|阿莫西林|布洛芬|头孢|氯雷他定|对乙酰氨基酚|维生素|银黄|板蓝根)/;
    const out = [];
    const seen = new Set();
    for (const raw of lines) {
      const line = this.normalizeOcrText(raw);
      if (!line) continue;
      const parts = line
        .split(/[\s,;；、]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        const p = part.replace(/[()（）\[\]【】]/g, '');
        if (!p) continue;
        if (suffixPattern.test(p) || (prefixPattern.test(p) && p.length >= 3 && p.length <= 18)) {
          if (!seen.has(p)) {
            seen.add(p);
            out.push(p);
          }
        }
      }
    }
    return out.slice(0, 8);
  }

  static async getCachedMedicineGuide(name) {
    try {
      const key = `${MED_GUIDE_CACHE_PREFIX}${String(name || '').trim()}`;
      const cached = await SecureStorage.getItem(key);
      if (!cached || !cached.cachedAt || !cached.data) return null;
      if (Date.now() - cached.cachedAt > MED_GUIDE_CACHE_TTL_MS) return null;
      return cached.data;
    } catch {
      return null;
    }
  }

  static async cacheMedicineGuide(name, data) {
    try {
      const key = `${MED_GUIDE_CACHE_PREFIX}${String(name || '').trim()}`;
      await SecureStorage.setItem(key, { cachedAt: Date.now(), data });
    } catch {
      // ignore
    }
  }

  /**
   * 判断 AI 生成的药品说明是否有效（非兜底提示）
   * - 统计 7 个主要字段中非空的数量，至少 2 个才保存/读取缓存
   */
  static isValidMedicineGuide(guide) {
    if (!guide || typeof guide !== 'object') return false;
    const keys = ['indication', 'usage', 'contraindication', 'precautions', 'sideEffects', 'interactions', 'storage'];
    const filled = keys.reduce((n, k) => (guide[k] && String(guide[k]).trim() ? n + 1 : n), 0);
    return filled >= 2;
  }
  /**
   * 获取Access Token
   * 百度OCR需要先获取token才能调用API
   */
  static async getAccessToken() {
    try {
      // 先检查缓存的token
      const cachedToken = await this.getCachedToken();
      if (cachedToken) {
        console.log('使用缓存的Access Token');
        return cachedToken;
      }

      // 如果没有缓存或已过期，重新获取
      console.log('重新获取Access Token');
      // Web 端走本地代理，避免 CORS
      const url =
        Platform.OS === 'web'
          ? `${WEB_PROXY_CONFIG.BASE_URL}/api/baidu/token?apiKey=${encodeURIComponent(
              BAIDU_OCR_CONFIG.API_KEY
            )}&secretKey=${encodeURIComponent(BAIDU_OCR_CONFIG.SECRET_KEY)}`
          : `${BAIDU_OCR_CONFIG.TOKEN_URL}?grant_type=client_credentials&client_id=${BAIDU_OCR_CONFIG.API_KEY}&client_secret=${BAIDU_OCR_CONFIG.SECRET_KEY}`;
      
      console.log('请求Token URL:', Platform.OS === 'web' ? url : BAIDU_OCR_CONFIG.TOKEN_URL);
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (fetchError) {
        // 捕获网络错误（包括CORS错误）
        console.error('网络请求失败:', fetchError);
        if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
          throw new Error('网络连接失败: 无法访问百度OCR服务器。请检查网络连接或使用VPN/代理。如果是在Web浏览器中，可能需要通过后端代理服务器访问。');
        } else if (fetchError.message.includes('CORS')) {
          throw new Error('跨域请求被阻止: 浏览器安全策略阻止了请求。建议使用移动端应用或配置后端代理服务器。');
        } else {
          throw new Error(`网络请求失败: ${fetchError.message}`);
        }
      }

      console.log('Token API响应状态:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token API响应错误:', errorText);
        throw new Error(`获取Token失败: HTTP ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Token API返回数据:', data);
      
      if (data.error) {
        throw new Error(`获取Token失败: ${data.error_description || data.error} (错误: ${data.error})`);
      }

      if (!data.access_token) {
        throw new Error('获取Token失败: 响应中未包含access_token');
      }

      const token = data.access_token;
      const expiresIn = data.expires_in || BAIDU_OCR_CONFIG.TOKEN_EXPIRE_TIME;

      // 缓存token
      await this.cacheToken(token, expiresIn);
      console.log('Token获取并缓存成功');

      return token;
    } catch (error) {
      console.error('获取Access Token失败详情:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      throw error;
    }
  }

  /**
   * 缓存Token
   */
  static async cacheToken(token, expiresIn) {
    try {
      const expireTime = Date.now() + (expiresIn - 300) * 1000; // 提前5分钟过期
      await SecureStorage.setItem(
        BAIDU_OCR_CONFIG.TOKEN_CACHE_KEY,
        {
          token,
          expireTime,
        }
      );
    } catch (error) {
      console.error('缓存Token失败:', error);
    }
  }

  /**
   * 获取缓存的Token
   */
  static async getCachedToken() {
    try {
      const cached = await SecureStorage.getItem(BAIDU_OCR_CONFIG.TOKEN_CACHE_KEY);
      if (!cached) {
        return null;
      }

      const { token, expireTime } = cached;
      
      // 检查是否过期
      if (Date.now() >= expireTime) {
        await SecureStorage.removeItem(BAIDU_OCR_CONFIG.TOKEN_CACHE_KEY);
        return null;
      }

      return token;
    } catch (error) {
      console.error('获取缓存Token失败:', error);
      return null;
    }
  }

  /**
   * 将图片URI转换为base64
   */
  static async imageToBase64(imageUri) {
    try {
      // Web平台使用fetch读取
      if (Platform.OS === 'web') {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1]; // 移除data:image/...;base64,前缀
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      // 移动端使用FileSystem读取
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      return base64;
    } catch (error) {
      console.error('图片转base64失败:', error);
      throw new Error('图片处理失败，请重试');
    }
  }

  /**
   * 调用百度OCR API识别文字
   */
  static async recognizeText(imageUri) {
    try {
      console.log('开始OCR识别流程...');
      // 2. 将图片转换为base64
      console.log('步骤2: 转换图片为base64');
      const base64Image = await this.imageToBase64(imageUri);
      console.log('图片转换成功，base64长度:', base64Image.length);

      // Web：走代理（代理内部会获取 token + 调 OCR），避免 CORS
      if (Platform.OS === 'web') {
        console.log('步骤3(Web): 调用本地代理 OCR');
        const proxyUrl = `${WEB_PROXY_CONFIG.BASE_URL}/api/baidu/ocr`;
        if (!base64Image) {
          throw new Error('图片处理失败：未获取到 base64 数据');
        }
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: BAIDU_OCR_CONFIG.API_KEY,
            secretKey: BAIDU_OCR_CONFIG.SECRET_KEY,
            imageBase64: base64Image,
            ocrUrl: BAIDU_OCR_CONFIG.OCR_URL,
          }),
        });
        const result = await response.json();
        console.log('代理 OCR 返回结果:', result);

        if (result.error_code) {
          const errorMsg = result.error_msg || '未知错误';
          throw new Error(`OCR识别失败 (错误码: ${result.error_code}): ${errorMsg}`);
        }
        if (!result.words_result) {
          // token 获取失败等情况，Baidu 会返回 error / error_description
          if (result.error) {
            throw new Error(`OCR识别失败: ${result.error_description || result.error}`);
          }
        }
        return result;
      }

      // Native：直连百度 OCR
      console.log('步骤1: 获取Access Token');
      const accessToken = await this.getAccessToken();
      console.log('Access Token获取成功');

      console.log('步骤3(Native): 调用OCR API');
      const url = `${BAIDU_OCR_CONFIG.OCR_URL}?access_token=${accessToken}`;
      const formData = new URLSearchParams();
      formData.append('image', base64Image);

      console.log('发送OCR请求到:', url);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      console.log('OCR API响应状态:', response.status, response.statusText);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('OCR API响应错误:', errorText);
        throw new Error(`OCR识别失败: HTTP ${response.status} - ${response.statusText}`);
      }

      const result = await response.json();
      console.log('OCR API返回结果:', result);
      if (result.error_code) {
        const errorMsg = result.error_msg || '未知错误';
        console.error('OCR API返回错误:', result.error_code, errorMsg);
        throw new Error(`OCR识别失败 (错误码: ${result.error_code}): ${errorMsg}`);
      }
      return result;
    } catch (error) {
      console.error('OCR识别错误详情:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      throw error;
    }
  }

  /**
   * 从OCR结果中提取药品信息
   * 使用正则表达式和关键词匹配来提取药品名称、剂量、频率等信息
   */
  static extractMedicineInfo(ocrResult) {
    try {
      if (!ocrResult.words_result || ocrResult.words_result.length === 0) {
        return {
          name: '',
          dosage: '',
          frequency: '',
          rawText: '',
          nameCandidates: [],
          ocrConfidenceHints: null,
        };
      }

      // 合并所有识别的文字
      const lines = ocrResult.words_result
        .map((item) => this.normalizeOcrText(item.words))
        .filter(Boolean);
      const allText = lines.join('\n');
      const normalizedFlatText = this.normalizeOcrText(lines.join(' '));

      // 提取药品名称（通常在开头，包含"片"、"胶囊"、"颗粒"等）
      const namePatterns = [
        /([\u4e00-\u9fa5A-Za-z0-9·\-]{2,30}(?:片|胶囊|颗粒|滴丸|丸|散|口服液|糖浆|注射液|凝胶|喷雾剂|乳膏|贴膏))/,
        /([\u4e00-\u9fa5A-Za-z0-9·\-]{2,22}(?:缓释|控释|肠溶)?(?:片|胶囊|颗粒))/,
      ];

      let medicineName = '';
      for (const pattern of namePatterns) {
        const match = normalizedFlatText.match(pattern);
        if (match && match[1]) {
          medicineName = match[1].trim();
          break;
        }
      }
      const nameCandidates = this.buildNameCandidatesFromLines(lines);
      if (!medicineName && nameCandidates.length > 0) {
        medicineName = nameCandidates[0];
      }

      // 提取剂量（包含"每次"、"一次"、"1片"、"2粒"等）
      const dosagePatterns = [
        /每次\s*([0-9]+(?:\.[0-9]+)?)\s*(?:片|粒|粒|毫升|ml|mg|g)/i,
        /一次\s*([0-9]+(?:\.[0-9]+)?)\s*(?:片|粒|粒|毫升|ml|mg|g)/i,
        /([0-9]+(?:\.[0-9]+)?)\s*(?:片|粒|粒|毫升|ml|mg|g)\s*\/\s*次/i,
        /([0-9]+(?:\.[0-9]+)?)\s*(?:片|粒|粒|毫升|ml|mg|g)/,
      ];

      let dosage = '';
      for (const pattern of dosagePatterns) {
        const match = normalizedFlatText.match(pattern);
        if (match) {
          const unit = match[0].match(/(片|粒|毫升|ml|mg|g)/i)?.[0] || '片';
          dosage = `每次${match[1]}${unit}`;
          break;
        }
      }

      // 提取频率（包含"每日"、"每天"、"一日"、"每"等）
      const frequencyPatterns = [
        /(?:每日|每天|一日)\s*(\d+)\s*次/i,
        /每\s*(\d+)\s*小时\s*(\d+)\s*次/i,
        /(\d+)\s*次\s*\/\s*(?:日|天)/i,
        /(\d+)\s*次\s*\/\s*日/i,
      ];

      let frequency = '';
      for (const pattern of frequencyPatterns) {
        const match = normalizedFlatText.match(pattern);
        if (match) {
          const times = match[1] || match[2] || '2';
          frequency = `每日${times}次`;
          break;
        }
      }

      // 如果没有找到频率，尝试查找其他模式
      if (!frequency) {
        const simplePattern = /(\d+)\s*次/i;
        const match = normalizedFlatText.match(simplePattern);
        if (match) {
          frequency = `每日${match[1]}次`;
        } else {
          frequency = '每日2次'; // 默认值
        }
      }

      // 如果没有找到剂量，设置默认值
      if (!dosage) {
        dosage = '每次1片';
      }

      const specificationTokens = [];
      const specMatch = normalizedFlatText.match(/([0-9]+(?:\.[0-9]+)?\s*(mg|g|ml|毫克|克|毫升))/gi) || [];
      specMatch.forEach((m) => specificationTokens.push(this.normalizeOcrText(m).toLowerCase()));
      const manufacturerTokens = [];
      const manuMatch =
        normalizedFlatText.match(/([\u4e00-\u9fa5A-Za-z]{2,20}(制药|药业|药厂|生物|医药))/g) || [];
      manuMatch.forEach((m) => manufacturerTokens.push(this.normalizeOcrText(m)));
      const ocrConfidenceHints = {
        lineCount: lines.length,
        hasNameWithSuffix: Boolean(nameCandidates.find((n) => /(片|胶囊|颗粒|丸|散|液|膏|贴|注射液)$/.test(n))),
        specificationTokens: Array.from(new Set(specificationTokens)).slice(0, 6),
        manufacturerTokens: Array.from(new Set(manufacturerTokens)).slice(0, 4),
      };

      return {
        name: medicineName,
        dosage: dosage,
        frequency: frequency,
        rawText: allText,
        nameCandidates: medicineName
          ? Array.from(new Set([medicineName, ...nameCandidates])).slice(0, 8)
          : nameCandidates,
        ocrConfidenceHints,
      };
    } catch (error) {
      console.error('提取药品信息失败:', error);
      return {
        name: '',
        dosage: '',
        frequency: '',
        rawText: '',
        nameCandidates: [],
        ocrConfidenceHints: null,
      };
    }
  }

  /**
   * 识别药品信息（完整流程）
   * 包括OCR识别和药物数据库查询
   */
  static async recognizeMedicine(imageUri) {
    const startAt = Date.now();
    try {
      // 1. 调用OCR API识别文字
      const ocrResult = await this.recognizeText(imageUri);

      // 2. 从识别结果中提取药品信息
      const ocrMedicineInfo = this.extractMedicineInfo(ocrResult);
      const ocrRawText = ocrMedicineInfo.rawText || '';

      // 3. 如果识别到药品名称，查询药物数据库获取详细信息
      let matched = null;
      if (ocrMedicineInfo.name || (ocrMedicineInfo.nameCandidates && ocrMedicineInfo.nameCandidates.length > 0)) {
        console.log('OCR识别到候选名称，开始查询药物数据库:', ocrMedicineInfo.nameCandidates || ocrMedicineInfo.name);
        try {
          matched = await MedicineDBService.searchMedicineWithCandidates(
            ocrMedicineInfo.nameCandidates?.length ? ocrMedicineInfo.nameCandidates : [ocrMedicineInfo.name],
            ocrMedicineInfo
          );
          console.log('药物数据库候选匹配结果:', matched);
        } catch (error) {
          console.warn('查询药物数据库失败，仅使用OCR结果:', error);
        }
      } else {
        console.log('OCR未识别到药品名称，跳过数据库查询');
      }

      // 4. 合并OCR结果和数据库查询结果
      if (matched?.bestMatch?.hasDetails && matched?.confidence === 'high') {
        const merged = MedicineDBService.mergeResults(ocrMedicineInfo, matched.bestMatch);
        merged.matchMeta = {
          confidence: matched.confidence,
          matchScore: matched.bestMatch.matchScore ?? null,
          candidateCount: matched.candidates?.length || 0,
          mode: 'auto',
        };
        console.log('[ocr-recognize] complete', {
          elapsedMs: Date.now() - startAt,
          candidateCount: matched.candidates?.length || 0,
          confidence: matched.confidence,
        });
        console.log('合并后的药品信息:', merged);
        return merged;
      }

      if (matched?.bestMatch?.hasDetails && matched?.confidence !== 'high') {
        console.log('[ocr-recognize] need candidate confirm', {
          elapsedMs: Date.now() - startAt,
          candidateCount: matched.candidates?.length || 0,
          confidence: matched.confidence,
        });
        return {
          ...ocrMedicineInfo,
          hasDetails: false,
          confidence: matched.confidence,
          candidates: (matched.candidates || []).slice(0, 3),
          bestMatch: matched.bestMatch,
          needsCandidateConfirm: true,
          matchMeta: {
            confidence: matched.confidence,
            matchScore: matched.bestMatch.matchScore ?? null,
            candidateCount: matched.candidates?.length || 0,
            mode: 'candidate_confirm',
          },
        };
      }

      // 5. 说明书接口缺失时：用 AI 生成简明说明（摘要）
      if (ocrMedicineInfo.name) {
        const cached = await this.getCachedMedicineGuide(ocrMedicineInfo.name);
        if (cached && this.isValidMedicineGuide(cached)) {
          return {
            ...ocrMedicineInfo,
            ...cached,
            hasDetails: true,
            aiGenerated: true,
          };
        }

        try {
          const guide = await AIService.generateMedicineGuide({
            name: ocrMedicineInfo.name,
            dosage: ocrMedicineInfo.dosage,
            frequency: ocrMedicineInfo.frequency,
            ocrRawText,
          });
          const merged = {
            ...ocrMedicineInfo,
            ...guide,
            hasDetails: true,
            aiGenerated: true,
          };
          // 只缓存有效结果（避免将兔底文案缓存 7 天导致持续展示乱码/失败提示）
          if (this.isValidMedicineGuide(guide)) {
            await this.cacheMedicineGuide(ocrMedicineInfo.name, guide);
          }
          return merged;
        } catch (e) {
          console.warn('AI药品说明生成失败，仅使用OCR结果:', e?.message || e);
        }
      }

      // 如果数据库查询失败/AI不可用，仅返回OCR结果
      console.log('返回OCR识别结果（无数据库/AI说明）:', ocrMedicineInfo);
      console.log('[ocr-recognize] fallback ocr-only', {
        elapsedMs: Date.now() - startAt,
        candidateCount: 0,
        confidence: 'low',
      });
      return ocrMedicineInfo;
    } catch (error) {
      console.error('识别药品信息失败:', error);
      throw new Error(`药品识别流程失败: ${error?.message || '未知错误'}`);
    }
  }
}

