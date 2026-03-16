/**
 * AI utilities — CLI 출력에서 JSON 추출 등
 *
 * CLI subprocess의 stdout에는 ANSI 코드, 경고, 진행률 등이 섞여 나온다.
 * extractJSON()으로 이 노이즈를 필터링하고 유효한 JSON만 추출한다.
 */

/**
 * Extract JSON from a string that may contain ANSI codes, warnings, etc.
 * Finds the first valid JSON object or array in the string.
 */
export function extractJSON<T = unknown>(raw: string): T {
  // Strip ANSI escape codes
  const stripped = raw.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );

  // Try the whole string first
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Fall through
  }

  // Find JSON object or array boundaries
  const patterns = [
    findBracketPair(stripped, "{", "}"),
    findBracketPair(stripped, "[", "]"),
  ].filter((s): s is string => s !== null);

  for (const candidate of patterns) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  throw new Error(`No valid JSON found in output (${stripped.length} chars)`);
}

function findBracketPair(
  text: string,
  open: string,
  close: string,
): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}
