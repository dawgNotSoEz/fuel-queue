/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // -------- Accessible light "warm & clear" surfaces --------
        canvas: '#f8fafc', // off-white app background
        surface: '#ffffff', // cards / popovers
        ink: '#0f172a', // dark slate — primary text (never pure black)
        muted: '#64748b', // secondary text
        faint: '#94a3b8', // tertiary / disabled
        line: '#e2e8f0', // cool gray borders

        // -------- Primary / secondary accents --------
        brand: {
          DEFAULT: '#1a56db', // deep blue (headers/buttons)
          dark: '#1e40af',
          soft: '#dbeafe',
          faint: '#eff6ff',
        },
        teal: {
          DEFAULT: '#0d9488',
          soft: '#ccfbf1',
        },

        // -------- Fuel type + health semantics --------
        cng: '#f97316', // orange
        ev: '#3b82f6', // blue
        broken: '#94a3b8', // greyed-out offline charger
        danger: {
          DEFAULT: '#dc2626',
          dark: '#b91c1c',
          soft: '#fee2e2',
        },
        success: {
          DEFAULT: '#16a34a',
          soft: '#dcfce7',
        },
        warn: {
          DEFAULT: '#d97706',
          soft: '#fef3c7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 10px 30px rgba(15, 23, 42, 0.08)',
        pop: '0 20px 50px rgba(15, 23, 42, 0.2)',
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};
