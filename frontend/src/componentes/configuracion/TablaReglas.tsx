import React, { useState } from 'react';
import { Table, Select, Text, Stack, Paper, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import { ModoAviso, ReglaAviso } from '../../api/tipos';
import { TIPOS_AVISO } from '../../lib/avisos';
import { mensajeError } from '../../lib/errores';

export interface TablaReglasProps {
  reglas: ReglaAviso[];
  onActualizado: () => void;
}

const OPCIONES_MODO = [
  { value: 'NUNCA', label: 'Nunca' },
  { value: 'SOLO_ALTA', label: 'Solo prioridad alta' },
  { value: 'SIEMPRE', label: 'Siempre' },
];

export function TablaReglas({ reglas, onActualizado }: TablaReglasProps) {
  // Guardando por clave `${tipo_evento}_${canal}`
  const [guardandoKey, setGuardandoKey] = useState<string | null>(null);

  const cambiarRegla = async (
    tipoEvento: string,
    canal: 'EMAIL' | 'WHATSAPP',
    nuevoModo: ModoAviso
  ) => {
    const key = `${tipoEvento}_${canal}`;
    setGuardandoKey(key);

    try {
      await clienteApi.put('/api/configuracion/avisos/reglas', {
        tipo_evento: tipoEvento,
        canal,
        modo: nuevoModo,
      });
      notifications.show({ message: 'Guardado.', color: 'green' });
      onActualizado();
    } catch (err) {
      notifications.show({
        message: mensajeError(err),
        color: 'red',
      });
    } finally {
      setGuardandoKey(null);
    }
  };

  // Mapa de reglas para acceso rápido
  const mapaReglas = new Map(reglas.map((r) => [r.tipo_evento, r]));

  return (
    <Paper withBorder radius="sm" p="md">
      <Stack gap="md">
        <Title order={4}>Qué se envía</Title>

        <Table verticalSpacing="sm" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: '50%' }}>Aviso</Table.Th>
              <Table.Th style={{ width: '25%' }}>Email</Table.Th>
              <Table.Th style={{ width: '25%' }}>WhatsApp</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {TIPOS_AVISO.map((tipo) => {
              const regla = mapaReglas.get(tipo.tipo_evento);
              const modoEmail = regla?.EMAIL || 'NUNCA';
              const modoWhatsApp = regla?.WHATSAPP || 'NUNCA';

              const guardandoEmail = guardandoKey === `${tipo.tipo_evento}_EMAIL`;
              const guardandoWhatsApp = guardandoKey === `${tipo.tipo_evento}_WHATSAPP`;

              return (
                <Table.Tr key={tipo.tipo_evento}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {tipo.nombre}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {tipo.destinatarios}
                    </Text>
                  </Table.Td>

                  <Table.Td>
                    <Select
                      size="sm"
                      data={OPCIONES_MODO}
                      value={modoEmail}
                      disabled={guardandoEmail}
                      onChange={(val) => {
                        if (val && val !== modoEmail) {
                          cambiarRegla(tipo.tipo_evento, 'EMAIL', val as ModoAviso);
                        }
                      }}
                      allowDeselect={false}
                    />
                  </Table.Td>

                  <Table.Td>
                    <Select
                      size="sm"
                      data={OPCIONES_MODO}
                      value={modoWhatsApp}
                      disabled={guardandoWhatsApp}
                      onChange={(val) => {
                        if (val && val !== modoWhatsApp) {
                          cambiarRegla(tipo.tipo_evento, 'WHATSAPP', val as ModoAviso);
                        }
                      }}
                      allowDeselect={false}
                    />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>

        <Text size="xs" c="dimmed">
          &apos;Solo prioridad alta&apos; manda las fallas de máquinas detenidas o de criticidad con
          prioridad alta, y las máquinas para confirmar.
        </Text>
      </Stack>
    </Paper>
  );
}
