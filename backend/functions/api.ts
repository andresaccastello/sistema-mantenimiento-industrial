import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pool } from './db.ts';
import authApp from './auth.ts';
import sectoresApp from './sectores.ts';
import maquinasApp from './maquinas.ts';
import intervencionesApp from './intervenciones.ts';
import notificacionesApp from './notificaciones.ts';
import { usuariosApp, perfilesApp, permisosApp } from './usuarios.ts';
import reportesApp from './reportes.ts';
import configuracionApp from './configuracion.ts';
import tableroApp from './tablero.ts';
import tiposIntervencionApp from './tipos_intervencion.ts';
import { criticidadesApp, tiposEquipoApp, plantasApp } from './catalogos.ts';
import { avisosTriggerApp, configuracionAvisosApp } from './avisos/api.ts';
import proveedoresApp from './proveedores.ts';
import repuestosApp from './repuestos.ts';
import pedidosRepuestoApp from './pedidosRepuesto.ts';
import costosApp from './costos.ts';
import planesApp from './planes.ts';
import medidoresApp from './medidores.ts';
import { maquinaRutinasApp, rutinasApp } from './rutinas/api.ts';
import { maquinaDocumentosApp, documentosApp } from './documentos.ts';

import { JWT_SECRET } from './config.ts';

const app = new Hono();

const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use('*', cors({
  origin: allowedOrigin,
  exposeHeaders: ['X-Total-Count', 'Content-Disposition'],
}));


// Montar endpoints
app.route('/api/auth', authApp);
app.route('/api/sectores', sectoresApp);
app.route('/api/maquinas', maquinasApp);
app.route('/api/intervenciones', intervencionesApp);
app.route('/api/notificaciones', notificacionesApp);
app.route('/api/usuarios', usuariosApp);
app.route('/api/perfiles', perfilesApp);
app.route('/api/permisos', permisosApp);
app.route('/api/reportes', reportesApp);
app.route('/api/configuracion/avisos', configuracionAvisosApp);
app.route('/api/configuracion', configuracionApp);
app.route('/api/avisos', avisosTriggerApp);
app.route('/api/tablero', tableroApp);
app.route('/api/tipos-intervencion', tiposIntervencionApp);
app.route('/api/criticidades', criticidadesApp);
app.route('/api/tipos-equipo', tiposEquipoApp);
app.route('/api/plantas', plantasApp);
app.route('/api/proveedores', proveedoresApp);
app.route('/api/repuestos', repuestosApp);
app.route('/api/pedidos-repuesto', pedidosRepuestoApp);
app.route('/api/costos', costosApp);
app.route('/api/planes', planesApp);
app.route('/api/medidores', medidoresApp);
// RT1: las rutinas de una máquina van bajo /api/maquinas/:id/rutinas
app.route('/api/maquinas', maquinaRutinasApp);
app.route('/api/rutinas', rutinasApp);
// MQ1: los documentos de una máquina van bajo /api/maquinas/:id/documentos
app.route('/api/maquinas', maquinaDocumentosApp);
app.route('/api/documentos', documentosApp);

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'sistema-mantenimiento-industrial-api',
  });
});

app.get('/health/db', async (c) => {
  try {
    await pool.query('SELECT 1');
    return c.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return c.json({ status: 'error', database: 'disconnected' }, 500);
  }
});

export default app;
