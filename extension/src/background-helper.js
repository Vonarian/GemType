// GemType background payload builder and response extractor helper.
// Extracted into a helper module for testability and MV3 / Firefox compatibility.

'use strict';

/**
 * Extracts non-thought answer part from Gemini API candidate response.
 * Filters out reasoning/thought chunks emitted by Gemini 2.5 / 3.x models,
 * falling back to the last text part.
 *
 * @param {object} data - Raw Gemini API response JSON
 * @returns {string|undefined} Extracted text or undefined
 */
function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const answerPart =
    parts.find((p) => !p.thought && typeof p.text === 'string') ??
    parts[parts.length - 1];
  return answerPart?.text;
}

/**
 * Builds Gemini generateContent generationConfig object with adaptive thinkingConfig.
 *
 * @param {string} model - Target model identifier
 * @param {number|string} temperature - Sampling temperature
 * @param {number|string} topP - Nucleus sampling topP
 * @param {boolean} fastZeroShot - If true, disables/minimizes reasoning for low-latency rewrite
 * @returns {object} generationConfig for Gemini API
 */
function buildGenerationConfig(model = '', temperature, topP, fastZeroShot) {
  const config = {
    temperature: parseFloat(temperature ?? 0.3),
    topP: parseFloat(topP ?? 0.95),
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        rewritten: { type: 'STRING' },
      },
      required: ['rewritten'],
    },
  };

  if (fastZeroShot && typeof model === 'string') {
    if (model.startsWith('gemini-3')) {
      config.thinkingConfig = { thinkingLevel: 'MINIMAL' };
    } else if (model.startsWith('gemini-2.5')) {
      config.thinkingConfig = { thinkingBudget: 0 };
    }
  }

  return config;
}

/**
 * Safely parses the rewritten text from Gemini's response string.
 * Supports direct JSON, markdown code-fences, partial JSON with "rewritten" key,
 * quoted text, and plain text fallbacks.
 *
 * @param {string} rawText - Response candidate text
 * @returns {string} Clean rewritten text
 */
function parseRewrittenText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }

  let trimmed = rawText.trim();
  if (!trimmed) {
    return '';
  }

  // Attempt direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.rewritten === 'string') {
      return parsed.rewritten;
    }
    if (typeof parsed === 'string') {
      return parsed;
    }
  } catch (_) {}

  // Check for markdown code fences (e.g. ```json ... ``` or ``` ...)
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      const parsed = JSON.parse(inner);
      if (parsed && typeof parsed.rewritten === 'string') {
        return parsed.rewritten;
      }
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch (_) {}
    trimmed = inner;
  }

  // Try regex extraction of "rewritten": "..." in case the JSON is partially broken or surrounded by text
  const fieldMatch = trimmed.match(/"rewritten"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (fieldMatch) {
    try {
      return JSON.parse(`"${fieldMatch[1]}"`);
    } catch (_) {
      return fieldMatch[1];
    }
  }

  // Plain text fallback: strip enclosing quotes if present
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”'))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

// Global & CommonJS exports
if (typeof globalThis !== 'undefined') {
  globalThis.extractCandidateText = extractCandidateText;
  globalThis.buildGenerationConfig = buildGenerationConfig;
  globalThis.parseRewrittenText = parseRewrittenText;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractCandidateText,
    buildGenerationConfig,
    parseRewrittenText,
  };
}
