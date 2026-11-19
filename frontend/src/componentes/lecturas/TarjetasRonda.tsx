import { Group, Paper, Stack, Text } from '@mantine/core';
import { tareaMasCercana, textoTareaRonda, textoUltimaRonda } from '../../lib/lecturas';
import { CampoLectura, ChipPorUso, InsigniaAtrasado, ResultadoGuardado } from './PiezasRonda';
import type { VistaRondaProps } from './TablaRonda';

/**
 * LE1, 4.3: la ronda en el celular, una tarjeta por medidor: la máquina y el medidor, la
 * última lectura, la tarea más cercana y el campo grande, con el teclado numérico.
 */
export function TarjetasRonda({ medidores, valores, onCambiarValor, errores, guardados, puedeCargar, guardando }: VistaRondaProps) {
  return (
    <Stack gap="sm">
      {medidores.map((m) => {
        const cercana = tareaMasCercana(m.tareas);
        return (
          <Paper key={m.id} withBorder radius="md" p="sm">
            <Stack gap={6}>
              <div>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  {m.maquina.codigo ? `${m.maquina.codigo} · ${m.maquina.nombre}` : m.maquina.nombre}
                </Text>
                <Text size="md" fw={700}>
                  {m.nombre}
                </Text>
              </div>
              <Group gap="xs" wrap="wrap">
                <Text size="sm" c={m.ultima ? undefined : 'dimmed'}>
                  {textoUltimaRonda(m)}
                </Text>
                {m.atraso_por_dias && <InsigniaAtrasado />}
                {m.atraso_por_uso && <ChipPorUso />}
              </Group>
              <Text size="sm" c={cercana ? undefined : 'dimmed'}>
                {cercana ? textoTareaRonda(cercana, m.unidad) : 'Sin tareas que lo usen'}
              </Text>
              {puedeCargar && (
                <CampoLectura
                  medidor={m}
                  valor={valores[m.id] ?? undefined}
                  onCambiar={(v) => onCambiarValor(m.id, v)}
                  error={errores[m.id] ?? null}
                  grande
                  deshabilitado={guardando}
                />
              )}
              {guardados[m.id] && <ResultadoGuardado consecuencias={guardados[m.id]} />}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
