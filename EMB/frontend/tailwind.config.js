/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'poppins': ['Poppins', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
      },
      colors: {
        'helix': {
          'dark': '#1E293B',
          'navy': '#0B172B',
          'blue': '#148DD8',
          'purple': '#945AF6',
          'pink': '#CE4EC2',
          'gray': {
            100: '#F6F7FE',
            200: '#EEF1F8',
            300: '#E9EDF6',
            400: '#DCE5EF',
            500: '#9BAABD',
            600: '#64748B',
            700: '#5B6983',
            800: '#101834',
          }
        }
      }
    },
  },
  plugins: [],
}

