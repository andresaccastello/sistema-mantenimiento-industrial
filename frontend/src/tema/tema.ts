import { createTheme, CSSVariablesResolver, MantineColorsTuple } from '@mantine/core';

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
        bg: 'var(--sm-superficie)',
        withBorder: true,
      },
      styles: {
        root: {
          borderColor: 'var(--sm-borde-suave)',
        },
      },
    },
    Paper: {
      defaultProps: {
        bg: 'var(--sm-superficie)',
      },
    },
  },
});

/**
 * D1, 5: los colores propios del sistema, con su versión clara y oscura. En claro son
 * exactamente los que estaban escritos a mano en las pantallas, para que nada cambie.
 * Es el único lugar con colores escritos a mano, además de la paleta `marca`.
 */
export const variablesTema: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--sm-titulo': '#0f172a',
    '--sm-texto-fuerte': '#1e293b',
    '--sm-texto': '#334155',
    '--sm-texto-medio': '#475569',
    '--sm-tenue': '#64748b',
    '--sm-muy-tenue': '#94a3b8',
    '--sm-superficie': '#ffffff',
    '--sm-fondo': '#f8fafc',
    '--sm-separador': '#f1f5f9',
    '--sm-borde': '#e2e8f0',
    '--sm-borde-suave': 'rgba(0, 0, 0, 0.08)',
    '--sm-sombra': 'rgba(0, 0, 0, 0.05)',
    '--sm-marca-suave': '#ecfdf5',
    '--sm-no-leida': '#f0fdf4',
    '--sm-no-leida-borde': '#bbf7d0',
    '--sm-exito': '#16a34a',
    '--sm-peligro': '#dc2626',
    '--sm-info': '#0284c7',
    '--sm-fondo-grupo': 'var(--mantine-color-gray-0)',
    '--sm-fondo-grupo-2': 'var(--mantine-color-gray-1)',
    '--sm-linea': 'var(--mantine-color-gray-2)',
    '--sm-texto-oscuro': 'var(--mantine-color-dark-text)',
    '--sm-aviso-texto': 'var(--mantine-color-orange-8)',
    '--sm-marca-texto': 'var(--mantine-color-marca-8)',
  },
  dark: {
    '--sm-titulo': '#f1f5f9',
    '--sm-texto-fuerte': '#e2e8f0',
    '--sm-texto': '#cbd5e1',
    '--sm-texto-medio': '#b4bfcd',
    '--sm-tenue': '#94a3b8',
    '--sm-muy-tenue': '#7c8ba1',
    '--sm-superficie': 'var(--mantine-color-dark-6)',
    '--sm-fondo': 'var(--mantine-color-dark-7)',
    '--sm-separador': 'var(--mantine-color-dark-4)',
    '--sm-borde': 'var(--mantine-color-dark-4)',
    '--sm-borde-suave': 'rgba(255, 255, 255, 0.1)',
    '--sm-sombra': 'rgba(0, 0, 0, 0.4)',
    '--sm-marca-suave': 'rgba(16, 185, 129, 0.15)',
    '--sm-no-leida': 'rgba(16, 185, 129, 0.12)',
    '--sm-no-leida-borde': 'rgba(16, 185, 129, 0.4)',
    '--sm-exito': '#4ade80',
    '--sm-peligro': '#f87171',
    '--sm-info': '#38bdf8',
    '--sm-fondo-grupo': 'var(--mantine-color-dark-5)',
    '--sm-fondo-grupo-2': 'var(--mantine-color-dark-5)',
    '--sm-linea': 'var(--mantine-color-dark-4)',
    '--sm-texto-oscuro': '#e2e8f0',
    '--sm-aviso-texto': 'var(--mantine-color-orange-4)',
    '--sm-marca-texto': 'var(--mantine-color-marca-3)',
  },
});
