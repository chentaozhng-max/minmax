/** 前后端共用的视图类型（只放纯类型，避免客户端引入服务端模块） */

export type SlotView = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  remaining: number;
  label: string;
};

export type ChatToolCallView = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
};

export type ChatMessageView = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ChatToolCallView[];
  createdAt: string;
};

export type ChatView = {
  mode: "llm" | "form";
  state: string;
  messages: ChatMessageView[];
  suggestedSlots: SlotView[];
  availableSlots: SlotView[];
  notice: string | null;
  blocked: { reason: string; message: string } | null;
  appointmentId: string | null;
};

export type AppointmentItem = {
  id: string;
  status: string;
  group: "pending" | "confirmed" | "checkin" | "done" | "cancelled";
  checkinCode: string | null;
  appealStatus: string | null;
  appealAt: string | null;
  checkedInAt: string | null;
  canCheckIn: boolean;
  canCancel: boolean;
  canAppeal: boolean;
  slot: { id: string; startAt: string; endAt: string };
  experiment: {
    id: string;
    title: string;
    location: string;
    rewardText: string;
    durationMin: number;
    researcher: { id: string; name: string; school: string | null };
  };
};

export type CreditInfo = {
  creditScore: number;
  noShowCount: number;
  bannedUntil: string | null;
  banned: boolean;
  role: string;
  events: { id: string; delta: number; reason: string; note: string | null; createdAt: string }[];
};
