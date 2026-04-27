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
        "yt-red": "#FF0000",
        "yt-dark": "#0F0F0F",
        "yt-surface": "#212121",
        "yt-hover": "#3E3E3E",
        "yt-text": "#F1F1F1",
        "yt-muted": "#AAAAAA",
        "yt-border": "#3E3E3E",
      },
    },
  },
  plugins: [],
};

export default config;
