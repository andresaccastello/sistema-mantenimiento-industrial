import React from 'react';
import { Modal, Text, Group, Button } from '@mantine/core';

export interface ConfirmarApagarEmailModalProps {
  abierto: boolean;
  pendientes: number;
  onConfirmar: () => void;
  onCancelar: () => void;
  cargando?: boolean;
}

export function ConfirmarApagarEmailModal({
  abierto,
  pendientes,
  onConfirmar,
  onCancelar,
  cargando,
}: ConfirmarApagarEmailModalProps) {
  return (
    <Modal
      opened={abierto}
      onClose={onCancelar}
      title="Desactivar avisos por email"
      size="sm"
    >
      <Text size="sm">
        Hay {pendientes} email{pendientes !== 1 ? 's' : ''} por salir. Si apagás el canal, se descartan.
      </Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onCancelar} disabled={cargando}>
          Cancelar
        </Button>
        <Button color="red" onClick={onConfirmar} loading={cargando}>
          Desactivar y descartar
        </Button>
      </Group>
    </Modal>
  );
}
