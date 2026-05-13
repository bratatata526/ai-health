import { AI_CONFIG, getEnabledAIServices } from '../config/ai';
import { WEB_PROXY_CONFIG } from '../config/webProxy';
import { Platform } from 'react-native';
import { buildHealthAdviceSummary } from '../utils/healthSummaryForAI';
import { sanitizeHealthAdviceText } from '../utils/sanitizeAiOutput';
import { SecureStorage } from '../utils/secureStorage';
import { MedicineDBService } from './MedicineDBService';

/** 从 OpenAI 兼容的 chat/completions JSON 中提取助手正文（兼容部分厂商字段差异） */
function extractOpenAIChatContent(data) {
  const choice = data?.choices?.[0];
  if (!choice) return null;

  const msg = choice.message ?? choice.delta;
  if (msg) {
    const c = msg.content;
    if (typeof c === 'string' && c.length > 0) return c;
    if (Array.isArray(c)) {
      const joined = c
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.text) return String(part.text);
          return '';
        })
        .join('');
      if (joined.length > 0) return joined;
    }
  }
  if (typeof choice.text === 'string' && choice.text.length > 0) {
    return choice.text;
  }
  return null;
}

/** 解析上游/代理返回的错误说明（OpenAI、硅基流动及部分网关） */
function extractUpstreamErrorMessage(data) {
  const e = data?.error;
  if (e != null && e !== false) {
    if (typeof e === 'string') return e;
    if (typeof e === 'object') {
      return (
        e.message ||
        e.msg ||
        (typeof e.code !== 'undefined' ? `${e.code}: ${e.message || e.msg || ''}` : '').trim() ||
        JSON.stringify(e)
      );
    }
    return String(e);
  }
  if (data?.choices?.length) return null;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data?.msg === 'string' && data.msg.trim()) return data.msg.trim();
  return null;
}

/**
 * AI服务类
 * 提供健康分析、用药建议等AI功能
 * 使用硅基流动 SiliconFlow API
 */
export class AIService {
  static pickMedicineDetailFromLocal(medicine = {}) {
    const detail = {
      name: medicine?.name || '',
      indication: medicine?.indication || '',
      usage: medicine?.usage || '',
      contraindication: medicine?.contraindication || '',
      precautions: medicine?.precautions || '',
      sideEffects: medicine?.sideEffects || '',
      interactions: medicine?.interactions || '',
      storage: medicine?.storage || '',
      description: medicine?.description || '',
    };
    const hasDetails = [
      detail.indication,
      detail.usage,
      detail.contraindication,
      detail.precautions,
      detail.sideEffects,
      detail.interactions,
      detail.storage,
      detail.description,
    ].some((x) => String(x || '').trim().length > 0);
    return hasDetails ? detail : null;
  }

  static buildMedicineDbSnippet(detail, fallbackName = '') {
    const name = String(detail?.name || fallbackName || '未知药品').trim();
    const fields = [
      ['适应症', detail?.indication],
      ['用法用量', detail?.usage],
      ['禁忌', detail?.contraindication],
      ['注意事项', detail?.precautions],
      ['不良反应', detail?.sideEffects],
      ['药物相互作用', detail?.interactions],
      ['贮藏', detail?.storage],
    ];
    const lines = fields
      .map(([label, value]) => {
        const v = String(value || '').trim();
        return v ? `  - ${label}：${v}` : '';
      })
      .filter(Boolean);
    if (!lines.length) {
      return `- ${name}：暂无可用说明书详情`;
    }
    return [`- ${name}：`, ...lines].join('\n');
  }

  static async buildMedicineLeafletContext(medicines = []) {
    const list = Array.isArray(medicines) ? medicines : [];
    if (!list.length) return '药品说明书信息：当前无药物管理数据。';

    // 限制条数，避免查询过慢和上下文过长。
    const top = list.slice(0, 3);
    const details = await Promise.all(
      top.map(async (m) => {
        const name = String(m?.name || '').trim();
        if (!name) return { name: '未命名药品', detail: null };
        const localDetail = this.pickMedicineDetailFromLocal(m);
        if (localDetail) return { name, detail: localDetail };
        try {
          const detail = await MedicineDBService.searchMedicine(name);
          if (detail?.hasDetails) return { name, detail };
          return { name, detail: null };
        } catch {
          return { name, detail: null };
        }
      })
    );

    const blocks = details.map(({ name, detail }) =>
      this.buildMedicineDbSnippet(detail, name)
    );
    if (list.length > top.length) {
      blocks.push(`- 其余 ${list.length - top.length} 个药品未展开说明书，请按需进一步查询。`);
    }
    return ['药品说明书信息（优先基于数据库/说明书）：', ...blocks].join('\n');
  }

  static extractMarkdownSection(markdown, headingCandidates) {
    const text = String(markdown || '');
    if (!text.trim()) return '';
    for (const heading of headingCandidates) {
      const pattern = new RegExp(
        `(?:^|\\n)#{0,3}\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`,
        'i'
      );
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].replace(/\n+/g, ' ').trim();
      }
    }
    return '';
  }

  static async getLatestTongueInsight() {
    try {
      const rows = (await SecureStorage.getItem('@tongue_analysis_history')) || [];
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const latest = rows
        .filter((item) => item?.status === 'success' && item?.result)
        .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
      if (!latest) return null;
      const features = latest.result?.features || {};
      const markdown = String(latest.result?.analysis_markdown || '');
      const constitution =
        this.extractMarkdownSection(markdown, ['可能的中医证型', '中医体质', '体质倾向']) || '';
      const conditioningAdvice =
        this.extractMarkdownSection(markdown, ['调理建议', '调护建议', '生活建议']) || '';
      const riskTips =
        this.extractMarkdownSection(markdown, ['风险提示', '注意事项', '就医提示']) || '';
      return {
        analyzedAt: latest.updated_at || latest.created_at || Date.now(),
        features: {
          tongueColor: features?.tongue_color?.label || '',
          coatingColor: features?.coating_color?.label || '',
          thickness: features?.tongue_thickness?.label || '',
          rotGreasy: features?.rot_greasy?.label || '',
        },
        constitution,
        conditioningAdvice,
        riskTips,
      };
    } catch (e) {
      console.warn('读取舌诊历史失败:', e);
      return null;
    }
  }

  /**
   * 调用硅基流动 API（兼容OpenAI格式）
   */
  static async callSiliconFlow(messages, config = AI_CONFIG.SILICONFLOW, overrides = {}) {
    try {
      const url = Platform.OS === 'web'
        ? `${WEB_PROXY_CONFIG.BASE_URL}/api/ai/siliconflow`
        : `${config.BASE_URL}/chat/completions`;

      const maxTokens = overrides.max_tokens ?? config.MAX_TOKENS;
      const temperature =
        typeof overrides.temperature === 'number' ? overrides.temperature : 0.7;

      const body = {
        model: config.MODEL,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        max_tokens: maxTokens,
        temperature,
      };
      if (typeof overrides.frequency_penalty === 'number') {
        body.frequency_penalty = overrides.frequency_penalty;
      }
      if (typeof overrides.presence_penalty === 'number') {
        body.presence_penalty = overrides.presence_penalty;
      }
      if (typeof overrides.top_p === 'number') {
        body.top_p = overrides.top_p;
      }

      const headers = {
        'Content-Type': 'application/json',
      };

      // Web端通过代理，移动端直接调用
      if (Platform.OS === 'web') {
        body.apiKey = config.API_KEY;
      } else {
        headers['Authorization'] = `Bearer ${config.API_KEY}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const rawText = await response.text();
      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        console.error('硅基流动响应非JSON:', String(rawText).slice(0, 500));
        throw new Error(
          response.ok
            ? 'AI返回格式异常：响应不是合法JSON'
            : `AI请求失败（HTTP ${response.status}），且响应体非JSON`
        );
      }

      if (!response.ok) {
        const upstream = extractUpstreamErrorMessage(data);
        throw new Error(
          upstream || `AI请求失败（HTTP ${response.status}）`
        );
      }

      const upstreamErr = extractUpstreamErrorMessage(data);
      if (upstreamErr && !data?.choices?.length) {
        throw new Error(upstreamErr);
      }

      if (data.raw != null && !data?.choices?.length) {
        const hint = String(data.raw).trim().slice(0, 240);
        console.error('代理返回非标准上游体:', hint);
        throw new Error(
          hint
            ? `上游响应无法解析为JSON：${hint}`
            : '上游响应无法解析为JSON，请检查代理与网络'
        );
      }

      const content = extractOpenAIChatContent(data);
      if (content != null && content.length > 0) {
        return content;
      }

      console.error('硅基流动JSON缺正文:', JSON.stringify(data).slice(0, 800));
      throw new Error(
        'AI返回格式异常：未找到有效的回复正文（choices[0].message.content）'
      );
    } catch (error) {
      console.error('硅基流动调用失败:', error);
      throw error;
    }
  }

  /**
   * 通用AI调用方法
   */
  static async callAI(messages, options = {}) {
    const enabledServices = getEnabledAIServices();
    
    if (enabledServices.length === 0) {
      throw new Error('未配置AI服务，请在config/ai.js中配置API密钥');
    }

    // 调用硅基流动
    const service = enabledServices[0];
    if (service === AI_CONFIG.SILICONFLOW) {
      const overrides = {};
      if (typeof options.maxTokens === 'number') overrides.max_tokens = options.maxTokens;
      if (typeof options.temperature === 'number') overrides.temperature = options.temperature;
      if (typeof options.frequencyPenalty === 'number') overrides.frequency_penalty = options.frequencyPenalty;
      if (typeof options.presencePenalty === 'number') overrides.presence_penalty = options.presencePenalty;
      if (typeof options.topP === 'number') overrides.top_p = options.topP;
      return await this.callSiliconFlow(messages, service, overrides);
    }

    throw new Error('AI服务调用失败，请检查网络连接和API配置');
  }

  /**
   * 生成健康分析报告
   */
  static async generateHealthAnalysis(healthData) {
    const prompt = `你是一位专业的健康管理专家。请根据以下健康数据，生成一份详细的健康分析报告：

健康数据：
- 平均心率：${healthData.avgHeartRate} bpm
- 平均血糖：${healthData.avgBloodGlucose} mmol/L
- 平均睡眠：${healthData.avgSleep} 小时
- 健康评分：${healthData.healthScore}/100
- 管理药品数：${healthData.medicineCount}

请从以下方面进行分析：
1. 整体健康状况评估
2. 各项指标是否正常
3. 潜在的健康风险
4. 具体的改善建议
5. 生活方式建议

请用中文回答，语言要专业但易懂，建议要具体可操作。`;

    const messages = [
      {
        role: 'system',
        content: '你是一位专业的健康管理专家，擅长分析健康数据并提供个性化的健康建议。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await this.callAI(messages);
  }

  /**
   * 生成用药建议
   */
  static async generateMedicineAdvice(medicineInfo, adherenceStats) {
    const prompt = `你是一位专业的临床药师。请根据以下药品信息和服药依从性数据，提供专业的用药建议：

药品信息：
- 药品名称：${medicineInfo.name}
- 服用剂量：${medicineInfo.dosage}
- 服用频率：${medicineInfo.frequency}
${medicineInfo.indication ? `- 适应症：${medicineInfo.indication}` : ''}
${medicineInfo.contraindication ? `- 禁忌：${medicineInfo.contraindication}` : ''}

服药依从性：
- 计划次数：${adherenceStats.scheduled}
- 已服次数：${adherenceStats.taken}
- 漏服次数：${adherenceStats.missed}
- 依从率：${Math.round(adherenceStats.adherenceRate * 100)}%

请从以下方面提供建议：
1. 服药依从性评估
2. 漏服的影响和应对措施
3. 用药注意事项
4. 与其他药品可能的相互作用（如果有）
5. 改善依从性的具体建议

请用中文回答，语言要专业但易懂，建议要具体可操作。`;

    const messages = [
      {
        role: 'system',
        content: '你是一位专业的临床药师，擅长提供用药指导和依从性建议。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await this.callAI(messages);
  }

  /**
   * 检测药物相互作用
   */
  static async checkDrugInteractions(medicines) {
    const medicineList = medicines.map(m => `- ${m.name}（${m.dosage}，${m.frequency}）`).join('\n');

    const prompt = `你是一位专业的临床药师。请分析以下药品组合是否存在药物相互作用：

药品列表：
${medicineList}

请检查：
1. 是否存在已知的药物相互作用
2. 相互作用的严重程度
3. 可能的不良反应
4. 建议的处理措施

如果不存在明显的相互作用，请说明。请用中文回答，语言要专业但易懂。`;

    const messages = [
      {
        role: 'system',
        content: '你是一位专业的临床药师，擅长分析药物相互作用。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    return await this.callAI(messages);
  }

  /**
   * 生成个性化健康建议
   */
  static async generatePersonalizedAdvice(userData) {
    const tongueInsight = await this.getLatestTongueInsight();
    const summary = buildHealthAdviceSummary({ ...(userData || {}), tongueInsight });
    const prompt = `下面是用户在本应用中产生的健康数据摘要（已做统计聚合；请勿编造未在摘要中出现的数值或怪异日期）。

${summary}

请撰写一篇「个性化健康建议」（全文使用简体中文），不必采用僵硬的条文编号模板，可自行分段，读来自然连贯即可。

内容上请详尽、可读：对心率、血糖、睡眠（及用药若有）基于摘要逐一解读；重点使用摘要中的分钟级心率、分时段结论、异常连续时长信息进行更专业分析；若摘要含舌诊信息，必须加入「中医体质/证型倾向」「调理建议」「风险提示」三个部分，并与客观指标互相印证；能综合则说明指标间呼应，不能则说明数据局限；涉及用药与安全时提示遵医嘱并及时就医。

输出格式必须严格遵循以下结构（每个标题单独成行）：
### 心率分析
（正文段落）

### 血糖分析
（正文段落）

### 睡眠分析
（正文段落）

### 中医体质分析
（正文段落：必须同时包含体质/证型倾向、调理建议、风险提示）

### 用药建议
（若无用药可写“当前无药物管理数据”）

**强制遵守（违者视为不合格输出）：**
- 禁止使用「解析」一词作为填充语，禁止同一短词无限重复或以逗号刷屏；禁止连续写出三个以上标点（句号、逗号等均不可堆叠）。
- 禁止出现重复标点（例如“，，”“，。”）。
- 禁止抄写或输出与本任务无关的应用界面文案（例如底部导航「首页」「药品」「设备」「报告」等）。
- 数字格式规范：平均值等写「72.8」形式，禁止使用「72..8」或错乱小数点。
- 每段首行请使用两个全角空格“　　”开头，分段自然，不要把整篇写成一段。
- 不允许单独输出“风险提示”作为标题；风险提示必须并入“中医体质分析”小节。
- 若某段难以续写应在自然收尾处停止，不可用无意义词句凑字数。

其余：只引用摘要中的数字与时间；数据不足则说明如何补充监测；不进行医学诊断。`;

    const messages = [
      {
        role: 'system',
        content:
          '你是资深健康顾问：根据摘要写建议，文风自然口语化与书面语皆可，但禁止灌水、复读、堆标点。不写应用导航或 OCR 占位词。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const raw = await this.callAI(messages, {
      maxTokens: 2000,
      temperature: 0.2,
      frequencyPenalty: 0.6,
      presencePenalty: 0.35,
      topP: 0.88,
    });
    return sanitizeHealthAdviceText(raw);
  }

  /**
   * AI健康问答
   */
  static async healthQnA(question, context = {}) {
    const healthData =
      context?.healthData && typeof context.healthData === 'object'
        ? context.healthData
        : {};
    const medicines = Array.isArray(context?.medicines) ? context.medicines : [];
    const devices = Array.isArray(context?.devices) ? context.devices : [];
    const tongueInsight =
      context?.tongueInsight && typeof context.tongueInsight === 'object'
        ? context.tongueInsight
        : await this.getLatestTongueInsight();
    const healthSummary =
      typeof context?.healthSummary === 'string' && context.healthSummary.trim()
        ? context.healthSummary.trim()
        : buildHealthAdviceSummary({
            heartRate: Array.isArray(context?.heartRate)
              ? context.heartRate
              : healthData?.heartRate || [],
            bloodGlucose: Array.isArray(context?.bloodGlucose)
              ? context.bloodGlucose
              : healthData?.bloodGlucose || [],
            sleep: Array.isArray(context?.sleep) ? context.sleep : healthData?.sleep || [],
            medicines,
            tongueInsight,
          });

    const deviceInfo = devices.length
      ? `设备清单：${devices
          .map((d) => {
            const name = String(d?.name || d?.id || '未命名设备').trim();
            const type = String(d?.type || '').trim();
            const status = d?.connected ? '在线' : '离线';
            return `${name}${type ? `(${type})` : ''}-${status}`;
          })
          .join('；')}`
      : '设备清单：暂无已连接设备记录';
    const medicineLeafletContext = await this.buildMedicineLeafletContext(medicines);

    const prompt = `你是一位专业的健康管理助手。用户提问：${question}

以下是该用户在本应用中的完整健康数据摘要，请优先基于这些内容回答（禁止编造摘要中不存在的数据）：
${healthSummary}

${deviceInfo}
${medicineLeafletContext}

回答要求：
1) 先直接回答用户问题，再给出可执行建议。
2) 若某项数据缺失，要明确说“目前暂无该项记录”，并说明建议补充的监测方式。
3) 若涉及用药，优先引用上面的说明书信息回答“适应症、用法、禁忌、注意事项、相互作用”；若说明书字段缺失请明确说明“说明书暂无该项信息”。
4) 若涉及异常指标或风险，提醒用户及时咨询医生。`;

    const messages = [
      {
        role: 'system',
        content:
          '你是一位专业的健康管理助手，回答时必须结合用户的应用内健康数据摘要，避免空泛套话。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const raw = await this.callAI(messages);
    return sanitizeHealthAdviceText(raw);
  }

  /**
   * 生成“药品说明（摘要）”：适应症/用法用量/禁忌/注意事项/不良反应/相互作用/贮藏
   * - 用于第三方说明书接口缺失时的兜底
   * - 输出尽量结构化，方便 UI 展示
   */
  static async generateMedicineGuide({ name, dosage, frequency, ocrRawText } = {}) {
    const medicineName = String(name || '').trim();
    if (!medicineName) throw new Error('缺少药品名称');

    const prompt = `请你作为“临床药师”，为药品《${medicineName}》生成一份【简明说明（摘要）】。

已知信息（可能不完整）：
- 识别到的剂量：${dosage || '未知'}
- 识别到的频率：${frequency || '未知'}
- 包装/说明书 OCR 原文（可能有噪声）：${ocrRawText ? `\n"""${String(ocrRawText).slice(0, 2000)}"""\n` : '无'}

要求：
1) 只输出 JSON（不要 markdown，不要多余解释），字段固定为：
{
  "indication": "...",           // 适应症/用于治疗什么
  "usage": "...",                // 用法用量（结合已知剂量/频率，如不确定要说明“不确定”并建议遵医嘱/说明书）
  "contraindication": "...",     // 禁忌
  "precautions": "...",          // 注意事项（重点：孕哺、肝肾功能、儿童、驾驶、酒精、常见警示）
  "sideEffects": "...",          // 常见不良反应
  "interactions": "...",         // 常见相互作用提示
  "storage": "..."               // 贮藏
}
2) 内容使用中文，尽量客观；不确定的地方要明确“不确定/需核对说明书或咨询医生/药师”。
3) 不要编造具体禁忌/剂量细节；如果无法判断就写“需核对说明书/遵医嘱”。`;

    const messages = [
      { role: 'system', content: '你是一位严谨的临床药师，避免编造，不确定时明确说明需要核对说明书或咨询医生/药师。' },
      { role: 'user', content: prompt },
    ];

    const text = await this.callAI(messages);
    try {
      const json = JSON.parse(text);
      return {
        indication: String(json.indication || '').trim(),
        usage: String(json.usage || '').trim(),
        contraindication: String(json.contraindication || '').trim(),
        precautions: String(json.precautions || '').trim(),
        sideEffects: String(json.sideEffects || '').trim(),
        interactions: String(json.interactions || '').trim(),
        storage: String(json.storage || '').trim(),
      };
    } catch {
      // 兜底：若模型未严格输出 JSON，则把原文塞到 description 里，至少给用户看到“能治什么/注意什么”的文本
      return {
        indication: '',
        usage: '',
        contraindication: '',
        precautions: '',
        sideEffects: '',
        interactions: '',
        storage: '',
        description: String(text || '').trim(),
      };
    }
  }
}
