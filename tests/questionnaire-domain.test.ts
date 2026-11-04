import { describe, expect, it } from "vitest";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  QuestionType,
  assertQuestionnaireReady,
  composeQuestionnaireFromText,
  formatAnswer,
  normalizeOptions,
  normalizeQuestionnaireDraft,
  passState,
  selectQualified,
  summarizeScores,
  thresholdText,
  validateAnswers,
  type QuestionForScoring,
} from "@/domain/questionnaire";

/**
 * 问卷链路的领域规则。
 *
 * 这几条都是「错了会直接坑到被试」的地方：
 * 拆题拆错 → 主试以为 AI 读懂了；校验漏了 → 空答卷入库；
 * 分数线判反 → 该发邀请的人没收到。
 */

const choice = (id: string, options: string[]): QuestionForScoring => ({
  id,
  type: QuestionType.SINGLE,
  title: "你倾向哪种？",
  options,
});

describe("composeQuestionnaireFromText 从正文拆题", () => {
  it("编号 + ABC 选项 → 单选题", () => {
    const draft = composeQuestionnaireFromText(
      ["1. 你平时会使用番茄工作法吗？", "A. 经常", "B. 偶尔", "C. 从不"].join("\n"),
    );
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0].type).toBe(QuestionType.SINGLE);
    expect(draft.questions[0].options).toEqual(["经常", "偶尔", "从不"]);
  });

  it("题干里有「多选」→ 多选题", () => {
    const draft = composeQuestionnaireFromText(
      ["2. 你在哪些场景下会拖延（多选）", "A. 写论文", "B. 复习考试"].join("\n"),
    );
    expect(draft.questions[0].type).toBe(QuestionType.MULTI);
  });

  it("量表关键词 → 量表题，默认 1–5", () => {
    const draft = composeQuestionnaireFromText("3. 请用 1-5 的量表评价你的睡眠质量");
    expect(draft.questions[0].type).toBe(QuestionType.SCALE);
    expect(draft.questions[0].scaleMin).toBe(1);
    expect(draft.questions[0].scaleMax).toBe(5);
  });

  it("没有编号但带问号的独立行 → 填空题", () => {
    const draft = composeQuestionnaireFromText("你最近一次熬夜是因为什么？");
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0].type).toBe(QuestionType.TEXT);
  });

  it("章节标题不会被当成题目", () => {
    const draft = composeQuestionnaireFromText(["第一部分 基本信息", "第二部分 睡眠情况"].join("\n"));
    expect(draft.questions).toHaveLength(0);
  });

  it("完全读不出结构时返回空，交给主试手写", () => {
    expect(composeQuestionnaireFromText("这是一份说明文档，没有题目。谢谢阅读。").questions).toHaveLength(0);
  });

  it("重复题目只留一条", () => {
    const draft = composeQuestionnaireFromText(["你睡得好吗？", "你睡得好吗？"].join("\n"));
    expect(draft.questions).toHaveLength(1);
  });

  it("题目数量有上限，不会因为文档很长就爆掉", () => {
    const text = Array.from({ length: 80 }, (_, i) => `${i + 1}. 这是第 ${i + 1} 道题目的题干`).join("\n");
    expect(composeQuestionnaireFromText(text).questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
  });
});

describe("normalizeOptions 选项清洗", () => {
  it("去空、去重、保序", () => {
    expect(normalizeOptions([" 常吃 ", "", "常吃", "偶尔"])).toEqual(["常吃", "偶尔"]);
  });

  it("非数组 → 空数组", () => {
    expect(normalizeOptions("A、B")).toEqual([]);
  });

  it("超出上限时截断", () => {
    const many = Array.from({ length: MAX_OPTIONS + 3 }, (_, i) => `选项${i}`);
    expect(normalizeOptions(many)).toHaveLength(MAX_OPTIONS);
  });
});

describe("assertQuestionnaireReady 发布前体检", () => {
  const ok = {
    title: "参与问卷",
    questions: [{ title: "你睡得好吗？", type: QuestionType.TEXT, options: [] as string[] }],
  };

  it("正常问卷放行", () => {
    expect(assertQuestionnaireReady(ok)).toBeNull();
  });

  it("没标题拦下", () => {
    expect(assertQuestionnaireReady({ ...ok, title: "   " })?.message).toContain("标题");
  });

  it("一道题都没有拦下", () => {
    expect(assertQuestionnaireReady({ ...ok, questions: [] })?.message).toContain("至少");
  });

  it("题干空着时点出第几题", () => {
    const draft = {
      ...ok,
      questions: [
        { title: "第一题", type: QuestionType.TEXT, options: [] as string[] },
        { title: "  ", type: QuestionType.TEXT, options: [] as string[] },
      ],
    };
    expect(assertQuestionnaireReady(draft)?.message).toContain("第 2 题");
  });

  it("选择题选项不足两个时点出第几题", () => {
    const draft = {
      ...ok,
      questions: [{ title: "你选哪个", type: QuestionType.SINGLE, options: ["只有一个"] }],
    };
    expect(assertQuestionnaireReady(draft)?.message).toContain("两个选项");
  });
});

describe("normalizeQuestionnaireDraft 把模型返回的脏数据拉回形状", () => {
  it("题干为空整题丢掉，题型别名能认出来", () => {
    const draft = normalizeQuestionnaireDraft({
      title: " 问卷 ",
      questions: [
        { type: "multi", title: "你会选哪些", options: ["A", "B"] },
        { type: "TEXT", title: "   " },
      ],
    });
    expect(draft.title).toBe("问卷");
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0].type).toBe(QuestionType.MULTI);
  });

  it("选择题不足两个选项时降级成填空，而不是丢掉", () => {
    const draft = normalizeQuestionnaireDraft({
      title: "问卷",
      questions: [{ type: "SINGLE", title: "你选哪个", options: ["只有一个"] }],
    });
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0].type).toBe(QuestionType.TEXT);
    expect(draft.questions[0].options).toEqual([]);
  });

  it("题目超过上限时截断", () => {
    const draft = normalizeQuestionnaireDraft({
      title: "问卷",
      questions: Array.from({ length: MAX_QUESTIONS + 5 }, (_, i) => ({
        type: "TEXT",
        title: `第 ${i + 1} 道题的题干够长了吧`,
      })),
    });
    expect(draft.questions).toHaveLength(MAX_QUESTIONS);
  });

  it("完全不是对象时给一份空问卷而不是抛错", () => {
    const draft = normalizeQuestionnaireDraft(null, "兜底标题");
    expect(draft.title).toBe("兜底标题");
    expect(draft.questions).toEqual([]);
  });
});

describe("validateAnswers 提交校验", () => {
  it("必填没填 → 拦下并指出第几题", () => {
    const rejection = validateAnswers([choice("q1", ["A", "B"])], {});
    expect(rejection?.message).toContain("第 1 题");
  });

  it("单选值不在选项里 → 拦下", () => {
    expect(validateAnswers([choice("q1", ["A", "B"])], { q1: "C" })).not.toBeNull();
  });

  it("多选里混进非法选项 → 拦下", () => {
    const questions: QuestionForScoring[] = [
      { id: "q1", type: QuestionType.MULTI, title: "会选哪些", options: ["A", "B"] },
    ];
    expect(validateAnswers(questions, { q1: ["A", "Z"] })).not.toBeNull();
    expect(validateAnswers(questions, { q1: ["A", "B"] })).toBeNull();
  });

  it("量表值超范围 → 拦下", () => {
    const questions: QuestionForScoring[] = [
      { id: "q1", type: QuestionType.SCALE, title: "睡眠质量", options: [] },
    ];
    expect(validateAnswers(questions, { q1: 9 })).not.toBeNull();
    expect(validateAnswers(questions, { q1: 3 })).toBeNull();
  });

  it("非必填留空放行", () => {
    const optional = { ...choice("q1", ["A", "B"]), required: false };
    expect(validateAnswers([optional], {})).toBeNull();
  });

  it("只填空格算没填", () => {
    expect(validateAnswers([{ id: "q1", type: QuestionType.TEXT, title: "原因", options: [] }], { q1: "   " })).not.toBeNull();
  });
});

describe("formatAnswer 给模型看的答案文本", () => {
  it("多选用顿号连起来", () => {
    expect(formatAnswer(choice("q1", ["A", "B"]), ["A", "B"])).toBe("A、B");
  });

  it("未作答统一成（未作答）", () => {
    expect(formatAnswer(choice("q1", ["A"]), undefined)).toBe("（未作答）");
    expect(formatAnswer(choice("q1", ["A"]), [])).toBe("（未作答）");
  });

  it("数字原样输出", () => {
    expect(formatAnswer({ id: "q1", type: "SCALE", title: "评分", options: [] }, 4)).toBe("4");
  });
});

describe("passState 分数线判定", () => {
  it("分数未知一律 UNKNOWN，不能默认通过", () => {
    expect(passState(null, 60)).toBe("UNKNOWN");
    expect(passState(undefined, 60)).toBe("UNKNOWN");
  });

  it("没设分数线也是 UNKNOWN", () => {
    expect(passState(80, null)).toBe("UNKNOWN");
  });

  it("等于分数线算通过", () => {
    expect(passState(60, 60)).toBe("PASS");
    expect(passState(59, 60)).toBe("FAIL");
  });
});

describe("selectQualified 该给谁发邀请", () => {
  const rows = [
    { id: "a", score: 90, passed: null },
    { id: "b", score: 55, passed: null },
    { id: "c", score: 30, passed: true }, // 主试手动放过
    { id: "d", score: 95, passed: false }, // 主试手动否掉
    { id: "e", score: null, passed: null }, // 还没算分
  ];

  it("按分数线挑，手动结论优先", () => {
    expect(selectQualified(rows, 60).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("没设分数线时谁都不发", () => {
    expect(selectQualified(rows, null)).toEqual([]);
  });

  it("重复调用不会改原数组", () => {
    const copy = [...rows];
    selectQualified(rows, 60);
    expect(rows).toEqual(copy);
  });
});

describe("summarizeScores 后台统计条", () => {
  it("分开统计已算分 / 未算分 / 通过 / 未通过", () => {
    const summary = summarizeScores(
      [
        { score: 80, passed: null },
        { score: 40, passed: null },
        { score: null, passed: null },
      ],
      60,
    );
    expect(summary.total).toBe(3);
    expect(summary.scored).toBe(2);
    expect(summary.unscored).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.unknown).toBe(1);
  });

  it("平均分四舍五入，最高最低取实际值", () => {
    const summary = summarizeScores([{ score: 70, passed: null }, { score: 85, passed: null }], 60);
    expect(summary.average).toBe(78);
    expect(summary.highest).toBe(85);
    expect(summary.lowest).toBe(70);
  });

  it("一份答卷都没有时不报错", () => {
    const summary = summarizeScores([], 60);
    expect(summary.average).toBeNull();
    expect(summary.total).toBe(0);
  });
});

describe("thresholdText 一句话说明门槛", () => {
  it("设了分数线说清楚是多少", () => {
    expect(thresholdText(60)).toBe("得分 ≥ 60 分");
  });

  it("没设时不能写成「≥ null」", () => {
    expect(thresholdText(null)).toBe("未设置分数线");
  });
});
