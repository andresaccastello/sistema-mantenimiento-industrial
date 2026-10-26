import React, { useState, useEffect } from 'react';
import { fetchApi } from './api';

interface Sector {
  id: number;
  nombre: string;
}

interface Maquina {
  id: number;
  nombre: string;
  codigo?: string;
  estado: string;
  sector: Sector;
}

interface HistorialItem {
  id: number;
  estado_anterior: string | null;
  estado_nuevo: string;
  observacion: string | null;
  cambiado_en: string;
  cambiado_por: {
    id: number;
    legajo: string;
    nombre: string;
  };
}

interface PeriodoDetencion {
  id: number;
  desde: string;
  hasta: string | null;
  esta_abierto: boolean;
  observacion: string | null;
  abierto_por: { id: number; nombre: string };
  confirmado_por: { id: number; nombre: string } | null;
}

interface AuditoriaItem {
  id: number;
  tipo_evento: string;
  campo_modificado: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  motivo: string | null;
  creado_en: string;
  realizado_por: {
    id: number;
    legajo: string;
    nombre: string;
  };
}

interface ResponsableHabilitado {
  id: number;
  legajo: string;
  nombre: string;
}

function traducirMotivoEliminacion(m: string): string {
  switch (m) {
    case 'ESTADO_NO_PENDIENTE':
      return 'El estado actual no es PENDIENTE.';
    case 'TIENE_FECHA_INICIO':
      return 'La intervención registra fecha de inicio de trabajo.';
    case 'TIENE_COSTOS':
      return 'Existen renglones de costos asociados (incluso anulados).';
    case 'TIENE_REPUESTOS':
      return 'Existen repuestos asociados a la intervención.';
    case 'TIENE_MOVIMIENTOS_STOCK':
      return 'Existen movimientos de stock vinculados.';
    case 'TIENE_DOCUMENTOS':
      return 'Existen documentos adjuntos asociados.';
    case 'TIENE_HISTORIAL':
      return 'El historial de estados registra actividad más allá del alta inicial.';
    default:
      return m;
  }
}

interface Intervencion {
  id: number;
  descripcion: string;
  estado: string;
  ejecucion: string | null;
  trabajo_realizado?: string | null;
  tiempo_inactividad_minutos?: number | null;
  fecha_inicio?: string | null;
  fecha_finalizacion?: string | null;
  fecha_creacion: string;
  detiene_maquina_actualmente: boolean;
  eliminada?: boolean;
  eliminado_en?: string | null;
  eliminado_por?: {
    id: number;
    legajo: string;
    nombre: string;
  } | null;
  motivo_eliminacion?: string | null;
  maquina: Maquina;
  creado_por: {
    id: number;
    legajo: string;
    nombre: string;
  };
  responsable: {
    id: number;
    legajo: string;
    nombre: string;
  } | null;
}

interface IntervencionDetalle extends Intervencion {
  observaciones: string | null;
  historial_estados: HistorialItem[];
  periodos_detencion: PeriodoDetencion[];
  auditoria: AuditoriaItem[];
}

interface IntervencionesProps {
  initialIntervencionId?: number | null;
}

export function Intervenciones({ initialIntervencionId }: IntervencionesProps = {}) {
  const [intervenciones, setIntervenciones] = useState<Intervencion[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);
  const [incluirEliminadas, setIncluirEliminadas] = useState(false);
  const [puedeVerEliminadas, setPuedeVerEliminadas] = useState(true);

  // Formulario de nueva falla
  const [showModal, setShowModal] = useState(false);
  const [selectedMaquinaId, setSelectedMaquinaId] = useState<number | ''>('');
  const [descripcion, setDescripcion] = useState('');
  const [detieneMaquina, setDetieneMaquina] = useState(true);
  const [observaciones, setObservaciones] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Modal de detalle
  const [selectedIntervencion, setSelectedIntervencion] = useState<IntervencionDetalle | null>(null);
  const [_loadingDetalle, setLoadingDetalle] = useState(false);

  // Operaciones de motor de estados
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<{ codigo: string; mensaje: string; motivos?: string[] } | null>(null);

  // Sub-modal Asignar / Reasignar
  const [showAsignarModal, setShowAsignarModal] = useState(false);
  const [responsablesHabilitados, setResponsablesHabilitados] = useState<ResponsableHabilitado[]>([]);
  const [selectedResponsableId, setSelectedResponsableId] = useState<number | ''>('');
  const [asignarMotivo, setAsignarMotivo] = useState('');

  // Sub-modal Quitar Responsable
  const [showQuitarModal, setShowQuitarModal] = useState(false);
  const [quitarMotivo, setQuitarMotivo] = useState('');

  // Sub-modal Pasar a Espera de Repuestos
  const [showEsperaModal, setShowEsperaModal] = useState(false);
  const [esperaObservacion, setEsperaObservacion] = useState('');

  // Modales Etapa 4B
  // 1. Finalizar
  const [showFinalizarModal, setShowFinalizarModal] = useState(false);
  const [trabajoFinalizar, setTrabajoFinalizar] = useState('');
  const [ejecucionFinalizar, setEjecucionFinalizar] = useState<'INTERNA' | 'EXTERNA'>('INTERNA');
  const [fechaFinFinalizar, setFechaFinFinalizar] = useState('');
  const [recupFinalizar, setRecupFinalizar] = useState(false);
  const [recupObsFinalizar, setRecupObsFinalizar] = useState('');

  // 2. Resolver ahora
  const [showResolverModal, setShowResolverModal] = useState(false);
  const [fechaInicioResolver, setFechaInicioResolver] = useState('');
  const [trabajoResolver, setTrabajoResolver] = useState('');
  const [ejecucionResolver, setEjecucionResolver] = useState<'INTERNA' | 'EXTERNA'>('INTERNA');
  const [fechaFinResolver, setFechaFinResolver] = useState('');
  const [recupResolver, setRecupResolver] = useState(false);
  const [recupObsResolver, setRecupObsResolver] = useState('');

  // 3. Cancelar
  const [showCancelarModal, setShowCancelarModal] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState('');
  const [recupCancelar, setRecupCancelar] = useState(false);
  const [recupObsCancelar, setRecupObsCancelar] = useState('');

  // 4. Registrar detención
  const [showDetencionModal, setShowDetencionModal] = useState(false);
  const [detencionObs, setDetencionObs] = useState('');
  const [detencionDesde, setDetencionDesde] = useState('');

  // Modales Etapa 6
  // 1. Reabrir
  const [showReabrirModal, setShowReabrirModal] = useState(false);
  const [motivoReabrir, setMotivoReabrir] = useState('');
  const [detenidaReabrir, setDetenidaReabrir] = useState(false);
  const [desdeReabrir, setDesdeReabrir] = useState('');
  const [obsDetencionReabrir, setObsDetencionReabrir] = useState('');

  // 2. Eliminar
  const [showEliminarModal, setShowEliminarModal] = useState(false);
  const [motivoEliminar, setMotivoEliminar] = useState('');
  const [recupEliminar, setRecupEliminar] = useState(true);
  const [obsRecupEliminar, setObsRecupEliminar] = useState('');

  // 3. Editar
  const [showEditarModal, setShowEditarModal] = useState(false);
  const [descEditar, setDescEditar] = useState('');
  const [obsEditar, setObsEditar] = useState('');

  const loadIntervenciones = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (soloSinAsignar) params.set('sin_asignar', 'true');
      if (incluirEliminadas) params.set('incluir_eliminadas', 'true');
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const data = await fetchApi(`/api/intervenciones${queryStr}`);
      setIntervenciones(data);
    } catch (err: any) {
      if (incluirEliminadas && err.status === 403) {
        setPuedeVerEliminadas(false);
        setIncluirEliminadas(false);
      }
      setError(err.message || 'Error al cargar intervenciones');
    } finally {
      setLoading(false);
    }
  };

  const loadMaquinas = async () => {
    try {
      const data = await fetchApi('/api/maquinas');
      setMaquinas(data);
    } catch (err: any) {
      console.error('Error cargando máquinas:', err);
    }
  };

  useEffect(() => {
    loadIntervenciones();
    loadMaquinas();
  }, [soloSinAsignar, incluirEliminadas]);

  const handleCrearFalla = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaquinaId) {
      alert('Seleccione una máquina');
      return;
    }
    if (descripcion.trim().length < 5) {
      alert('La descripción debe tener al menos 5 caracteres');
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi('/api/intervenciones', {
        method: 'POST',
        body: JSON.stringify({
          maquina_id: Number(selectedMaquinaId),
          descripcion: descripcion.trim(),
          detiene_maquina: detieneMaquina,
          observaciones: observaciones.trim() || undefined,
        }),
      });

      // Limpiar y cerrar
      setShowModal(false);
      setSelectedMaquinaId('');
      setDescripcion('');
      setObservaciones('');
      setDetieneMaquina(true);
      await loadIntervenciones();
      await loadMaquinas();
    } catch (err: any) {
      alert('Error al registrar la falla: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerDetalle = async (id: number) => {
    setLoadingDetalle(true);
    setActionError(null);
    try {
      const data = await fetchApi(`/api/intervenciones/${id}`);
      setSelectedIntervencion(data);
    } catch (err: any) {
      alert('Error cargando detalle: ' + err.message);
    } finally {
      setLoadingDetalle(false);
    }
  };

  useEffect(() => {
    if (initialIntervencionId) {
      handleVerDetalle(initialIntervencionId);
    }
  }, [initialIntervencionId]);

  const ejecutarAccion = async (url: string, method: string, body?: any) => {
    setActionLoading(true);
    setActionError(null);
    try {
      await fetchApi(url, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      // Recargar detalle y lista
      if (selectedIntervencion && !url.endsWith('/eliminar')) {
        await handleVerDetalle(selectedIntervencion.id);
      } else if (url.endsWith('/eliminar')) {
        setSelectedIntervencion(null);
      }
      await loadIntervenciones();
      // Cerrar submodales
      setShowAsignarModal(false);
      setShowQuitarModal(false);
      setShowEsperaModal(false);
      setShowFinalizarModal(false);
      setShowResolverModal(false);
      setShowCancelarModal(false);
      setShowDetencionModal(false);
      setShowReabrirModal(false);
      setShowEliminarModal(false);
      setShowEditarModal(false);
    } catch (err: any) {
      setActionError({
        codigo: err.codigo || 'ERROR_OPERACION',
        mensaje: err.message || 'Error al ejecutar la acción',
        motivos: err.motivos,
      });
    } finally {
      setActionLoading(false);
    }
  };

  const submitReabrir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    const tieneAbierto = selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto);
    const body: any = {
      estado_esperado: selectedIntervencion.estado,
      motivo: motivoReabrir.trim(),
    };
    if (!tieneAbierto) {
      body.maquina_detenida = detenidaReabrir;
      if (detenidaReabrir) {
        if (desdeReabrir) body.desde = new Date(desdeReabrir).toISOString();
        if (obsDetencionReabrir.trim()) body.observacion_detencion = obsDetencionReabrir.trim();
      }
    }
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/reabrir`, 'POST', body);
  };

  const submitEliminar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    const tieneAbierto = selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto);
    const body: any = {
      motivo: motivoEliminar.trim(),
    };
    if (tieneAbierto) {
      body.maquina_recuperada = recupEliminar;
      if (obsRecupEliminar.trim()) body.observacion_recuperacion = obsRecupEliminar.trim();
    }
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/eliminar`, 'POST', body);
  };

  const submitEditar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    const body: any = {
      estado_esperado: selectedIntervencion.estado,
      descripcion: descEditar.trim(),
      observaciones: obsEditar.trim() || null,
    };
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}`, 'PATCH', body);
  };

  // Abrir modal Asignar / Reasignar
  const handleOpenAsignar = async () => {
    if (!selectedIntervencion) return;
    setActionError(null);
    setSelectedResponsableId('');
    setAsignarMotivo('');
    try {
      const resp = await fetchApi(`/api/intervenciones/${selectedIntervencion.id}/responsables-habilitados`);
      setResponsablesHabilitados(resp);
      setShowAsignarModal(true);
    } catch (err: any) {
      setActionError({
        codigo: err.codigo || 'ERROR_PERMISO',
        mensaje: err.message || 'No se pudieron cargar los responsables habilitados',
      });
    }
  };

  const submitAsignar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion || !selectedResponsableId) return;
    const esReasignacion = Boolean(selectedIntervencion.responsable);
    if (esReasignacion && !asignarMotivo.trim()) {
      alert('El motivo es obligatorio al reasignar');
      return;
    }
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/responsable`, 'PUT', {
      usuario_id: Number(selectedResponsableId),
      motivo: asignarMotivo.trim() || undefined,
      estado_esperado: selectedIntervencion.estado,
    });
  };

  const submitQuitar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion || !quitarMotivo.trim()) {
      alert('El motivo es obligatorio para desasignar');
      return;
    }
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/responsable`, 'DELETE', {
      motivo: quitarMotivo.trim(),
      estado_esperado: selectedIntervencion.estado,
    });
  };

  const submitEspera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion || esperaObservacion.trim().length < 5) {
      alert('La observación debe tener al menos 5 caracteres');
      return;
    }
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/espera-repuestos`, 'POST', {
      observacion: esperaObservacion.trim(),
      estado_esperado: selectedIntervencion.estado,
    });
  };

  const submitFinalizar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    if (trabajoFinalizar.trim().length < 5) {
      alert('El trabajo realizado debe tener al menos 5 caracteres');
      return;
    }
    const tienePeriodo = selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto);
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/finalizar`, 'POST', {
      estado_esperado: selectedIntervencion.estado,
      trabajo_realizado: trabajoFinalizar.trim(),
      ejecucion: ejecucionFinalizar,
      fecha_finalizacion: fechaFinFinalizar ? new Date(fechaFinFinalizar).toISOString() : undefined,
      maquina_recuperada: tienePeriodo ? recupFinalizar : undefined,
      observacion_recuperacion: tienePeriodo && recupObsFinalizar.trim() ? recupObsFinalizar.trim() : undefined,
    });
  };

  const submitResolver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    if (!fechaInicioResolver) {
      alert('La fecha de inicio es obligatoria');
      return;
    }
    if (trabajoResolver.trim().length < 5) {
      alert('El trabajo realizado debe tener al menos 5 caracteres');
      return;
    }
    const tienePeriodo = selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto);
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/resolver-ahora`, 'POST', {
      estado_esperado: selectedIntervencion.estado,
      fecha_inicio: new Date(fechaInicioResolver).toISOString(),
      trabajo_realizado: trabajoResolver.trim(),
      ejecucion: ejecucionResolver,
      fecha_finalizacion: fechaFinResolver ? new Date(fechaFinResolver).toISOString() : undefined,
      maquina_recuperada: tienePeriodo ? recupResolver : undefined,
      observacion_recuperacion: tienePeriodo && recupObsResolver.trim() ? recupObsResolver.trim() : undefined,
    });
  };

  const submitCancelar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    if (motivoCancelar.trim().length < 5) {
      alert('El motivo debe tener al menos 5 caracteres');
      return;
    }
    const tienePeriodo = selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto);
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/cancelar`, 'POST', {
      estado_esperado: selectedIntervencion.estado,
      motivo: motivoCancelar.trim(),
      maquina_recuperada: tienePeriodo ? recupCancelar : undefined,
      observacion_recuperacion: tienePeriodo && recupObsCancelar.trim() ? recupObsCancelar.trim() : undefined,
    });
  };

  const submitDetencion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntervencion) return;
    if (detencionObs.trim().length < 5) {
      alert('La observación debe tener al menos 5 caracteres');
      return;
    }
    await ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/registrar-detencion`, 'POST', {
      estado_esperado: selectedIntervencion.estado,
      observacion: detencionObs.trim(),
      desde: detencionDesde ? new Date(detencionDesde).toISOString() : undefined,
    });
  };

  return (
    <div className="dev-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2>Módulo de Intervenciones</h2>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            Registro unificado de fallas correctivas, motor de estados y control de detenciones.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ padding: '0.6rem 1.2rem', fontWeight: 600 }}
        >
          + Reportar Falla / Intervención
        </button>
      </div>

      {/* Selector de Vistas / Filtros */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn ${!soloSinAsignar ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSoloSinAsignar(false)}
          >
            Todas según mi alcance
          </button>
          <button
            className={`btn ${soloSinAsignar ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSoloSinAsignar(true)}
          >
            ⚠️ Vista "Sin asignar" (Priorizadas)
          </button>
        </div>

        {puedeVerEliminadas && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem', color: '#444' }}>
            <input
              type="checkbox"
              checked={incluirEliminadas}
              onChange={(e) => setIncluirEliminadas(e.target.checked)}
            />
            Incluir eliminadas
          </label>
        )}
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Tabla de Intervenciones */}
      {loading ? (
        <p>Cargando intervenciones...</p>
      ) : intervenciones.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: '#f9f9f9', borderRadius: '8px' }}>
          No hay intervenciones para mostrar en esta vista.
        </div>
      ) : (
        <table className="dev-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Estado</th>
              <th>Detención</th>
              <th>Máquina</th>
              <th>Descripción</th>
              <th>Reportado por</th>
              <th>Responsable</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {intervenciones.map((i) => (
              <tr key={i.id} style={i.eliminada ? { opacity: 0.75, backgroundColor: '#fafafa' } : undefined}>
                <td>
                  <strong>#{i.id}</strong>
                  {i.eliminada && (
                    <span style={{
                      backgroundColor: '#757575',
                      color: '#fff',
                      fontSize: '0.7rem',
                      padding: '2px 5px',
                      borderRadius: '3px',
                      marginLeft: '5px',
                      fontWeight: 600
                    }}>
                      ELIMINADA
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge badge-${i.estado.toLowerCase()}`}>
                    {i.estado}
                  </span>
                </td>
                <td>
                  {i.detiene_maquina_actualmente ? (
                    <span style={{
                      backgroundColor: '#ffebee',
                      color: '#c62828',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                      fontSize: '0.8rem'
                    }}>
                      ⛔ Detenida
                    </span>
                  ) : (
                    <span style={{ color: '#888', fontSize: '0.85rem' }}>No</span>
                  )}
                </td>
                <td>
                  <strong>{i.maquina.nombre}</strong>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>{i.maquina.sector.nombre}</div>
                </td>
                <td style={{ maxWidth: '300px' }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {i.descripcion}
                  </div>
                  {i.eliminada && i.motivo_eliminacion && (
                    <div style={{ fontSize: '0.75rem', color: '#c62828' }}>
                      Motivo eliminación: {i.motivo_eliminacion}
                    </div>
                  )}
                </td>
                <td>
                  {i.creado_por.nombre}
                  <div style={{ fontSize: '0.75rem', color: '#777' }}>({i.creado_por.legajo})</div>
                </td>
                <td>
                  {i.responsable ? (
                    <span>{i.responsable.nombre}</span>
                  ) : (
                    <span style={{ color: '#d32f2f', fontStyle: 'italic', fontSize: '0.85rem' }}>Sin asignar</span>
                  )}
                </td>
                <td style={{ fontSize: '0.85rem', color: '#555' }}>
                  {new Date(i.fecha_creacion).toLocaleString()}
                </td>
                <td>
                  {i.eliminada ? (
                    <span style={{ fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>
                      Eliminada {i.eliminado_por ? `por ${i.eliminado_por.nombre}` : ''}
                    </span>
                  ) : (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '3px 8px' }}
                      onClick={() => handleVerDetalle(i.id)}
                    >
                      Ver detalle / Gestionar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Modal: Registrar Falla */}
      {showModal && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '500px', maxWidth: '90%' }}>
            <h3>Reportar Falla / Nueva Intervención</h3>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Se creará automáticamente una intervención en estado <strong>PENDIENTE</strong>.
            </p>

            <form onSubmit={handleCrearFalla}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Máquina con desperfecto *
                </label>
                <select
                  value={selectedMaquinaId}
                  onChange={(e) => setSelectedMaquinaId(e.target.value ? Number(e.target.value) : '')}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="">-- Seleccionar máquina --</option>
                  {maquinas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.sector.nombre}) — Estado actual: {m.estado}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Descripción del problema o síntoma *
                </label>
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Describa qué sucedió o qué ruido/comportamiento anómalo presenta..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem', background: '#fff3e0', padding: '0.8rem', borderRadius: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={detieneMaquina}
                    onChange={(e) => setDetieneMaquina(e.target.checked)}
                  />
                  ¿La falla detuvo o impide el funcionamiento de la máquina?
                </label>
                <div style={{ fontSize: '0.75rem', color: '#b78103', marginTop: '0.3rem' }}>
                  {detieneMaquina
                    ? '⚠️ Se cambiará el estado de la máquina a DETENIDA y se registrará el inicio del período de detención para cómputo de horas de parada.'
                    : 'ℹ️ La máquina permanecerá en su estado actual (la falla no paralizó el equipo).'}
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Observaciones adicionales (Opcional)
                </label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Detalles sobre si se intentó algo o condiciones del entorno..."
                  rows={2}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Guardando...' : 'Registrar Falla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ver Detalle y Gestión de Intervención */}
      {selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '700px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Detalle y Motor de Estados — Intervención #{selectedIntervencion.id}</h3>
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedIntervencion(null)}
                style={{ padding: '2px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Mensajes de error de la API */}
            {actionError && (
              <div style={{
                marginTop: '1rem',
                padding: '0.8rem 1rem',
                backgroundColor: '#ffebee',
                color: '#c62828',
                borderRadius: '6px',
                border: '1px solid #ef9a9a',
                fontSize: '0.9rem'
              }}>
                <strong>Error [{actionError.codigo}]:</strong> {actionError.mensaje}
                {actionError.motivos && actionError.motivos.length > 0 && (
                  <ul style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.2rem' }}>
                    {actionError.motivos.map((m: string) => (
                      <li key={m}>{traducirMotivoEliminacion(m)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Acciones permitidas según el estado actual */}
            <div style={{
              margin: '1rem 0',
              padding: '1rem',
              backgroundColor: '#e8f0fe',
              borderRadius: '6px',
              border: '1px solid #bbdefb'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.6rem', color: '#1a73e8' }}>
                Acciones del Motor de Estados (Estado actual: {selectedIntervencion.estado})
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {/* ESTADO PENDIENTE */}
                {selectedIntervencion.estado === 'PENDIENTE' && (
                  <>
                    {!selectedIntervencion.responsable ? (
                      <>
                        <button
                          className="btn btn-primary"
                          disabled={actionLoading}
                          onClick={() => ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/tomar`, 'POST', {
                            estado_esperado: 'PENDIENTE'
                          })}
                        >
                          👤 Tomar Intervención
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={actionLoading}
                          onClick={handleOpenAsignar}
                        >
                          📋 Asignar a...
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                          disabled={actionLoading}
                          onClick={() => ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/iniciar`, 'POST', {
                            estado_esperado: 'PENDIENTE'
                          })}
                        >
                          ▶️ Iniciar Trabajo
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-secondary"
                          disabled={actionLoading}
                          onClick={handleOpenAsignar}
                        >
                          🔄 Reasignar a otro
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ color: '#c62828', borderColor: '#ef9a9a' }}
                          disabled={actionLoading}
                          onClick={() => {
                            setActionError(null);
                            setQuitarMotivo('');
                            setShowQuitarModal(true);
                          }}
                        >
                          ❌ Quitar responsable
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                          disabled={actionLoading}
                          onClick={() => ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/iniciar`, 'POST', {
                            estado_esperado: 'PENDIENTE'
                          })}
                        >
                          ▶️ Iniciar Trabajo (T1)
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-primary"
                      style={{ backgroundColor: '#1565c0', borderColor: '#1565c0' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setFechaInicioResolver('');
                        setTrabajoResolver('');
                        setEjecucionResolver('INTERNA');
                        setFechaFinResolver('');
                        setRecupResolver(false);
                        setRecupObsResolver('');
                        setShowResolverModal(true);
                      }}
                    >
                      ⚡ Resolver ahora (T2)
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: '#c62828', borderColor: '#ef9a9a' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setMotivoCancelar('');
                        setRecupCancelar(false);
                        setRecupObsCancelar('');
                        setShowCancelarModal(true);
                      }}
                    >
                      🚫 Cancelar (T3)
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: '#c62828', borderColor: '#ef9a9a' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setMotivoEliminar('');
                        setRecupEliminar(true);
                        setObsRecupEliminar('');
                        setShowEliminarModal(true);
                      }}
                    >
                      🗑️ Eliminar
                    </button>
                  </>
                )}

                {/* ESTADO EN_PROCESO */}
                {selectedIntervencion.estado === 'EN_PROCESO' && (
                  <>
                    <button
                      className="btn btn-secondary"
                      disabled={actionLoading}
                      onClick={handleOpenAsignar}
                    >
                      🔄 Reasignar a otro
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ backgroundColor: '#fff3e0', borderColor: '#ffe0b2', color: '#b78103' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setEsperaObservacion('');
                        setShowEsperaModal(true);
                      }}
                    >
                      ⏳ Pasar a espera de repuestos (T4)
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setTrabajoFinalizar('');
                        setEjecucionFinalizar('INTERNA');
                        setFechaFinFinalizar('');
                        setRecupFinalizar(false);
                        setRecupObsFinalizar('');
                        setShowFinalizarModal(true);
                      }}
                    >
                      ✅ Finalizar trabajo (T6)
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: '#c62828', borderColor: '#ef9a9a' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setMotivoCancelar('');
                        setRecupCancelar(false);
                        setRecupObsCancelar('');
                        setShowCancelarModal(true);
                      }}
                    >
                      🚫 Cancelar (T7)
                    </button>
                  </>
                )}

                {/* ESTADO EN_ESPERA_REPUESTOS */}
                {selectedIntervencion.estado === 'EN_ESPERA_REPUESTOS' && (
                  <>
                    <button
                      className="btn btn-secondary"
                      disabled={actionLoading}
                      onClick={handleOpenAsignar}
                    >
                      🔄 Reasignar a otro
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                      disabled={actionLoading}
                      onClick={() => ejecutarAccion(`/api/intervenciones/${selectedIntervencion.id}/reanudar`, 'POST', {
                        estado_esperado: 'EN_ESPERA_REPUESTOS'
                      })}
                    >
                      ▶️ Reanudar trabajo (T5)
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: '#c62828', borderColor: '#ef9a9a' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setMotivoCancelar('');
                        setRecupCancelar(false);
                        setRecupObsCancelar('');
                        setShowCancelarModal(true);
                      }}
                    >
                      🚫 Cancelar (T8)
                    </button>
                  </>
                )}

                {/* ESTADO FINALIZADA */}
                {selectedIntervencion.estado === 'FINALIZADA' && (
                  <button
                    className="btn btn-secondary"
                    style={{ backgroundColor: '#e8f0fe', borderColor: '#aecbfa', color: '#1a73e8' }}
                    disabled={actionLoading}
                    onClick={() => {
                      setActionError(null);
                      setMotivoReabrir('');
                      setDetenidaReabrir(false);
                      setDesdeReabrir('');
                      setObsDetencionReabrir('');
                      setShowReabrirModal(true);
                    }}
                  >
                    🔄 Reabrir intervención (T9)
                  </button>
                )}

                {/* Editar descripción / observaciones en estados editables */}
                {['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'].includes(selectedIntervencion.estado) && (
                  <button
                    className="btn btn-secondary"
                    disabled={actionLoading}
                    onClick={() => {
                      setActionError(null);
                      setDescEditar(selectedIntervencion.descripcion || '');
                      setObsEditar(selectedIntervencion.observaciones || '');
                      setShowEditarModal(true);
                    }}
                  >
                    ✏️ Editar datos
                  </button>
                )}

                {/* Registrar detención si está abierta y sin período abierto */}
                {['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS'].includes(selectedIntervencion.estado) &&
                  !selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto) && (
                    <button
                      className="btn btn-secondary"
                      style={{ color: '#d32f2f', borderColor: '#ef9a9a' }}
                      disabled={actionLoading}
                      onClick={() => {
                        setActionError(null);
                        setDetencionObs('');
                        setDetencionDesde('');
                        setShowDetencionModal(true);
                      }}
                    >
                      ⚠️ Registrar detención de máquina (RN-18)
                    </button>
                  )}
              </div>
            </div>

            {/* Datos principales */}
            <div style={{ margin: '1rem 0', background: '#f5f5f5', padding: '1rem', borderRadius: '6px' }}>
              <p><strong>Máquina:</strong> {selectedIntervencion.maquina.nombre} ({selectedIntervencion.maquina.sector.nombre})</p>
              <p><strong>Estado Actual de Intervención:</strong> <span className={`badge badge-${selectedIntervencion.estado.toLowerCase()}`}>{selectedIntervencion.estado}</span></p>
              <p><strong>Reportado por:</strong> {selectedIntervencion.creado_por.nombre} ({selectedIntervencion.creado_por.legajo})</p>
              <p><strong>Responsable Asignado:</strong> {selectedIntervencion.responsable ? `${selectedIntervencion.responsable.nombre} (${selectedIntervencion.responsable.legajo})` : <span style={{ color: '#c62828' }}>Sin asignar</span>}</p>
              <p><strong>Descripción:</strong> {selectedIntervencion.descripcion}</p>
              {selectedIntervencion.observaciones && <p><strong>Observaciones:</strong> {selectedIntervencion.observaciones}</p>}
              {selectedIntervencion.trabajo_realizado && (
                <p><strong>Trabajo Realizado:</strong> {selectedIntervencion.trabajo_realizado}</p>
              )}
              {selectedIntervencion.ejecucion && (
                <p><strong>Tipo de Ejecución:</strong> {selectedIntervencion.ejecucion}</p>
              )}
              {selectedIntervencion.tiempo_inactividad_minutos != null && (
                <p><strong>Tiempo de Inactividad Acumulado:</strong> {selectedIntervencion.tiempo_inactividad_minutos} minutos</p>
              )}
            </div>

            <h4>Períodos de Detención</h4>
            {selectedIntervencion.periodos_detencion.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#666' }}>Esta intervención no generó detención de máquina.</p>
            ) : (
              <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem' }}>
                {selectedIntervencion.periodos_detencion.map((p) => (
                  <li key={p.id} style={{ marginBottom: '0.4rem' }}>
                    Desde: <strong>{new Date(p.desde).toLocaleString()}</strong> —{' '}
                    Hasta: {p.hasta ? <strong>{new Date(p.hasta).toLocaleString()}</strong> : <span style={{ color: '#c62828', fontWeight: 600 }}>Abierto (Detención activa)</span>}
                    <div style={{ color: '#777' }}>Abierto por: {p.abierto_por.nombre} {p.confirmado_por ? ` | Confirmado por: ${p.confirmado_por.nombre}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}

            <h4 style={{ marginTop: '1rem' }}>Trazabilidad de Estados (Historial)</h4>
            <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem' }}>
              {selectedIntervencion.historial_estados.map((h) => (
                <li key={h.id} style={{ marginBottom: '0.3rem' }}>
                  {h.estado_anterior || 'INICIO'} ➔ <strong>{h.estado_nuevo}</strong> por {h.cambiado_por.nombre} ({new Date(h.cambiado_en).toLocaleString()})
                  {h.observacion && <div style={{ color: '#555', fontStyle: 'italic' }}>"{h.observacion}"</div>}
                </li>
              ))}
            </ul>

            <h4 style={{ marginTop: '1rem' }}>Auditoría y Trazabilidad Operativa</h4>
            {(!selectedIntervencion.auditoria || selectedIntervencion.auditoria.length === 0) ? (
              <p style={{ fontSize: '0.85rem', color: '#666' }}>Sin registros de auditoría.</p>
            ) : (
              <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem' }}>
                {selectedIntervencion.auditoria.map((a) => (
                  <li key={a.id} style={{ marginBottom: '0.3rem' }}>
                    <strong>[{a.tipo_evento}]</strong> por {a.realizado_por.nombre} ({new Date(a.creado_en).toLocaleString()}):{' '}
                    {a.campo_modificado ? `${a.campo_modificado}: ${a.valor_anterior || 'null'} ➔ ${a.valor_nuevo || 'null'}` : ''}
                    {a.motivo && <span style={{ color: '#555' }}> — Motivo: "{a.motivo}"</span>}
                  </li>
                ))}
              </ul>
            )}

            <div style={{ textAlign: 'right', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedIntervencion(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Asignar / Reasignar Responsable */}
      {showAsignarModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '450px', maxWidth: '90%' }}>
            <h4>{selectedIntervencion.responsable ? 'Reasignar Responsable' : 'Asignar Responsable'}</h4>
            
            <form onSubmit={submitAsignar}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Seleccionar Técnico Habilitado *
                </label>
                <select
                  value={selectedResponsableId}
                  onChange={(e) => setSelectedResponsableId(e.target.value ? Number(e.target.value) : '')}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="">-- Seleccionar usuario habilitado --</option>
                  {responsablesHabilitados.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} ({u.legajo})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Motivo {selectedIntervencion.responsable ? '(Obligatorio para reasignación) *' : '(Opcional)'}
                </label>
                <input
                  type="text"
                  value={asignarMotivo}
                  onChange={(e) => setAsignarMotivo(e.target.value)}
                  placeholder="Ej: Cambio de guardia / Especialidad técnica requerida"
                  required={Boolean(selectedIntervencion.responsable)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAsignarModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Confirmar Asignación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Quitar Responsable */}
      {showQuitarModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '450px', maxWidth: '90%' }}>
            <h4>Quitar Responsable Asignado</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Solo permitido en intervenciones <strong>PENDIENTE</strong>. El responsable actual volverá a estar sin asignar.
            </p>

            <form onSubmit={submitQuitar}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Motivo de la desasignación *
                </label>
                <input
                  type="text"
                  value={quitarMotivo}
                  onChange={(e) => setQuitarMotivo(e.target.value)}
                  placeholder="Ej: Asignado por error / Reevaluación de prioridad"
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowQuitarModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#c62828', borderColor: '#c62828' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Quitar Responsable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Pasar a espera de repuestos */}
      {showEsperaModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '450px', maxWidth: '90%' }}>
            <h4>Pausar por Espera de Repuestos (T4)</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              La intervención pasará a <strong>EN_ESPERA_REPUESTOS</strong>. Si detiene máquina, la máquina pasará a <strong>DETENIDA</strong>.
            </p>

            <form onSubmit={submitEspera}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Observación / Detalle de repuesto faltante (Mínimo 5 caracteres) *
                </label>
                <textarea
                  value={esperaObservacion}
                  onChange={(e) => setEsperaObservacion(e.target.value)}
                  placeholder="Detalle qué pieza o insumo falta para continuar el trabajo..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEsperaModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#b78103', borderColor: '#b78103' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Confirmar Pausa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Finalizar Trabajo (T6) */}
      {showFinalizarModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '520px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h4>Finalizar Intervención (T6)</h4>
            <form onSubmit={submitFinalizar}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Trabajo realizado (mínimo 5 caracteres) *
                </label>
                <textarea
                  value={trabajoFinalizar}
                  onChange={(e) => setTrabajoFinalizar(e.target.value)}
                  placeholder="Detalle de tareas ejecutadas, calibraciones, reparaciones..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Tipo de ejecución *
                </label>
                <select
                  value={ejecucionFinalizar}
                  onChange={(e) => setEjecucionFinalizar(e.target.value as 'INTERNA' | 'EXTERNA')}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="INTERNA">INTERNA (personal propio)</option>
                  <option value="EXTERNA">EXTERNA (tercerizado / proveedor)</option>
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Fecha y hora de finalización (opcional, por defecto ahora)
                </label>
                <input
                  type="datetime-local"
                  value={fechaFinFinalizar}
                  onChange={(e) => setFechaFinFinalizar(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              {selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto) && (
                <div style={{ marginBottom: '1rem', background: '#e8f5e9', padding: '0.8rem', borderRadius: '6px' }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', color: '#2e7d32' }}>
                    ¿La máquina ya puede funcionar? *
                  </label>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="recupFinalizar"
                        checked={recupFinalizar}
                        onChange={() => setRecupFinalizar(true)}
                      />
                      Sí (Confirmar recuperación)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="recupFinalizar"
                        checked={!recupFinalizar}
                        onChange={() => setRecupFinalizar(false)}
                      />
                      No (Permanece detenida)
                    </label>
                  </div>
                  {recupFinalizar && (
                    <input
                      type="text"
                      value={recupObsFinalizar}
                      onChange={(e) => setRecupObsFinalizar(e.target.value)}
                      placeholder="Observación de la recuperación (opcional)"
                      style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem' }}
                    />
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowFinalizarModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#2e7d32', borderColor: '#2e7d32' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Confirmar Finalización'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Resolver Ahora (T2) */}
      {showResolverModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '520px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h4>Resolución Inmediata (T2)</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Registra inicio y fin inmediatos en una sola operación sin estado intermedio.
            </p>
            <form onSubmit={submitResolver}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Fecha y hora de inicio de trabajo *
                </label>
                <input
                  type="datetime-local"
                  value={fechaInicioResolver}
                  onChange={(e) => setFechaInicioResolver(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Trabajo realizado (mínimo 5 caracteres) *
                </label>
                <textarea
                  value={trabajoResolver}
                  onChange={(e) => setTrabajoResolver(e.target.value)}
                  placeholder="Detalle de tareas ejecutadas..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Tipo de ejecución *
                </label>
                <select
                  value={ejecucionResolver}
                  onChange={(e) => setEjecucionResolver(e.target.value as 'INTERNA' | 'EXTERNA')}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="INTERNA">INTERNA (personal propio)</option>
                  <option value="EXTERNA">EXTERNA (tercerizado / proveedor)</option>
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Fecha y hora de finalización (opcional, por defecto ahora)
                </label>
                <input
                  type="datetime-local"
                  value={fechaFinResolver}
                  onChange={(e) => setFechaFinResolver(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              {selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto) && (
                <div style={{ marginBottom: '1rem', background: '#e8f5e9', padding: '0.8rem', borderRadius: '6px' }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', color: '#2e7d32' }}>
                    ¿La máquina ya puede funcionar? *
                  </label>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="recupResolver"
                        checked={recupResolver}
                        onChange={() => setRecupResolver(true)}
                      />
                      Sí (Confirmar recuperación)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="recupResolver"
                        checked={!recupResolver}
                        onChange={() => setRecupResolver(false)}
                      />
                      No (Permanece detenida)
                    </label>
                  </div>
                  {recupResolver && (
                    <input
                      type="text"
                      value={recupObsResolver}
                      onChange={(e) => setRecupObsResolver(e.target.value)}
                      placeholder="Observación de la recuperación (opcional)"
                      style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem' }}
                    />
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowResolverModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#1565c0', borderColor: '#1565c0' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Resolver Ahora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Cancelar Intervención (T3, T7, T8) */}
      {showCancelarModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '480px', maxWidth: '90%' }}>
            <h4>Cancelar Intervención</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              La intervención pasará a <strong>CANCELADA</strong> conservando todos los datos previos.
            </p>
            <form onSubmit={submitCancelar}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Motivo de la cancelación (mínimo 5 caracteres) *
                </label>
                <textarea
                  value={motivoCancelar}
                  onChange={(e) => setMotivoCancelar(e.target.value)}
                  placeholder="Explique por qué se cancela la intervención..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              {selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto) && (
                <div style={{ marginBottom: '1rem', background: '#fff3e0', padding: '0.8rem', borderRadius: '6px' }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', color: '#b78103' }}>
                    ¿La máquina ya puede funcionar? *
                  </label>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="recupCancelar"
                        checked={recupCancelar}
                        onChange={() => setRecupCancelar(true)}
                      />
                      Sí (Confirmar recuperación)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="recupCancelar"
                        checked={!recupCancelar}
                        onChange={() => setRecupCancelar(false)}
                      />
                      No (Permanece detenida)
                    </label>
                  </div>
                  {recupCancelar && (
                    <input
                      type="text"
                      value={recupObsCancelar}
                      onChange={(e) => setRecupObsCancelar(e.target.value)}
                      placeholder="Observación de la recuperación (opcional)"
                      style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem' }}
                    />
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCancelarModal(false)}
                  disabled={actionLoading}
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#c62828', borderColor: '#c62828' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Confirmar Cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Registrar Detención (RN-18) */}
      {showDetencionModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '480px', maxWidth: '90%' }}>
            <h4>Registrar Detención de Máquina (RN-18)</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Abre un nuevo período de detención para esta intervención y recalcula el estado de la máquina.
            </p>
            <form onSubmit={submitDetencion}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Observación / Motivo de detención (mínimo 5 caracteres) *
                </label>
                <textarea
                  value={detencionObs}
                  onChange={(e) => setDetencionObs(e.target.value)}
                  placeholder="Detalle la causa de la parada de la máquina..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Fecha y hora de inicio de parada (opcional, por defecto ahora)
                </label>
                <input
                  type="datetime-local"
                  value={detencionDesde}
                  onChange={(e) => setDetencionDesde(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDetencionModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#d32f2f', borderColor: '#d32f2f' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Registrar Detención'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Reabrir Intervención (T9) */}
      {showReabrirModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '480px', maxWidth: '90%' }}>
            <h4>Reabrir Intervención (T9)</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Pasa la intervención de FINALIZADA a EN_PROCESO manteniendo el historial previo.
            </p>
            <form onSubmit={submitReabrir}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Motivo de reapertura (mínimo 5 caracteres) *
                </label>
                <textarea
                  value={motivoReabrir}
                  onChange={(e) => setMotivoReabrir(e.target.value)}
                  placeholder="Explique el motivo por el cual se reabre la intervención..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              {selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto) ? (
                <div style={{ padding: '0.8rem', background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                  ⚠️ Esta intervención ya tiene un período de detención activo. La máquina continuará en mantenimiento.
                </div>
              ) : (
                <div style={{ marginBottom: '1rem', padding: '0.8rem', background: '#f5f5f5', borderRadius: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={detenidaReabrir}
                      onChange={(e) => setDetenidaReabrir(e.target.checked)}
                    />
                    ¿La máquina volvió a detenerse?
                  </label>

                  {detenidaReabrir && (
                    <div style={{ marginTop: '0.8rem' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                          Fecha/hora de inicio de parada (opcional, por defecto ahora):
                        </label>
                        <input
                          type="datetime-local"
                          value={desdeReabrir}
                          onChange={(e) => setDesdeReabrir(e.target.value)}
                          style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                          Observación de detención (opcional):
                        </label>
                        <input
                          type="text"
                          value={obsDetencionReabrir}
                          onChange={(e) => setObsDetencionReabrir(e.target.value)}
                          placeholder="Causa de la nueva detención..."
                          style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {actionError && (
                <div style={{ marginBottom: '1rem', color: '#c62828', fontSize: '0.85rem' }}>
                  <strong>Error:</strong> {actionError.mensaje}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReabrirModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Reabriendo...' : 'Confirmar Reapertura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Eliminar Intervención */}
      {showEliminarModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '480px', maxWidth: '90%' }}>
            <h4 style={{ color: '#c62828' }}>Eliminar Intervención #{selectedIntervencion.id}</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Esta acción realiza una eliminación lógica. Solo está permitida si la intervención no registra ninguna actividad previa.
            </p>
            <form onSubmit={submitEliminar}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Motivo de eliminación (mínimo 5 caracteres) *
                </label>
                <textarea
                  value={motivoEliminar}
                  onChange={(e) => setMotivoEliminar(e.target.value)}
                  placeholder="Indique por qué se elimina la intervención..."
                  rows={3}
                  required
                  minLength={5}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              {selectedIntervencion.periodos_detencion.some((p) => p.esta_abierto) && (
                <div style={{ marginBottom: '1rem', padding: '0.8rem', background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px' }}>
                  <p style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    Esta intervención tiene un período de detención activo. Debe definir la recuperación de la máquina:
                  </p>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="recupEliminar"
                      checked={recupEliminar === true}
                      onChange={() => setRecupEliminar(true)}
                    />
                    Máquina recuperada (vuelve a estado OPERATIVA)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="recupEliminar"
                      checked={recupEliminar === false}
                      onChange={() => setRecupEliminar(false)}
                    />
                    Máquina sigue detenida
                  </label>
                  {!recupEliminar && (
                    <input
                      type="text"
                      value={obsRecupEliminar}
                      onChange={(e) => setObsRecupEliminar(e.target.value)}
                      placeholder="Observación de la no recuperación..."
                      style={{ width: '100%', marginTop: '0.5rem', padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem' }}
                    />
                  )}
                </div>
              )}

              {actionError && (
                <div style={{ marginBottom: '1rem', padding: '0.6rem', background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '4px', color: '#c62828', fontSize: '0.85rem' }}>
                  <strong>Error [{actionError.codigo}]:</strong> {actionError.mensaje}
                  {actionError.motivos && actionError.motivos.length > 0 && (
                    <ul style={{ marginTop: '0.4rem', marginBottom: 0, paddingLeft: '1.2rem' }}>
                      {actionError.motivos.map((m: string) => (
                        <li key={m}>{traducirMotivoEliminacion(m)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEliminarModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ backgroundColor: '#c62828', borderColor: '#c62828' }}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Eliminando...' : 'Confirmar Eliminación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Editar Intervención */}
      {showEditarModal && selectedIntervencion && (
        <div className="dev-modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
        }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', width: '480px', maxWidth: '90%' }}>
            <h4>Editar Intervención #{selectedIntervencion.id}</h4>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              Modifique la descripción u observaciones de la intervención.
            </p>
            <form onSubmit={submitEditar}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Descripción (5 a 2000 caracteres) *
                </label>
                <textarea
                  value={descEditar}
                  onChange={(e) => setDescEditar(e.target.value)}
                  rows={3}
                  required
                  minLength={5}
                  maxLength={2000}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Observaciones (opcional, hasta 2000 caracteres)
                </label>
                <textarea
                  value={obsEditar}
                  onChange={(e) => setObsEditar(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              {actionError && (
                <div style={{ marginBottom: '1rem', color: '#c62828', fontSize: '0.85rem' }}>
                  <strong>Error [{actionError.codigo}]:</strong> {actionError.mensaje}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEditarModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
