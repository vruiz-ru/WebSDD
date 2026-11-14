/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        terracota: '#C17A56',
        salvia: '#8A9A5B',
        cobalto: '#4682B4',
      },
    },
  },
  plugins: [],
};
