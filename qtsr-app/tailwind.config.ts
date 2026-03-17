import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'cream': '#FFFDD0',
        'dark-green': '#2D5A3D',
      },
      fontFamily: {
        mono: ['Courier New', 'monospace'],
      },
      fontSize: {
        'xs': '0.75rem',
        'sm': '0.875rem',
        'base': '1rem',
        'lg': '1.125rem',
        'xl': '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
      },
      boxShadow: {
        'neo-sm': '4px_4px_0px_0px_rgba(0,0,0,1)',
        'neo-md': '8px_8px_0px_0px_rgba(0,0,0,1)',
        'neo-lg': '12px_12px_0px_0px_rgba(0,0,0,1)',
      },
    },
  },
  plugins: [],
}
export default config
