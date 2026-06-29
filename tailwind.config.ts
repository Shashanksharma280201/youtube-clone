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
        // Core palette — calm light theme (kept for backward compat during migration)
        "yt-red":      "#7c3aed",  // violet — primary accent
        "yt-dark":     "#ECEEF3",  // page background — warm cool grey (calmer than white)
        "yt-surface":  "#ffffff",  // card / panel white — pops against yt-dark
        "yt-surface2": "#F4F6FC",  // secondary surface — info bars, input bg, inset panels
        "yt-hover":    "#E3E7F2",  // hover / input bg — clearly visible against cards
        "yt-text":     "#0f172a",  // primary text
        "yt-muted":    "#64748b",  // secondary text
        "yt-border":   "#CBD3E8",  // border — defined but calm blue-grey
        // Extra accent tokens
        "nb-violet": "#7c3aed",
        "nb-indigo": "#6366f1",
        "nb-cyan":   "#06b6d4",
        "nb-sky":    "#0ea5e9",
        "nb-green":  "#10b981",
        "nb-red":    "#ef4444",
        // shadcn/ui CSS-variable-based tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
  plugins: [require("tailwindcss-animate")],
};

export default config;
