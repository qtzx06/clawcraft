const fs = require('fs/promises');

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseSimpleList(rawText) {
  if (!rawText) return [];
  return rawText
    .split(/\n/)
    .map((line) => line.replace(/^[\-*•]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function extractSection(text, headingNames) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const names = Array.isArray(headingNames) ? headingNames : [headingNames];
  let start = -1;
  let end = normalized.length;

  const isHeader = (line) => /^#{1,6}\s+/.test(line);
  const matchesHeading = (line) => {
    const lower = line.toLowerCase();
    return names.some((name) => lower.includes(String(name).toLowerCase()));
  };

  for (let i = 0; i < normalized.length; i += 1) {
    if (isHeader(normalized[i]) && matchesHeading(normalized[i])) {
      start = i + 1;
      continue;
    }
    if (start >= 0 && isHeader(normalized[i])) {
      end = i;
      break;
    }
  }

  if (start < 0) return '';
  return normalized
    .slice(start, end)
    .join('\n')
    .trim();
}

function parseField(text, label) {
  const pattern = new RegExp(`^${label}\\s*[:\\-]\\s*(.+)$`, 'im');
  const match = String(text || '').match(pattern);
  return match ? String(match[1]).trim() : '';
}

function parseLinesToProfile(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  const normalized = normalizeLines(text);
  const joined = normalized.join('\n');

  const nameMatch = joined.match(/^#\s*(.+)$/m);
  const archetype = parseField(joined, 'Archetype');
  const tone = parseField(joined, 'Tone');
  const speechText = extractSection(joined, ['Speech patterns', 'Speech', 'Speech pattern']) || parseField(joined, 'Speech patterns');
  const valuesText = extractSection(joined, ['Values']) || parseField(joined, 'Values');
  const visualText = extractSection(joined, ['Visual aesthetic', 'Visual']) || parseField(joined, 'Visual aesthetic');
  const behaviorText = extractSection(joined, ['Behavior constraints', 'Behavior']) || parseField(joined, 'Behavior constraints');

  const values = parseSimpleList(valuesText || valuesText.replace(/,/, '\n'));
  const speech_patterns = parseSimpleList(speechText || speechText.replace(/,/, '\n'));
  const visual_aesthetic = parseSimpleList(visualText || visualText.replace(/,/, '\n'));
  const behavior_constraints = parseSimpleList(behaviorText || behaviorText.replace(/,/, '\n'));

  return {
    name: nameMatch ? nameMatch[1].trim() : 'Unnamed Agent',
    archetype: archetype || 'Builder',
    tone: tone || 'steady',
    speech_patterns,
    values,
    visual_aesthetic,
    behavior_constraints,
    raw_markdown: joined
  };
}

async function parseSoul(source) {
  if (!source) {
    return {
      name: 'Unnamed Agent',
      archetype: 'Builder',
      tone: 'steady',
      speech_patterns: ['clear and concise'],
      values: [],
      visual_aesthetic: [],
      behavior_constraints: [],
      raw_markdown: ''
    };
  }

  const hasPathLike = /\.\w+$/.test(String(source)) || /[/\\]/.test(String(source));
  const rawText = hasPathLike
    ? await fs.readFile(source, 'utf8')
    : String(source);

  return parseLinesToProfile(rawText);
}

function normalizeProfile(profile = {}) {
  return {
    ...profile,
    speech_patterns: Array.isArray(profile.speech_patterns) ? profile.speech_patterns : [],
    values: Array.isArray(profile.values) ? profile.values : [],
    visual_aesthetic: Array.isArray(profile.visual_aesthetic) ? profile.visual_aesthetic : [],
    behavior_constraints: Array.isArray(profile.behavior_constraints) ? profile.behavior_constraints : []
  };
}

module.exports = {
  parseSoul,
  parseLinesToProfile,
  normalizeProfile
};
