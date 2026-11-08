import { Stack, SegmentedControl, Select, TextInput, Textarea, Text, Group } from '@mantine/core';
import { PersonaCostoOpcion, ProveedorOpcion, TipoCosto } from '../../api/tipos';
import { formatMoneda } from '../../lib/formato';
import { nombreCompleto } from '../../lib/personas';
import {
  BorradorCosto,
  CampoBorradorCosto,
  ErroresBorradorCosto,
  conValorHora,
  importeManoObra,
  llevaProveedor,
  validarHoras,
  validarValorHora,
} from '../../lib/costos';
import { CampoNumero } from '../CampoNumero';

export interface CamposBorradorCostoProps {
  tipo: TipoCosto;
  borrador: BorradorCosto;
  errores: ErroresBorradorCosto;
  /** Con la intervención finalizada, el motivo es uno para todas: el ajuste no muestra el suyo. */
  finalizada: boolean;
  personas?: PersonaCostoOpcion[];
  proveedores?: ProveedorOpcion[];
  /** Cambia los campos de la pestaña y borra el error de los campos indicados. */
  onCambio: (cambios: Partial<BorradorCosto>, limpiar: CampoBorradorCosto[]) => void;
  /** Interna/Externa: borra todos los errores de la pestaña, como antes. */
  onCambiarExterna: (externa: boolean) => void;
}

/**
 * Los campos de una pestaña del diálogo de costos (C1.2). Sin estado propio.
 */
export function CamposBorradorCosto({
  tipo,
  borrador: b,
  errores,
  finalizada,
  personas,
  proveedores,
  onCambio,
  onCambiarExterna,
}: CamposBorradorCostoProps) {
  const esManoObra = tipo === 'MANO_OBRA';
  const conProveedor = llevaProveedor(tipo, b);
  const calculado = conValorHora(tipo, b);
  const error = (campo: CampoBorradorCosto) => errores[campo] ?? null;

  // Importe calculado, como lo calcula la API
  const importeCalculado =
    calculado && !validarHoras(b.horas) && !validarValorHora(b.valorHora)
      ? importeManoObra(Number(b.horas), Number(b.valorHora))
      : null;

  return (
    <Stack gap="md">
      {esManoObra && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Quién trabajó
          </Text>
          <SegmentedControl
            value={b.externa ? 'externa' : 'interna'}
            onChange={(v) => onCambiarExterna(v === 'externa')}
            data={[
              { value: 'interna', label: 'Interna' },
              { value: 'externa', label: 'Externa' },
            ]}
          />
        </Stack>
      )}

      {esManoObra && !b.externa && (
        <Select
          label="Persona"
          placeholder="Elegí quién trabajó"
          required
          searchable
          data={(personas || []).map((p) => ({ value: String(p.id), label: `${nombreCompleto(p)} (${p.legajo})` }))}
          value={b.usuarioId}
          onChange={(v) => onCambio({ usuarioId: v }, ['persona'])}
          error={error('persona')}
        />
      )}

      {conProveedor && (
        <Select
          label="Proveedor"
          placeholder={esManoObra ? 'Elegí el proveedor' : 'Opcional'}
          required={esManoObra}
          clearable={!esManoObra}
          searchable
          data={(proveedores || []).map((p) => ({ value: String(p.id), label: p.nombre }))}
          value={b.proveedorId}
          onChange={(v) => onCambio({ proveedorId: v }, ['proveedor'])}
          error={error('proveedor')}
        />
      )}

      {esManoObra && (
        <Group grow align="flex-start">
          <CampoNumero
            label="Horas"
            required
            decimalScale={2}
            value={b.horas}
            onChange={(v) => onCambio({ horas: v }, ['horas', 'valorHora'])}
            error={error('horas')}
          />
          <CampoNumero
            label="Valor hora"
            placeholder="Opcional"
            prefix="$ "
            decimalScale={2}
            value={b.valorHora}
            onChange={(v) => onCambio({ valorHora: v }, ['valorHora'])}
            error={error('valorHora')}
          />
        </Group>
      )}

      {calculado && (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          Importe: <strong>{formatMoneda(importeCalculado)}</strong>
        </Text>
      )}

      {!calculado && (
        <CampoNumero
          label={esManoObra ? 'Importe total' : 'Importe'}
          description={tipo === 'AJUSTE' ? 'Puede ser negativo, por ejemplo un descuento.' : undefined}
          required
          prefix="$ "
          decimalScale={2}
          value={b.importe}
          onChange={(v) => onCambio({ importe: v }, ['importe'])}
          error={error('importe')}
        />
      )}

      <TextInput
        label="Descripción"
        placeholder={esManoObra ? 'Opcional' : 'Qué se pagó'}
        required={!esManoObra}
        maxLength={200}
        value={b.descripcion}
        onChange={(e) => onCambio({ descripcion: e.currentTarget.value }, ['descripcion'])}
        error={error('descripcion')}
      />

      {tipo === 'AJUSTE' && !finalizada && (
        <Textarea
          label="Motivo"
          placeholder="Mínimo 5 caracteres"
          required
          rows={2}
          maxLength={500}
          value={b.motivo}
          onChange={(e) => onCambio({ motivo: e.currentTarget.value }, ['motivo'])}
          error={error('motivo')}
        />
      )}
    </Stack>
  );
}
