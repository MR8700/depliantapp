import { apiFetch } from "./client";
import { Identite, Meta } from "../types";

export function getMeta(): Promise<Meta> {
  return apiFetch<Meta>("/meta");
}

export function getIdentite(): Promise<Identite> {
  return apiFetch<Identite>("/auth/status");
}
