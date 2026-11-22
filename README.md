# Thumbnail Tracker · Mis miniaturas

Registro compartido de miniaturas de YouTube, publicado en **Cloudflare Workers + D1**.

**Página:** https://thumbnail-tracker.ray-ofici4l.workers.dev/

- **Diseñador:** crea, edita y elimina miniaturas con cliente, imagen, fecha, revisiones, enlace y notas.
- **Encargado o administrador:** establece montos, fechas y notas de pago. La fecha sugerida al abrir un pago sin fecha es el último día del mes actual y se puede editar.
- **Ambas cuentas:** confirman por separado. Una miniatura solo aparece como pagada y suma al total pagado cuando el diseñador y el encargado confirmaron el mismo monto y fecha. Guardar un monto no equivale a confirmar.
- Ambos consultan totales, buscan, filtran por cliente, pago o mes y exportan CSV. El periodo ofrece Todos los meses, Este mes, Mes anterior y Elegir mes (mes y año). Los totales y el CSV usan los registros filtrados por la fecha de la miniatura, no la del pago.
- Las dos cuentas ya están creadas. Cada persona puede cambiar su contraseña desde su sesión.

## Entrar

Abre la página y escribe tu **usuario y contraseña**. No se necesita correo, registro ni código de configuración. La sesión se conserva durante 30 días o hasta pulsar **Salir**.

| Usuario | Rol |
| --- | --- |
| `papayeroray` | Diseñador y administrador |
| `icrisyt` | Encargado de pagos |

Las contraseñas no están en este repositorio: la base guarda únicamente los hashes y sales. No existe registro público ni una ruta de configuración inicial. Las cuentas se aprovisionan de forma privada por el propietario de Cloudflare. Si se pierde el acceso, el propietario debe restablecerlo.

## Confirmaciones de pago

El botón **Confirmar pagos rápido**, al final de la lista, permite seleccionar varias miniaturas del filtro actual sin abrirlas. Muestra la imagen, el título, el monto y si falta tu confirmación o la otra cuenta. Las miniaturas sin monto no se pueden confirmar. Desde el detalle también puedes confirmar tu parte o retirar tu confirmación.

Si cambia el monto o la fecha, se anulan ambas confirmaciones y cada cuenta debe volver a confirmar. Cambiar solo una nota mantiene las confirmaciones. El servidor comprueba la versión del pago antes de confirmar para evitar que se aprueben condiciones que la otra persona acaba de cambiar. Cada cuenta confirma únicamente su parte, incluso si tiene permisos de administrador.

Los listados abiertos se actualizan cada 15 segundos y al volver a la pestaña, siempre que no haya un diálogo abierto. Los totales y el estado del CSV utilizan las dos confirmaciones. Los pagos antiguos conservan su monto y fecha; si ya estaban marcados como pagados, se conserva la confirmación del encargado y se requiere la del diseñador.

## Datos e imágenes

La API y la página se sirven en el mismo Worker. Los datos e imágenes se guardan en la base D1 `thumbnail-tracker-db`, con permisos revisados por el servidor. Las imágenes requieren una sesión; conocer su enlace no concede acceso.

Se guardan **copias optimizadas** de las imágenes: hasta 1280 píxeles de lado y 700 KB por imagen (WebP cuando el navegador lo admite). No es un archivo de originales. Esta configuración permite usar la página sin activar R2. Para archivar imágenes originales o aumentar el volumen, conviene trasladar los archivos a R2 y mantener los registros en D1.

La sesión usa una cookie Secure, HttpOnly y SameSite=Strict. Las contraseñas se derivan con PBKDF2-SHA-256, sal aleatoria y un secreto adicional guardado en Cloudflare. El código limita los intentos de acceso y protege las operaciones contra peticiones de otros sitios. Cambiar una contraseña invalida las sesiones anteriores de esa cuenta.

## Desarrollo y publicación

Requiere Node.js 22.13 o posterior. No necesita paquetes externos.

```sh
npm test
npm run build
```

Las pruebas ejecutan el Worker compilado contra SQLite en memoria con una adaptación de D1. Cubren acceso con usuario, ausencia de registro público, permisos, sesiones, imágenes, validación y pagos. Son pruebas de integración de la aplicación; no sustituyen la comprobación del runtime de Cloudflare.

`npm run build` genera `build/worker.mjs` con los archivos públicos incorporados. La aplicación solo sirve esos archivos; no expone el SQL, las pruebas ni el código del servidor.

El despliegue ya tiene su base creada, su esquema aplicado y `AUTH_PEPPER` configurado como secreto de Worker. Para actualizarlo:

1. Define `CLOUDFLARE_API_TOKEN` en tu entorno con permiso Workers Scripts Write para la cuenta.
2. Ejecuta `npm run deploy`.

El script usa la API oficial de Cloudflare, conserva los secretos existentes y habilita registros y trazas. `cloudflare-deployment.json` contiene únicamente identificadores y configuración pública. Nunca subas el token de Cloudflare ni `AUTH_PEPPER` a GitHub. No cambies `AUTH_PEPPER` sin un plan para restablecer las contraseñas, porque las cuentas existentes dependen de él.

`schema.sql` contiene el esquema sin cuentas ni credenciales. `migrations/0002-username-login.sql` documenta el acceso con usuario y `migrations/0003-payment-confirmations.sql` añade las confirmaciones y versiones de pago a la base existente. Los cambios futuros del esquema requieren una migración separada: publicar código no modifica la base automáticamente.

La copia abierta desde GitHub Pages redirige a la página oficial de Cloudflare para que las sesiones y las imágenes funcionen en el mismo dominio. Las actualizaciones en GitHub no se publican automáticamente: ejecuta el despliegue después de cambiar el código.
