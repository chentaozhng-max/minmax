/**
 * 脚本化假 LLM —— 给测试、离线演示、以及「没配 key 时想跑通全流程」用。
 *
 * 用法：把一串预设回复喂进来，每次 chat() 按顺序取一条。
 * 用尽后抛错（而不是返回空），避免测试里悄悄跑成"什么都没发生"的假绿。
 *
 * 这是 LlmPort 的第二个实现 —— 领域层与 application 层完全不需要知道用的是它。
 */
import type { LlmMessage, LlmPort, LlmReply, LlmToolSpec } from "@/domain/ports/llm";

export type ScriptedTurn = {
  /** 这一轮的自然语言回复 */
  content: string;
  /** 这一轮要发起的工具调用（可省略） */
  toolCalls?: LlmReply["toolCalls"];
};

export type MockLlmOptions = {
  /** 预设的回复序列，按调用顺序消费 */
  script: ScriptedTurn[];
  /** 是否报告已配置（默认 true，让上层走 LLM 分支） */
  configured?: boolean;
  /** 记录每次收到的请求，便于断言 prompt 是否正确 */
  recorder?: { messages: LlmMessage[][]; tools: LlmToolSpec[][] };
};

export class MockLlm implements LlmPort {
  private cursor = 0;

  constructor(private readonly opts: MockLlmOptions) {}

  configured(): boolean {
    return this.opts.configured ?? true;
  }

  async chat(params: {
    messages: LlmMessage[];
    tools: LlmToolSpec[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LlmReply> {
    if (this.opts.recorder) {
      this.opts.recorder.messages.push(params.messages);
      this.opts.recorder.tools.push(params.tools);
    }

    const turn = this.opts.script[this.cursor];
    if (!turn) {
      throw new Error(
        `MockLlm 脚本已用尽（第 ${this.cursor + 1} 次调用，脚本只有 ${this.opts.script.length} 条）`,
      );
    }
    this.cursor += 1;

    return { content: turn.content, toolCalls: turn.toolCalls ?? [] };
  }

  /** 剩余脚本条数，测试里用来断言「没多调也没少调」 */
  remaining(): number {
    return Math.max(0, this.opts.script.length - this.cursor);
  }
}
