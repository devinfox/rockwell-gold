"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rm-theme");
      if (saved === "light" || saved === "dark") {
        // localStorage is only readable after mount (SSR renders the default).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
        return;
      }
    } catch (e) {}
    const current = document.documentElement.getAttribute("data-theme") as "light" | "dark" | null;
    if (current) setTheme(current);
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("rm-theme", next);
    } catch (e) {}
  };

  return (
    <button
      type="button"
      className="theme"
      data-theme-toggle=""
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={theme === "light"}
      title="Terminal mode — light / dark"
    >
      <svg className="theme__icon theme__moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <svg className="theme__icon theme__sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
