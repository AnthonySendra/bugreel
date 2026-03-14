export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  ui: {
    theme: {
      colors: ['bugreel'],
    },
  },
  css: ['~/assets/css/main.css'],
  devServer: { port: 7777 },
  colorMode: { preference: 'dark' },
  nitro: {
    experimental: {
      wasm: false,
    },
    externals: {
      inline: [],
    },
  },
})
