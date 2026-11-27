import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, el front llama a /api en su mismo origen y Vite lo pasa al backend.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // L1, 4: las librerías grandes van en archivos aparte, que el navegador guarda entre
        // versiones. El límite del aviso de 500 kB no se toca.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            // GR1, 0.5: @mantine/charts va en su grupo, no en este
            { name: 'mantine', test: /[\\/]node_modules[\\/]@mantine[\\/](?!charts[\\/])/ },
            { name: 'tanstack', test: /[\\/]node_modules[\\/]@tanstack[\\/]/ },
            // GR1, 0.5: los gráficos y lo que usan, aparte, y al final: un grupo se lleva también
            // las dependencias de lo que captura, y React y Mantine tienen que quedar en los suyos
            {
              name: 'charts',
              test: /[\\/]node_modules[\\/](@mantine[\\/]charts|recharts|@reduxjs|react-redux|redux|reselect|immer|d3-[a-z-]+|internmap|victory-vendor|decimal\.js-light|eventemitter3|es-toolkit|tiny-invariant)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
