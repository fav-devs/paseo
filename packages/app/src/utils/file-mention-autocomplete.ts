export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

export interface EnvMentionRange {
  start: number;
  end: number;
  /** Full text after `@`, including `env:` / `secret:` prefix and partial alias. */
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

function isEnvMentionQuery(query: string): boolean {
  return query.startsWith("env:") || query.startsWith("secret:");
}

export function findActiveEnvMention(input: FindActiveFileMentionInput): EnvMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    const query = beforeCursor.slice(atIndex + 1);
    if (!isEnvMentionQuery(query)) {
      continue;
    }
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    const query = beforeCursor.slice(atIndex + 1);
    if (isEnvMentionQuery(query)) {
      continue;
    }
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

export function applyFileMentionReplacement(input: ApplyFileMentionReplacementInput): string {
  const safePath = input.relativePath.replace(/"/g, '\\"');
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}"${safePath}"${after}`;
}

interface ApplyEnvMentionReplacementInput {
  text: string;
  mention: EnvMentionRange;
  alias: string;
}

export function applyEnvMentionReplacement(input: ApplyEnvMentionReplacementInput): string {
  const safeAlias = input.alias.trim();
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}@env:${safeAlias}${after}`;
}
