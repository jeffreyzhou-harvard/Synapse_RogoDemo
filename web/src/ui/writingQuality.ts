// ── Writing Quality Indicators ───────────────────────────────────────────────
// Client-side readability, passive voice, and jargon analysis per section.

export interface QualityMetrics {
  readabilityScore: number;   // Flesch-Kincaid grade level
  readabilityLabel: string;   // e.g. "Easy", "Academic", "Graduate"
  passiveVoicePct: number;    // 0–100
  avgSentenceLength: number;
  jargonDensity: number;      // 0–100 rough %
  suggestions: string[];
}

// ── Flesch–Kincaid Grade Level ───────────────────────────────────────────────

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 2) return 1;
  // Remove silent e
  word = word.replace(/e$/, '');
  const vowelGroups = word.match(/[aeiouy]+/g);
  const count = vowelGroups ? vowelGroups.length : 1;
  return Math.max(1, count);
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length > 0);
}

export function fleschKincaidGrade(text: string): number {
  const sentences = splitSentences(text);
  const words = splitWords(text);
  if (sentences.length === 0 || words.length === 0) return 0;

  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const avgWordsPerSentence = words.length / sentences.length;
  const avgSyllablesPerWord = totalSyllables / words.length;

  const grade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

function gradeLabel(grade: number): string {
  if (grade <= 6) return 'Easy';
  if (grade <= 8) return 'Standard';
  if (grade <= 10) return 'Moderate';
  if (grade <= 13) return 'Academic';
  return 'Graduate+';
}

// ── Passive Voice Detection ──────────────────────────────────────────────────

const PASSIVE_PATTERNS = [
  /\b(is|are|was|were|been|being|be)\s+([\w]+ed|[\w]+en|[\w]+t)\b/gi,
  /\b(has|have|had)\s+been\s+\w+/gi,
  /\b(will|shall|would|should|could|might|may|must)\s+be\s+\w+/gi,
];

function detectPassiveVoice(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;

  let passiveCount = 0;
  for (const sentence of sentences) {
    for (const pattern of PASSIVE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(sentence)) {
        passiveCount++;
        break;
      }
    }
  }
  return Math.round((passiveCount / sentences.length) * 100);
}

// ── Jargon / Complex Word Density ────────────────────────────────────────────

const COMMON_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
  'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by',
  'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all',
  'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
  'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them',
  'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over',
  'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day',
  'most', 'us', 'are', 'is', 'was', 'were', 'been', 'has', 'had', 'does', 'did',
  'more', 'very', 'much', 'many', 'such', 'each', 'every', 'both', 'few', 'should',
  'may', 'might', 'must', 'need', 'still', 'find', 'here', 'thing', 'through',
  'long', 'too', 'same', 'show', 'while', 'however', 'found', 'between', 'used',
  'study', 'research', 'data', 'paper', 'based', 'using', 'results', 'analysis',
  'method', 'approach', 'process', 'system', 'model', 'been', 'those', 'where',
  'before', 'since', 'been', 'being', 'during', 'without', 'within', 'under', 'upon',
]);

function jargonDensity(text: string): number {
  const words = splitWords(text);
  if (words.length === 0) return 0;

  let complexCount = 0;
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length >= 4 && countSyllables(clean) >= 3 && !COMMON_WORDS.has(clean)) {
      complexCount++;
    }
  }
  return Math.round((complexCount / words.length) * 100);
}

// ── Main Analysis ────────────────────────────────────────────────────────────

export function analyzeWritingQuality(text: string): QualityMetrics {
  if (!text.trim()) {
    return {
      readabilityScore: 0,
      readabilityLabel: '—',
      passiveVoicePct: 0,
      avgSentenceLength: 0,
      jargonDensity: 0,
      suggestions: [],
    };
  }

  const grade = fleschKincaidGrade(text);
  const passive = detectPassiveVoice(text);
  const jargon = jargonDensity(text);
  const sentences = splitSentences(text);
  const words = splitWords(text);
  const avgSentLen = sentences.length > 0 ? Math.round(words.length / sentences.length) : 0;

  const suggestions: string[] = [];

  if (grade > 14) suggestions.push('Very complex — consider simpler phrasing for broader accessibility.');
  else if (grade < 8 && words.length > 50) suggestions.push('Reads very simply — consider adding more nuance for academic rigor.');

  if (passive > 40) suggestions.push(`${passive}% passive voice — try converting some sentences to active voice.`);
  if (avgSentLen > 30) suggestions.push(`Long sentences (avg ${avgSentLen} words) — consider breaking some up.`);
  if (jargon > 25) suggestions.push('High jargon density — ensure all technical terms are defined.');

  return {
    readabilityScore: grade,
    readabilityLabel: gradeLabel(grade),
    passiveVoicePct: passive,
    avgSentenceLength: avgSentLen,
    jargonDensity: jargon,
    suggestions,
  };
}
