// ── Section parsing utility ──────────────────────────────────────────────────
// Used by: section-aware agents, claim tracker, word count indicators

export interface Section {
  heading: string;
  startIndex: number; // char index in full content
  endIndex: number;
  text: string;       // body text under this heading (excluding the heading line)
  wordCount: number;
  level: number;      // 1 = top-level, 2 = sub-heading
}

// Suggested word-count targets per section type (for academic papers)
export const SECTION_TARGETS: Record<string, number> = {
  'abstract': 200,
  'introduction': 400,
  'literature review': 600,
  'methodology': 400,
  'methods': 400,
  'results': 500,
  'discussion': 500,
  'conclusion': 300,
  'references': 0, // no target
};

/**
 * Parse a document into sections based on heading patterns.
 * Recognises: lines that are short (<80 chars), standalone, not indented,
 * and optionally wrapped in ** or starting with #.
 */
export function parseSections(content: string): Section[] {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  const sections: Section[] = [];
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect heading: short line, possibly **wrapped** or # prefixed, or just a
    // capitalised standalone line followed by a blank or content
    let heading: string | null = null;
    let level = 1;

    if (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 100) {
      heading = trimmed.replace(/\*\*/g, '').trim();
    } else if (trimmed.startsWith('# ')) {
      heading = trimmed.slice(2).trim();
    } else if (trimmed.startsWith('## ')) {
      heading = trimmed.slice(3).trim();
      level = 2;
    } else if (
      trimmed.length > 0 &&
      trimmed.length < 80 &&
      !line.startsWith('  ') &&
      !trimmed.startsWith('[') &&
      !trimmed.startsWith('(') &&
      !trimmed.match(/^[\d]/) &&
      !trimmed.match(/^[-•]/) &&
      // Must look like a heading: starts with uppercase, no period at end (unless very short)
      /^[A-Z]/.test(trimmed) &&
      !trimmed.endsWith('.') &&
      // Previous line is blank or this is the first line
      (i === 0 || lines[i - 1].trim() === '')
    ) {
      // Check if line after is blank or content (not another short line = sub-heading)
      heading = trimmed;
      if (line.startsWith('  ') || line.startsWith('\t')) level = 2;
    }

    if (heading) {
      // Close previous section
      if (sections.length > 0) {
        const prev = sections[sections.length - 1];
        prev.endIndex = charOffset;
        prev.text = content.slice(prev.startIndex + lines[getLineIndex(content, prev.startIndex)].length + 1, prev.endIndex).trim();
        prev.wordCount = countWords(prev.text);
      }
      sections.push({
        heading,
        startIndex: charOffset,
        endIndex: content.length, // will be updated
        text: '',
        wordCount: 0,
        level,
      });
    }

    charOffset += line.length + 1; // +1 for \n
  }

  // Close last section
  if (sections.length > 0) {
    const last = sections[sections.length - 1];
    last.endIndex = content.length;
    const headingLineEnd = content.indexOf('\n', last.startIndex);
    last.text = headingLineEnd >= 0 ? content.slice(headingLineEnd + 1, last.endIndex).trim() : '';
    last.wordCount = countWords(last.text);
  }

  return sections;
}

function getLineIndex(content: string, charOffset: number): number {
  return content.slice(0, charOffset).split('\n').length - 1;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Find which section a character offset falls within.
 */
export function findSectionAt(sections: Section[], charOffset: number): Section | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (charOffset >= sections[i].startIndex) return sections[i];
  }
  return null;
}

/**
 * Get a suggested word target for a section heading.
 */
export function getTargetWords(heading: string): number {
  const lower = heading.toLowerCase();
  for (const [key, target] of Object.entries(SECTION_TARGETS)) {
    if (lower.includes(key)) return target;
  }
  return 300; // default target for unknown sections
}
