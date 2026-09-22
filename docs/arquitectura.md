# Arquitectura inicial

## Enfoque

La solución se plantea como una aplicación web interna accesible desde los equipos de GI-RE S.A. mediante navegador.

## Componentes previstos

### Cliente web
Interfaz para operarios, responsables de mantenimiento, administradores y usuarios de consulta.

### Backend / API
Contendrá la lógica de negocio del sistema, validaciones, permisos y operaciones sobre los datos.

### Base de datos centralizada
Almacenará, entre otros:

- usuarios;
- perfiles y permisos;
- máquinas;
- sectores;
- intervenciones;
- tipos de mantenimiento;
- planes preventivos;
- repuestos;
- movimientos de stock;
- costos;
- tiempos;
- documentación;
- historial.

### Almacenamiento documental
Permitirá conservar o referenciar documentación respaldatoria como facturas, remitos, presupuestos, fotografías, manuales y capturas.

### SAE
Se considera un sistema externo utilizado como referencia documental. No forma parte de la arquitectura funcional del nuevo sistema.

## Acceso

El sistema deberá poder utilizarse desde PCs, notebooks, celulares o terminales conectadas a la infraestructura interna disponible en la empresa.

## Decisiones pendientes

Antes de iniciar el código se debe definir:

- tecnología de frontend;
- tecnología de backend;
- motor de base de datos;
- estrategia de autenticación;
- estrategia para archivos adjuntos;
- forma de despliegue dentro de la empresa.
