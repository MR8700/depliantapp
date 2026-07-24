import { apiFetch, apiFetchForm } from "./client";
import { API_BASE_URL } from "../config";

export interface PieceJointeAEnvoyer {
  uri: string;
  name: string;
  type: string;
}

export interface Message {
  id: number;
  chorale_id: number;
  expediteur_type: "chorale" | "super";
  texte: string | null;
  piece_jointe_content_type: string | null;
  piece_jointe_filename: string | null;
  piece_jointe_size: number | null;
  lu: boolean;
  parent_id: number | null;
  reactions: Record<string, string[]>;
  modifie: boolean;
  supprime: boolean;
  created_at: string;
}

export interface FilThread {
  chorale_id: number;
  chorale_nom: string;
  dernier_message: { texte: string | null; expediteur_type: string; created_at: string } | null;
  non_lus: number;
}

export function listerThreadsAdmin(): Promise<FilThread[]> {
  return apiFetch<FilThread[]>("/messages/chorales");
}

export function listerMessages(choraleId?: number): Promise<Message[]> {
  return apiFetch<Message[]>(`/messages${choraleId ? `?chorale_id=${choraleId}` : ""}`);
}

export function envoyerMessage(params: { choraleId?: number; texte?: string; parentId?: number; pieceJointe?: PieceJointeAEnvoyer }): Promise<Message> {
  const form = new FormData();
  if (params.choraleId) form.append("chorale_id", String(params.choraleId));
  if (params.texte) form.append("texte", params.texte);
  if (params.parentId) form.append("parent_id", String(params.parentId));
  if (params.pieceJointe) form.append("piece_jointe", params.pieceJointe as any);
  return apiFetchForm<Message>("/messages", form, { method: "POST" });
}

export function urlPieceJointe(messageId: number): string {
  return `${API_BASE_URL}/messages/${messageId}/piece-jointe`;
}

export function modifierMessage(id: number, texte: string): Promise<Message> {
  const form = new FormData();
  form.append("texte", texte);
  return apiFetchForm<Message>(`/messages/${id}`, form, { method: "PUT" });
}

export function supprimerMessage(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/messages/${id}`, { method: "DELETE" });
}

export function toggleReaction(id: number, emoji: string): Promise<Message> {
  const form = new FormData();
  form.append("emoji", emoji);
  return apiFetchForm<Message>(`/messages/${id}/reactions`, form, { method: "POST" });
}

export function marquerLu(choraleId?: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/messages/lu${choraleId ? `?chorale_id=${choraleId}` : ""}`, { method: "POST" });
}

export function compterNonLus(choraleId?: number): Promise<{ non_lus: number }> {
  return apiFetch<{ non_lus: number }>(`/messages/non-lus${choraleId ? `?chorale_id=${choraleId}` : ""}`);
}
