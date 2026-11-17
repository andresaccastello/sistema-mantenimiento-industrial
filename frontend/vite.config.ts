import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // L1, 4: las librerías grandes van en archivos aparte, que el navegador guarda entre
        // versiones. El límite del aviso de 500 kB no se toca.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: 'mantine', test: /[\\/]node_modules[\\/]@mantine[\\/]/ },
            { name: 'tanstack', test: /[\\/]node_modules[\\/]@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
});
