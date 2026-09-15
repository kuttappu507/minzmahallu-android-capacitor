/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        em: {
          DEFAULT: "var(--em)",
          d: "var(--emd)",
          dd: "var(--emdd)",
        },
        canvas: "var(--bg)",
        panel: "var(--panel)",
        panel2: "var(--panel2)",
        head: "var(--head)",
        line: "var(--line)",
        line2: "var(--line2)",
        tx: "var(--tx)",
        mut: "var(--mut)",
        fnt: "var(--fnt)",
        selbg: "var(--selbg)",
        "rose-bg": "var(--rose-bg)",
        "rose-line": "var(--rose-line)",
        "c-em": "var(--c-em)",
        "c-gold": "var(--c-gold)",
        "c-sky": "var(--c-sky)",
        "c-rose": "var(--c-rose)",
      },
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
        display: ["Poppins", "system-ui", "sans-serif"],
        malayalam: ["Gayathri", "Poppins", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        soft: "var(--sh)",
        lift: "var(--shl)",
      },
      backgroundImage: {
        "dot-pattern": "var(--dot)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
