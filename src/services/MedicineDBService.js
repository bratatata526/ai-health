import { CURRENT_API, MEDICINE_DB_CONFIG } from '../config/medicineDB';
import { Platform } from 'react-native';
import { WEB_PROXY_CONFIG } from '../config/webProxy';
import { SecureStorage } from '../utils/secureStorage';

const MEDICINE_DB_CACHE_PREFIX = '@medicine_db_cache:';
const MEDICINE_DB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7天

// 用缓存做“离线兜底”：当外部接口不可用时，尝试用相近药名的缓存结果
const OFFLINE_FALLBACK_MAX_KEYS = 200;

function shouldUseSource(sourceName, source) {
  if (!source) return false;
  if (source.ENABLED) return true;
  // Web 端兜底：允许通过本地代理尝试 TianAPI（由代理读取 .env key）
  if (Platform.OS === 'web' && sourceName === 'TIANAPI') return true;
  return false;
}

function normalizeNameForMatch(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\]（）【】]/g, '')
    .replace(/[·•，,。.;；:：/\\|]/g, '');
}

function simpleScore(a, b) {
  // 简单相似度：包含关系优先，其次按公共前缀长度
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return Math.min(60, i * 10);
}

function toTokenList(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[()\[\]（）【】]/g, ' ')
    .replace(/[，,。.;；:：/\\|]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function stripHtmlTags(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractByLabels(text, labels = []) {
  const src = String(text || '');
  for (const label of labels) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reg = new RegExp(
      `(?:【?${escaped}】?|${escaped})[:：]?\\s*([\\s\\S]{0,420}?)(?=(?:\\n\\s*【[^\\n]{1,16}】)|(?:\\n\\s*[A-Za-z\\u4e00-\\u9fa5]{2,16}[:：])|$)`,
      'i'
    );
    const m = src.match(reg);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function simplifyDrugQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw
    .replace(/[（(].*?[)）]/g, ' ')
    .replace(/[0-9]+(?:\.[0-9]+)?\s*(mg|g|ml|毫克|克|毫升|片|粒|袋|支|盒|瓶|丸|贴|喷|次|\/|\*)/gi, ' ')
    .replace(/[^\u4e00-\u9fa5A-Za-z]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 药物数据库服务
 * 通过药品名称查询详细的药品信息（说明书、禁忌、适应症等）
 */
export class MedicineDBService {
  static scoreMedicineMatch(dbResult, candidateName, ocrMeta = null) {
    if (!dbResult || !dbResult.hasDetails) return 0;
    const candidate = normalizeNameForMatch(candidateName);
    const dbName = normalizeNameForMatch(dbResult.name || '');
    let score = simpleScore(candidate, dbName);

    const hint = ocrMeta?.ocrConfidenceHints || {};
    const specTokens = Array.isArray(hint.specificationTokens) ? hint.specificationTokens : [];
    const manuTokens = Array.isArray(hint.manufacturerTokens) ? hint.manufacturerTokens : [];
    const dbSpecTokens = toTokenList(dbResult.specification);
    const dbManuTokens = toTokenList(dbResult.manufacturer);
    const rawText = String(ocrMeta?.rawText || '').toLowerCase();

    if (dbName && rawText.includes(dbName)) score += 12;
    if (specTokens.some((t) => dbSpecTokens.includes(String(t || '').toLowerCase()))) score += 10;
    if (manuTokens.some((t) => dbManuTokens.includes(String(t || '').toLowerCase()))) score += 8;
    if (dbResult.approvalNumber && rawText.includes(String(dbResult.approvalNumber).toLowerCase())) score += 8;

    return Math.max(0, Math.min(100, score));
  }

  static resolveConfidenceByScore(score) {
    if (score >= 82) return 'high';
    if (score >= 62) return 'medium';
    return 'low';
  }

  static async searchMedicineWithCandidates(nameCandidates, ocrMeta = null) {
    const names = Array.from(
      new Set((Array.isArray(nameCandidates) ? nameCandidates : []).map((x) => String(x || '').trim()).filter(Boolean))
    );
    if (!names.length) {
      return { bestMatch: this.getEmptyResult(), candidates: [], confidence: 'low' };
    }

    const matched = [];
    for (const n of names) {
      const found = await this.searchMedicine(n);
      if (!found || !found.hasDetails) continue;
      matched.push({
        ...found,
        matchBy: n,
        matchScore: this.scoreMedicineMatch(found, n, ocrMeta),
      });
    }

    const dedup = [];
    const seen = new Set();
    for (const item of matched) {
      const key = normalizeNameForMatch(item.name || item.matchBy || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedup.push(item);
    }
    dedup.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    const bestMatch = dedup[0] || this.getEmptyResult();
    const confidence = this.resolveConfidenceByScore(bestMatch.matchScore || 0);
    return {
      bestMatch,
      candidates: dedup.slice(0, 5),
      confidence,
    };
  }

  /**
   * 查询药品详细信息
   * @param {string} medicineName - 药品名称
   * @returns {Promise<Object>} 药品详细信息
   */
  static async searchMedicine(medicineName) {
    try {
      // 生成候选名称：提升 OCR 误差下的命中率
      const candidates = this.generateNameCandidates(medicineName);
      console.log('[medicine-db] search start:', { input: medicineName, candidates });

      // 选择启用的数据源，按优先级依次尝试（自动降级）
      const sourceEntries = [
        ['TIANAPI', MEDICINE_DB_CONFIG.TIANAPI],
        ['JUHE_API', MEDICINE_DB_CONFIG.JUHE_API],
        ['WANWEI_API', MEDICINE_DB_CONFIG.WANWEI_API],
        ['JISU_API', MEDICINE_DB_CONFIG.JISU_API],
      ];
      const sources = sourceEntries
        .filter(([name, src]) => shouldUseSource(name, src))
        .map(([, src]) => src);
      console.log('[medicine-db] enabled sources:', {
        juhe: MEDICINE_DB_CONFIG.JUHE_API.ENABLED,
        tian: MEDICINE_DB_CONFIG.TIANAPI.ENABLED,
        wanwei: MEDICINE_DB_CONFIG.WANWEI_API.ENABLED,
        jisu: MEDICINE_DB_CONFIG.JISU_API.ENABLED,
        webTianFallback: Platform.OS === 'web',
      });

      if (sources.length === 0) {
        console.log('药物数据库API未启用，返回空结果');
        return this.getEmptyResult();
      }

      for (const name of candidates) {
        if (!name) continue;
        for (const api of sources) {
          console.log('[medicine-db] try source:', { source: api?.BASE_URL, name });
          const result = await this.searchByApi(api, name);
          if (result && result.hasDetails) {
            console.log('[medicine-db] hit details:', { source: api?.BASE_URL, name: result.name || name });
            return result;
          }
        }
      }

      // 外部接口都失败：尝试离线兜底（从缓存里找相近名称）
      const offline = await this.tryOfflineFallback(candidates);
      if (offline && offline.hasDetails) return offline;

      return this.getEmptyResult();
    } catch (error) {
      console.error('查询药品信息失败:', error);
      return this.getEmptyResult();
    }
  }

  static async tryOfflineFallback(candidates) {
    try {
      const keys = await SecureStorage.getAllKeys();
      const cacheKeys = keys
        .filter((k) => typeof k === 'string' && k.startsWith(MEDICINE_DB_CACHE_PREFIX))
        .slice(0, OFFLINE_FALLBACK_MAX_KEYS);
      if (cacheKeys.length === 0) return null;

      const targetList = (candidates || []).map(normalizeNameForMatch).filter(Boolean);
      let best = { score: 0, key: null };
      for (const k of cacheKeys) {
        const cachedName = k.slice(MEDICINE_DB_CACHE_PREFIX.length);
        const cn = normalizeNameForMatch(cachedName);
        for (const t of targetList) {
          const s = simpleScore(cn, t);
          if (s > best.score) best = { score: s, key: k };
        }
      }

      if (!best.key || best.score < 60) return null;
      const cached = await SecureStorage.getItem(best.key);
      if (cached && cached.data && cached.data.hasDetails) {
        console.log('离线兜底命中缓存:', best.key, 'score=', best.score);
        return cached.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  static async searchByApi(api, medicineName) {
    // 根据配置的API调用不同的服务（不再依赖 CURRENT_API 单点）
    if (api === MEDICINE_DB_CONFIG.JUHE_API) {
      return await this.searchJuheAPI(medicineName, api);
    }
    if (api === MEDICINE_DB_CONFIG.TIANAPI) {
      return await this.searchTianAPI(medicineName, api);
    }
    if (api === MEDICINE_DB_CONFIG.WANWEI_API) {
      return await this.searchWanweiAPI(medicineName, api);
    }
    if (api === MEDICINE_DB_CONFIG.JISU_API) {
      return await this.searchJisuAPI(medicineName, api);
    }
    return this.getEmptyResult();
  }

  /**
   * 清理药品名称（移除剂型后缀，提取核心名称）
   */
  static cleanMedicineName(name) {
    if (!name) return '';
    
    // 移除常见的剂型后缀
    const suffixes = [
      '片', '胶囊', '颗粒', '丸', '散', '液', '膏', '贴', '栓',
      '注射剂', '注射液', '软胶囊', '肠溶片', '缓释片', '控释片',
      '咀嚼片', '泡腾片', '分散片', '薄膜衣片', '糖衣片'
    ];
    
    let cleanName = name.trim();
    for (const suffix of suffixes) {
      if (cleanName.endsWith(suffix)) {
        cleanName = cleanName.slice(0, -suffix.length);
        break;
      }
    }
    
    return cleanName.trim();
  }

  // 生成多个候选名称，用于提高查询命中率
  static generateNameCandidates(name) {
    const raw = (name || '').trim();
    if (!raw) return [];

    const cleaned = this.cleanMedicineName(raw);
    // 去掉常见符号/空白
    const normalized = raw
      .replace(/[()\[\]（）【】]/g, ' ')
      .replace(/[·•，,。.;；:：/\\|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const normalizedClean = this.cleanMedicineName(normalized);

    // 去掉“复方/滴丸/缓释/控释/肠溶”等修饰词（保守处理）
    const deDecorated = normalizedClean
      .replace(/^复方/, '')
      .replace(/(肠溶|缓释|控释|分散|泡腾|咀嚼|薄膜衣|糖衣)$/, '')
      .trim();

    const simplified = simplifyDrugQuery(raw);
    const simplifiedClean = this.cleanMedicineName(simplified);
    const chineseCore = (simplifiedClean.match(/[\u4e00-\u9fa5]{2,12}/g) || []).join(' ').trim();

    const candidates = [cleaned, normalizedClean, deDecorated, simplifiedClean, chineseCore, raw]
      .filter(Boolean)
      .map((s) => s.trim())
      .filter(Boolean);

    // 去重，保持顺序
    const out = [];
    const seen = new Set();
    for (const c of candidates) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }

  /**
   * 调用聚合数据药品查询API
   * 官网：https://www.juhe.cn/docs/api/id/77
   */
  static async searchJuheAPI(medicineName, api = CURRENT_API) {
    try {
      // 简单缓存：减少重复查询（对 Web/移动端都生效）
      const cacheKey = `${MEDICINE_DB_CACHE_PREFIX}${medicineName}`;
      try {
        const cached = await SecureStorage.getItem(cacheKey);
        if (cached && cached.data && cached.cachedAt && Date.now() - cached.cachedAt < MEDICINE_DB_CACHE_TTL_MS) {
          console.log('命中药品说明缓存:', medicineName);
          return cached.data;
        }
      } catch {
        // 缓存读取失败不影响主流程
      }

      // Web：走本地代理，避免 Mixed Content（https 页面请求 http）以及 CORS
      const url =
        Platform.OS === 'web'
          ? `${WEB_PROXY_CONFIG.BASE_URL}/api/medicine/juhe?apiKey=${encodeURIComponent(
              api.API_KEY || ''
            )}&drugname=${encodeURIComponent(medicineName)}`
          : `${api.BASE_URL}?key=${api.API_KEY}&drugname=${encodeURIComponent(medicineName)}`;
      
      console.log('查询聚合数据API:', url);
      const response = await fetch(url);
      const data = await response.json();

      console.log('聚合数据API返回:', data);

      // 聚合数据API返回格式：{ error_code: 0, reason: 'success', result: {...} }
      if (data.error_code === 0 && data.result) {
        const formatted = this.formatJuheResult(data.result);
        console.log('格式化后的药品信息:', formatted);
        try {
          await SecureStorage.setItem(cacheKey, { cachedAt: Date.now(), data: formatted });
        } catch {
          // ignore cache write errors
        }
        return formatted;
      }

      // 如果返回错误，记录日志
      if (data.error_code !== 0) {
        console.warn('聚合数据API返回错误:', data.reason || data.error_code, data);
      }

      return this.getEmptyResult();
    } catch (error) {
      console.error('聚合数据API调用失败:', error);
      return this.getEmptyResult();
    }
  }

  /**
   * 调用天聚数行药品说明书API
   * 官网：https://www.tianapi.com/apiview/134
   * 支持GET和POST两种方式
   */
  static async searchTianAPI(medicineName, api = CURRENT_API) {
    try {
      // 使用GET方式调用（更简单）
      const url =
        Platform.OS === 'web'
          ? `${WEB_PROXY_CONFIG.BASE_URL}/api/medicine/tianapi?key=${encodeURIComponent(
              api.API_KEY || ''
            )}&word=${encodeURIComponent(medicineName)}`
          : `${api.BASE_URL}?key=${api.API_KEY}&word=${encodeURIComponent(medicineName)}`;
      
      const response = await fetch(url);
      const data = await response.json();
      console.log('[medicine-db] tianapi response:', {
        query: medicineName,
        code: data?.code,
        hasNewslist: Array.isArray(data?.newslist) ? data.newslist.length : 0,
        hasResultList: Array.isArray(data?.result?.list) ? data.result.list.length : 0,
      });

      // 天聚数行API历史上出现过两种结构：
      // 1) { code: 200, newslist: [...] }
      // 2) { code: 200, result: { list: [...] } }
      const list =
        (Array.isArray(data.newslist) && data.newslist) ||
        (Array.isArray(data?.result?.list) && data.result.list) ||
        [];
      if (data.code === 200 && list.length > 0) {
        return this.formatTianAPIResult(list[0]);
      }

      // 如果返回错误，记录日志
      if (data.code !== 200) {
        console.warn('天聚数行API返回错误:', data.msg || data);
      }

      return this.getEmptyResult();
    } catch (error) {
      console.error('天聚数行API调用失败:', error);
      return this.getEmptyResult();
    }
  }

  /**
   * 调用万维易源药品查询API
   */
  static async searchWanweiAPI(medicineName, api = CURRENT_API) {
    try {
      const url =
        Platform.OS === 'web'
          ? `${WEB_PROXY_CONFIG.BASE_URL}/api/medicine/wanwei?appcode=${encodeURIComponent(
              api.APP_CODE || ''
            )}&name=${encodeURIComponent(medicineName)}`
          : `${api.BASE_URL}/medicine?name=${encodeURIComponent(medicineName)}`;
      
      const response =
        Platform.OS === 'web'
          ? await fetch(url)
          : await fetch(url, {
              headers: {
                Authorization: `APPCODE ${api.APP_CODE}`,
              },
            });

      const data = await response.json();

      if (data.showapi_res_code === 0 && data.showapi_res_body) {
        return this.formatWanweiResult(data.showapi_res_body);
      }

      return this.getEmptyResult();
    } catch (error) {
      console.error('万维易源API调用失败:', error);
      return this.getEmptyResult();
    }
  }

  /**
   * 调用极速数据药品查询API
   */
  static async searchJisuAPI(medicineName, api = CURRENT_API) {
    try {
      const url =
        Platform.OS === 'web'
          ? `${WEB_PROXY_CONFIG.BASE_URL}/api/medicine/jisu?appkey=${encodeURIComponent(
              api.API_KEY || ''
            )}&name=${encodeURIComponent(medicineName)}`
          : `${api.BASE_URL}?appkey=${api.API_KEY}&name=${encodeURIComponent(medicineName)}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === '0' && data.result) {
        return this.formatJisuResult(data.result);
      }

      return this.getEmptyResult();
    } catch (error) {
      console.error('极速数据API调用失败:', error);
      return this.getEmptyResult();
    }
  }

  /**
   * 格式化聚合数据API结果
   */
  static formatJuheResult(result) {
    // 聚合数据API返回的字段可能是中文或英文，需要兼容处理
    return {
      name: result.name || result.药品名称 || result.drugname || '',
      specification: result.specification || result.规格 || result.guige || '',
      manufacturer: result.manufacturer || result.生产厂家 || result.changjia || '',
      approvalNumber: result.approvalNumber || result.批准文号 || result.pizhunwenhao || '',
      indication: result.indication || result.适应症 || result.shiyingzheng || '',
      contraindication: result.contraindication || result.禁忌 || result.jinji || '',
      usage: result.usage || result.用法用量 || result.yongfayongliang || '',
      dosage: result.dosage || result.剂量 || '',
      sideEffects: result.sideEffects || result.不良反应 || result.buliangfanying || '',
      precautions: result.precautions || result.注意事项 || result.zhuyishixiang || '',
      interactions: result.interactions || result.药物相互作用 || result.xianghuzuoyong || '',
      storage: result.storage || result.贮藏 || result.zhucang || '',
      description: result.description || result.说明书 || result.shuomingshu || result.药品说明 || '',
      hasDetails: true,
    };
  }

  /**
   * 格式化天聚数行API结果
   */
  static formatTianAPIResult(result) {
    const title = result.title || result.name || result.药品名称 || '';
    const contentText = stripHtmlTags(result.content || result.description || result.说明书 || '');
    const indication = extractByLabels(contentText, ['适应症', '适应证', '用于']);
    const contraindication = extractByLabels(contentText, ['禁忌', '禁忌症', '禁止症']);
    const usage = extractByLabels(contentText, ['用法用量', '用量与用法', '用法']);
    const sideEffects = extractByLabels(contentText, ['不良反应', '副作用']);
    const precautions = extractByLabels(contentText, ['注意事项']);
    const interactions = extractByLabels(contentText, ['药物相互作用', '相互作用']);
    const storage = extractByLabels(contentText, ['贮藏', '储存']);
    const spec = extractByLabels(contentText, ['规格', '剂型及规格']);

    return {
      name: title,
      specification: spec || result.specification || result.规格 || '',
      manufacturer: result.manufacturer || result.生产厂家 || '',
      approvalNumber: result.approvalNumber || result.批准文号 || '',
      indication: indication || result.indication || result.适应症 || '',
      contraindication: contraindication || result.contraindication || result.禁忌 || '',
      usage: usage || result.usage || result.用法用量 || '',
      dosage: result.dosage || '',
      sideEffects: sideEffects || result.sideEffects || result.不良反应 || '',
      precautions: precautions || result.precautions || result.注意事项 || '',
      interactions: interactions || result.interactions || result.药物相互作用 || '',
      storage: storage || result.storage || result.贮藏 || '',
      description: contentText || result.description || result.说明书 || result.药品说明 || '',
      hasDetails: true,
    };
  }

  /**
   * 格式化万维易源API结果
   */
  static formatWanweiResult(result) {
    return {
      name: result.name || '',
      specification: result.specification || '',
      manufacturer: result.manufacturer || '',
      approvalNumber: result.approvalNumber || '',
      indication: result.indication || result.适应症 || '',
      contraindication: result.contraindication || result.禁忌症 || '',
      usage: result.usage || result.用法用量 || '',
      dosage: result.dosage || '',
      sideEffects: result.sideEffects || result.不良反应 || '',
      precautions: result.precautions || result.注意事项 || '',
      interactions: result.interactions || result.药物相互作用 || '',
      storage: result.storage || result.贮藏 || '',
      description: result.description || result.说明书 || '',
      hasDetails: true,
    };
  }

  /**
   * 格式化极速数据API结果
   */
  static formatJisuResult(result) {
    return {
      name: result.name || '',
      specification: result.specification || '',
      manufacturer: result.manufacturer || '',
      approvalNumber: result.approvalNumber || '',
      indication: result.indication || '',
      contraindication: result.contraindication || '',
      usage: result.usage || '',
      dosage: result.dosage || '',
      sideEffects: result.sideEffects || '',
      precautions: result.precautions || '',
      interactions: result.interactions || '',
      storage: result.storage || '',
      description: result.description || '',
      hasDetails: true,
    };
  }

  /**
   * 返回空结果
   */
  static getEmptyResult() {
    return {
      name: '',
      specification: '',
      manufacturer: '',
      approvalNumber: '',
      indication: '',
      contraindication: '',
      usage: '',
      dosage: '',
      sideEffects: '',
      precautions: '',
      interactions: '',
      storage: '',
      description: '',
      hasDetails: false,
    };
  }

  /**
   * 合并OCR识别结果和数据库查询结果
   * @param {Object} ocrResult - OCR识别结果
   * @param {Object} dbResult - 数据库查询结果
   * @returns {Object} 合并后的药品信息
   */
  static mergeResults(ocrResult, dbResult, selectedCandidate = null) {
    const picked = selectedCandidate && selectedCandidate.hasDetails ? selectedCandidate : dbResult;
    return {
      // OCR识别的信息（优先级高）
      name: ocrResult.name || picked.name,
      dosage: ocrResult.dosage || picked.dosage,
      frequency: ocrResult.frequency || '',
      
      // 数据库查询的详细信息
      specification: picked.specification,
      manufacturer: picked.manufacturer,
      approvalNumber: picked.approvalNumber,
      indication: picked.indication,
      contraindication: picked.contraindication,
      usage: picked.usage,
      sideEffects: picked.sideEffects,
      precautions: picked.precautions,
      interactions: picked.interactions,
      storage: picked.storage,
      description: picked.description,
      hasDetails: picked.hasDetails,
      matchScore: picked.matchScore,
      matchBy: picked.matchBy,
    };
  }
}

