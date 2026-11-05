export type V2Card = {
  tool: string;
  args: Record<string, unknown>;
  token: string;
  mutationId: string;
  schoolId: string;
  destination: string;
};

export type V2Step = { name: string; status: string; summary: string };

export type V2Reply = {
  answer: string;
  steps: V2Step[];
  cards: V2Card[];
  simulation?: boolean;
};

export type V2Turn = { question: string; reply: V2Reply };

export type DueItem = {
  title: string;
  course?: string;
  dueLabel: string;
};
