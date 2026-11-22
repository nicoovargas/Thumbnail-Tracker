# Mis miniaturas

Registro compartido de miniaturas de YouTube. Funciona en GitHub Pages (sitio estático) y usa Supabase para el login, la base de datos y las imágenes.

**Roles**
- **Diseñador:** crea, edita y elimina miniaturas (cliente, título, imagen, fecha, tiempo, revisiones opcionales, enlace, notas).
- **Encargado:** ve todo y registra el pago de cada miniatura (monto, pagada o no, fecha y nota opcional).

Ambos ven los totales, pueden buscar y filtrar, y exportar a CSV.

## Instalación

### 1. Crear el proyecto en Supabase
1. Entra a [supabase.com](https://supabase.com) y crea un proyecto gratis.
2. Ve a **SQL Editor → New query**, pega el contenido de `supabase-setup.sql` y ejecútalo.

### 2. Crear los dos usuarios
1. **Authentication → Users → Add user → Create new user.** Crea uno para ti y otro para tu amigo (correo y contraseña; marca *Auto Confirm User*).
2. **Authentication → Sign In / Providers → Email:** desactiva *Allow new users to sign up*, así nadie más puede registrarse.

### 3. Conectar el sitio
En **Project Settings → API** copia la *Project URL* y la *anon public key* y pégalas en `config.js`.

### 4. Asignar roles
Vuelve al SQL Editor, descomenta las dos consultas del final de `supabase-setup.sql` (paso 5), cambia los correos y ejecútalas. Sin este paso el sitio dirá que tu usuario no tiene rol.

### 5. Subir a GitHub
1. Crea un repositorio nuevo y sube todos los archivos de esta carpeta.
2. **Settings → Pages →** *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
3. En unos minutos el sitio estará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## Notas
- La *anon key* es pública a propósito; lo que protege los datos son las reglas de seguridad del SQL (solo el diseñador edita miniaturas y solo el encargado edita pagos).
- Las imágenes se guardan en un bucket cuya lectura es pública: quien tenga el enlace exacto de una imagen puede verla, pero solo el diseñador puede subir o borrar.
- Para probar en tu computadora: `python -m http.server` dentro de la carpeta y abre `http://localhost:8000`.
