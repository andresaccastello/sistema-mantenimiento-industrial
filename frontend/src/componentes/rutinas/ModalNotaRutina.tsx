import { useEffect, useState } from 'react';
import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';

interface Props {
  /** La descripción de la tarea que se marca; null: cerrado. */
  descripcion: string | null;
  guardando: boolean;
  onCerrar: () => void;
  onMarcar: (nota: string) => void;
}

/** RT1, 4: "Con nota": un modal chico con la nota y "Marcar hecha". */
export function ModalNotaRutina({ descripcion, guardando, onCerrar, onMarcar }: Props) {
  const [nota, setNota] = useState('');
  useEffect(() => {
    if (descripcion !== null) setNota('');
  }, [descripcion]);

  return (
    <Modal opened={descripcion !== null} onClose={onCerrar} title="Marcar con nota" centered>
      <Stack gap="md">
        <Text size="sm" c="var(--sm-texto-medio)">
          {descripcion}
        </Text>
        <Textarea
          label="Nota"
          placeholder="Cargá lo que viste, si hace falta"
          autosize
          minRows={3}
          maxLength={500}
          value={nota}
          onChange={(e) => setNota(e.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCerrar} mih={44}>
            Cancelar
          </Button>
          <Button onClick={() => onMarcar(nota)} loading={guardando} mih={44}>
            Marcar hecha
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
