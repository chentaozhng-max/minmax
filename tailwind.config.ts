import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        moss: "var(--moss)",
        "moss-deep": "var(--moss-deep)",
        "moss-tint": "var(--moss-tint)",
        clay: "var(--clay)",
        "clay-tint": "var(--clay-tint)",
        line: "var(--line)",
        mist: "var(--mist)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        verify: "var(--verify)",
        "verify-tint": "var(--verify-tint)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "15px" }],
        xs: ["12px", { lineHeight: "17px" }],
        sm: ["13px", { lineHeight: "19px" }],
        base: ["15px", { lineHeight: "23px" }],
        lg: ["17px", { lineHeight: "25px" }],
        xl: ["20px", { lineHeight: "28px" }],
        "2xl": ["24px", { lineHeight: "32px" }],
        "3xl": ["30px", { lineHeight: "37px" }],
        "4xl": ["38px", { lineHeight: "42px", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        card: "12px",
        pill: "22px",
      },
      boxShadow: {
        lift: "0 1px 2px rgba(23,32,30,.04), 0 8px 24px -16px rgba(23,32,30,.24)",
      },
      keyframes: {
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 var(--moss-tint)" },
          "70%": { boxShadow: "0 0 0 6px transparent" },
          "100%": { boxShadow: "0 0 0 0 transparent" },
        },
      },
      animation: {
        "rise-in": "rise-in .32s cubic-bezier(.2,.7,.3,1) both",
        "pulse-ring": "pulse-ring 2.4s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
