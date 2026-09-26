"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getUserId, setUserId } from "@/lib/api";
import type { User } from "@/lib/types";

/** "bloom" = sunset theme (sandbox / org views), "calm" = sober theme reserved for production screens. */
export type Variant = "bloom" | "calm";

interface ShellState {
  dark: boolean;
  toggleDark: () => void;
  variant: Variant;
  setVariant: (v: Variant) => void;
  me: User | null;
  users: User[];
  switchUser: (id: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
}

const Ctx = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [variant, setVariant] = useState<Variant>("bloom");
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try {
      setDark(localStorage.getItem("dryrun.dark") === "1");
    } catch {
      /* default light */
    }
    api<User[]>("/api/users")
      .then((list) => {
        setUsers(list);
        setMe(list.find((u) => u.id === getUserId()) ?? list[0] ?? null);
      })
      .catch(() => setMe(null));
  }, []);

  const toggleDark = () =>
    setDark((d) => {
      try {
        localStorage.setItem("dryrun.dark", d ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !d;
    });

  const switchUser = (id: string) => {
    setUserId(id);
    setMe(users.find((u) => u.id === id) ?? null);
    window.location.reload();
  };

  return (
    <Ctx.Provider value={{ dark, toggleDark, variant, setVariant, me, users, switchUser, paletteOpen, setPaletteOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export function useShell() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell outside ShellProvider");
  return v;
}

/** Pages call this to opt into the calm production theme. */
export function useVariant(v: Variant) {
  const { setVariant } = useShell();
  useEffect(() => {
    setVariant(v);
    return () => setVariant("bloom");
  }, [v, setVariant]);
}
