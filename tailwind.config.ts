import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core palette — clean light theme
        "yt-red":    "#7c3aed",  // violet — primary accent
        "yt-dark":   "#f8fafc",  // page background (slate-50)
        "yt-surface":"#ffffff",  // card / panel white
        "yt-hover":  "#f1f5f9",  // hover state (slate-100)
        "yt-text":   "#0f172a",  // primary text (slate-900)
        "yt-muted":  "#64748b",  // secondary text (slate-500)
        "yt-border": "#e2e8f0",  // border (slate-200)
        // Extra accent tokens
        "nb-violet": "#7c3aed",
        "nb-indigo": "#6366f1",
        "nb-cyan":   "#06b6d4",
        "nb-sky":    "#0ea5e9",
        "nb-green":  "#10b981",
        "nb-red":    "#ef4444",
      },
      boxShadow: {
        "card":      "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
        "card-md":   "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.05)",
        "card-hover":"0 8px 24px rgba(0,0,0,0.10), 0 3px 8px rgba(0,0,0,0.06)",
        "violet":    "0 0 0 3px rgba(124,58,237,0.15)",
        "violet-btn":"0 4px 14px rgba(124,58,237,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
