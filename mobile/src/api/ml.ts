import { apiFetch } from "./client";

export function entrainerModele(): Promise<Record<string, any>> {
  return apiFetch<Record<string, any>>("/ml/train", { method: "POST" });
}
