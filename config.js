// La aplicación y la API funcionan juntas en Cloudflare.
// Si se abre la copia de GitHub Pages, usa la dirección oficial.
if (location.hostname.endsWith('.github.io')) {
  location.replace('https://thumbnail-tracker.ray-ofici4l.workers.dev/' + location.hash);
}
