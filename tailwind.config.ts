import type { Config } from "tailwindcss";

/**
 * Brand tokens are the ONLY approved base colors:
 *   navy  #2F3976  (primary)
 *   red   #E53623  (restrained accent / destructive)
 *   paper #FDFCFF  (canvas / surface)
 * All other shades are controlled opacity/tints of these three.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#2F3976",
          red: "#E53623",
          paper: "#FDFCFF",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        // Restrained single/double-layer skeuomorphic depth.
        raised: "0 1px 0 0 rgba(253,252,255,0.7) inset, 0 1px 2px rgba(47,57,118,0.10), 0 6px 16px -8px rgba(47,57,118,0.22)",
        "raised-hover": "0 1px 0 0 rgba(253,252,255,0.8) inset, 0 2px 4px rgba(47,57,118,0.12), 0 10px 22px -10px rgba(47,57,118,0.28)",
        inset: "inset 0 1px 2px rgba(47,57,118,0.14), inset 0 0 0 1px rgba(47,57,118,0.06)",
        pressed: "inset 0 2px 4px rgba(47,57,118,0.20)",
        focus: "0 0 0 3px rgba(229,54,35,0.30)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.22,1,0.36,1)",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
