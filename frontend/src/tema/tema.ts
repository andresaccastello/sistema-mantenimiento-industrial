import { createTheme, MantineColorsTuple } from '@mantine/core';

// Paleta SolGest (D-010): Escala emerald de 10 tonos
const marca: MantineColorsTuple = [
  '#ecfdf5',
  '#d1fae5',
  '#a7f3d0',
  '#6ee7b7',
  '#34d399',
  '#10b981',
  '#059669',
  '#047857',
  '#065f46',
  '#064e3b',
];

export const tema = createTheme({
  colors: {
    marca,
  },
  primaryColor: 'marca',
  primaryShade: 6, // #059669
  fontFamily: "'Inter Variable', -apple-system, 'Segoe UI', Roboto, sans-serif",
  defaultRadius: 'sm',
  components: {
    Card: {
      defaultProps: {
        bg: '#ffffff',
        withBorder: true,
      },
      styles: {
        root: {
          borderColor: 'rgba(0, 0, 0, 0.08)',
        },
      },
    },
    Paper: {
      defaultProps: {
        bg: '#ffffff',
      },
    },
  },
});
