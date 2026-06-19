import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), basicSsl()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // ★ 允许局域网手机访问
    https: true, // ★ 手机端 getUserMedia 必须 HTTPS
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
