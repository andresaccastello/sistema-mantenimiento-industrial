import { useEffect, useState } from 'react';
import { Button, Group, Modal, Select, Stack, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { clienteApi } from '../../api/cliente';
import type { CuerpoDocumento, DocumentoMaquina, TipoDocumento } from '../../api/tipos';
import { mensajeError } from '../../lib/errores';
import { AYUDA_ENLACE_DOCUMENTO, TIPOS_DOCUMENTO, validarEnlaceDocumento } from '../../lib/documentos';

interface Props {
  maquinaId: number;
  /** null: cerrado; 'nuevo': alta; un documento: edición. */
  documento: null | 'nuevo' | DocumentoMaquina;
  onCerrar: () => void;
  onGuardado: () => void;
}

const OPCIONES_TIPO = TIPOS_DOCUMENTO.map((t) => ({ value: t.codigo, label: t.etiqueta }));

/** MQ1, 4.1: alta y edición de un documento de la máquina (solo el enlace). */
export function ModalDocumento({ maquinaId, documento, onCerrar, onGuardado }: Props) {
  const actual = documento !== null && documento !== 'nuevo' ? documento : null;
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoDocumento>('MANUAL');
  const [url, setUrl] = useState('');
  const [notas, setNotas] = useState('');
  const [errorTitulo, setErrorTitulo] = useState<string | null>(null);
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (documento === null) return;
    setErrorTitulo(null);
    setErrorUrl(null);
    setTitulo(actual?.titulo ?? '');
    setTipo(actual?.tipo ?? 'MANUAL');
    setUrl(actual?.url ?? '');
    setNotas(actual?.notas ?? '');
  }, [documento]);

  const guardar = async () => {
    const t = titulo.trim();
    const errT = t === '' ? 'Cargá el título' : null;
    const errU = validarEnlaceDocumento(url);
    setErrorTitulo(errT);
    setErrorUrl(errU);
    if (errT || errU) return;

    const cuerpo: CuerpoDocumento = { titulo: t, tipo, url: url.trim(), notas: notas.trim() || null };
    setGuardando(true);
    try {
      if (actual) {
        await clienteApi.patch<DocumentoMaquina>(`/api/documentos/${actual.id}`, cuerpo);
      } else {
        await clienteApi.post<DocumentoMaquina>(`/api/maquinas/${maquinaId}/documentos`, cuerpo);
      }
      notifications.show({ message: actual ? 'Documento guardado' : 'Documento agregado', color: 'green', autoClose: 2000 });
      onGuardado();
    } catch (err) {
      notifications.show({ message: mensajeError(err), color: 'red' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal opened={documento !== null} onClose={onCerrar} title={actual ? 'Editar documento' : 'Agregar documento'} centered>
      <Stack gap="md">
        <TextInput
          label="Título"
          placeholder="Por ejemplo, manual del fabricante"
          maxLength={150}
          required
          value={titulo}
          onChange={(e) => {
            setTitulo(e.currentTarget.value);
            setErrorTitulo(null);
          }}
          error={errorTitulo}
          data-autofocus
        />
        <Select
          label="Tipo"
          data={OPCIONES_TIPO}
          value={tipo}
          onChange={(v) => v && setTipo(v as TipoDocumento)}
          allowDeselect={false}
          required
        />
        <TextInput
          label="Enlace"
          description={AYUDA_ENLACE_DOCUMENTO}
          placeholder="https://"
          maxLength={1000}
          required
          value={url}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setErrorUrl(null);
          }}
          error={errorUrl}
        />
        <Textarea
          label="Notas"
          placeholder="Opcional"
          maxLength={500}
          rows={2}
          value={notas}
          onChange={(e) => setNotas(e.currentTarget.value)}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={guardando}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
