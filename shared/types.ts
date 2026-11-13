export interface Option {
  id: string;
  label: string;
  description: string;
  color?: string;
}

export interface Category {
  id: string;
  label: string;
  question: string;
  default: string;
  options: Option[];
}

export type Catalog = Category[];
export type Appearance = Record<string, string>;
export type ProviderMode = "demo" | "live" | "placeholder";
export interface Decision {
  category: string;
  choice: string;
  confidence: number | null;
}

export interface Generation {
  appearance: Appearance;
  decisions: Decision[];
  skin: string;
  mode: "demo" | "live";
  message: string;
}
