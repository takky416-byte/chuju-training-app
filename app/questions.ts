export type Domain = "数量・図形" | "文章・ことば" | "表・グラフ" | "理科・観察" | "社会・生活" | "論理・ルール";

export type Question = {
  id: string;
  domain: Domain;
  title: string;
  context?: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  timeLimitSeconds: number;
  explanation: string;
  skill: string;
  source: "custom";
};

export const DOMAINS: Domain[] = ["数量・図形", "文章・ことば", "表・グラフ", "理科・観察", "社会・生活", "論理・ルール"];
