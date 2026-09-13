/**
 * 工具调用格式检测：识别模型未按约定格式（```cuckoo 代码块）输出的常见错误形态，
 * 用于发送"请使用指定格式"的提示。
 *
 * 纯函数，可在 Node 单测离线验证。
 */

/** 常见错误格式特征（GPT 系模型高频出现的 XML/JSON 工具调用形态） */
const PATTERNS = [
  // XML / AntML invoke 族
  { kind: 'xml', re: /<\s*(?:[\w-]+:)?invoke\s+name=/i },
  { kind: 'xml', re: /<\s*\/\s*(?:[\w-]+:)?invoke\s*>/i },
  { kind: 'xml', re: /<\s*(?:[\w-]+:)?parameter\s+name=/i },
  { kind: 'xml', re: /<\s*(?:[\w-]+:)?function_calls\s*>/i },
  { kind: 'xml', re: /<\s*tool_call\s*>/i },
  { kind: 'xml', re: /<\|[\w-]+\|>/ }, // <|assistant|> 类特殊 token
  { kind: 'xml', re: /｜｜[\w-]+｜｜/ }, // DSML 变体
  // JSON 工具调用对象（name + arguments 同现）
  { kind: 'json', re: /"\s*name\s*"\s*:\s*"[^"]{1,64}"\s*,\s*"\s*arguments\s*"/ },
  { kind: 'json', re: /"\s*arguments\s*"\s*:\s*\{[\s\S]{0,200}?\}\s*\}/ },
];

/**
 * 检测回复是否为"未按 cuckoo 格式输出的工具调用"。
 * 注意：纯文本回复 / 正常代码块返回 null（那不是格式错误，不该打扰）。
 * @param {string} raw 模型回复原文
 * @returns {{detected:boolean, kind:(string|null)}}
 */
function detectWrongToolFormat(raw) {
  const text = String(raw || '');
  if (!text.trim()) return { detected: false, kind: null };
  for (const p of PATTERNS) {
    if (p.re.test(text)) return { detected: true, kind: p.kind };
  }
  return { detected: false, kind: null };
}

module.exports = { detectWrongToolFormat, PATTERNS };
