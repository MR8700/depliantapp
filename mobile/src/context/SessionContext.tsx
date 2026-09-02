import { createContext, useContext } from "react";

const SessionContext = createContext<{ onDeconnecte: () => void } | null>(null);

export function SessionProvider({ children, onDeconnecte }: { children: React.ReactNode; onDeconnecte: () => void }) {
  return <SessionContext.Provider value={{ onDeconnecte }}>{children}</SessionContext.Provider>;
}

export function useSession(): { onDeconnecte: () => void } {
  const contexte = useContext(SessionContext);
  if (!contexte) throw new Error("useSession doit être utilisé sous SessionProvider");
  return contexte;
}
