import type { StreamItem } from "@/types/stream";
import type { AgentProvider } from "@server/server/agent/agent-sdk-types";

export interface BranchableUserMessage {
  id: string;
  text: string;
  userMessageIndex: number;
}

export function extractBranchableUserMessages(streamItems: StreamItem[]): BranchableUserMessage[] {
  let index = 0;
  const result: BranchableUserMessage[] = [];

  for (const item of streamItems) {
    if (item.kind !== "user_message") {
      continue;
    }

    result.push({
      id: item.id,
      text: item.text,
      userMessageIndex: index,
    });
    index += 1;
  }

  return result;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function supportsNativeRewind(provider: AgentProvider | null | undefined): boolean {
  return provider === "claude";
}

export function buildRewindCommand(input: {
  provider: AgentProvider | null | undefined;
  selectedMessageId: string | null;
  latestUserMessageId: string | null;
}): string | null {
  const { provider, selectedMessageId, latestUserMessageId } = input;
  if (!supportsNativeRewind(provider) || !selectedMessageId) {
    return null;
  }
  if (selectedMessageId === latestUserMessageId) {
    return "/rewind";
  }
  if (UUID_PATTERN.test(selectedMessageId)) {
    return `/rewind ${selectedMessageId}`;
  }
  return null;
}
