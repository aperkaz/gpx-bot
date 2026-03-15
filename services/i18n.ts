export type Locale = "en" | "es";

type TranslationDict = Record<string, string>;

const translations: Record<Locale, TranslationDict> = {
  en: {
    welcome: `Welcome to GPX Bot!

Send me a .gpx file with your route and I'll find water sources and fuel stations along it.

How it works:
1. Send a .gpx file
2. Choose what to find (water, fuel, or both)
3. Pick a search radius
4. Get back a .gpx file with your route + points of interest

In group chats, send /gpx_metadata and I'll ask you to forward the GPX file`,
    not_gpx: "Please send a .gpx file. Other file types are not supported.",
    type_picker: "Got your GPX route! What should I find along it?",
    radius_picker: "Finding {type}. Pick a search radius:",
    downloading: "Downloading your GPX file...",
    parsing: "Parsing your route...",
    searching: "Searching for {type} along your {distance}km route...",
    processing: "Processing your route...",
    no_file: "Could not find the original GPX file. Please send it again.",
    download_failed: "Could not download the file. Please try again.",
    error: "Sorry, I couldn't process your file. The route might be too large or the map service is temporarily unavailable. Please try again later.",
    forward_request: "Please forward me the GPX file you'd like me to analyze.",
    gpx_metadata_help: "Reply to a .gpx file with /gpx_metadata to find waypoints along the route.",
    not_gpx_reply: "Please reply to a .gpx file. Other file types are not supported.",
    summary_empty: "No {type} found within {radius}km of your {distance}km route.",
    summary_found: "Found {count} {type} along your {distance}km route ({radius}km radius).",
    summary_closest: "Closest at {closest}km, furthest at {furthest}km.",
    water_label: "Water Sources",
    fuel_label: "Fuel Stations",
  },
  es: {
    welcome: `¡Bienvenido a GPX Bot!

Envíame un archivo .gpx con tu ruta y encontraré fuentes de agua y estaciones de servicio a lo largo de ella.

Cómo funciona:
1. Envía un archivo .gpx
2. Elige qué buscar (agua, combustible o ambos)
3. Elige un radio de búsqueda
4. Recibe un archivo .gpx con tu ruta + puntos de interés

En grupos, envía /gpx_metadata y te pediré que reenvíes el archivo GPX`,
    not_gpx: "Por favor envía un archivo .gpx. Otros tipos de archivo no son compatibles.",
    type_picker: "¡Tengo tu ruta GPX! ¿Qué debo buscar a lo largo de ella?",
    radius_picker: "Buscando {type}. Elige un radio de búsqueda:",
    downloading: "Descargando tu archivo GPX...",
    parsing: "Analizando tu ruta...",
    searching: "Buscando {type} a lo largo de tu ruta de {distance}km...",
    processing: "Procesando tu ruta...",
    no_file: "No pude encontrar el archivo GPX original. Por favor envíalo de nuevo.",
    download_failed: "No pude descargar el archivo. Por favor intenta de nuevo.",
    error: "Lo siento, no pude procesar tu archivo. La ruta podría ser muy grande o el servicio de mapas no está disponible. Por favor intenta más tarde.",
    forward_request: "Por favor reenvíame el archivo GPX que te gustaría que analizara.",
    gpx_metadata_help: "Responde a un archivo .gpx con /gpx_metadata para encontrar puntos de interés a lo largo de la ruta.",
    not_gpx_reply: "Por favor responde a un archivo .gpx. Otros tipos de archivo no son compatibles.",
    summary_empty: "No se encontraron {type} dentro de {radius}km de tu ruta de {distance}km.",
    summary_found: "Se encontraron {count} {type} a lo largo de tu ruta de {distance}km (radio de {radius}km).",
    summary_closest: "El más cercano a {closest}km, el más lejano a {furthest}km.",
    water_label: "Fuentes de Agua",
    fuel_label: "Estaciones de Servicio",
  },
};

const EN = "en";

export function t(key: string, locale?: string): string {
  const lang: Locale = locale === "es" ? "es" : EN;
  return translations[lang][key] ?? translations[EN][key] ?? key;
}

export function getLocale(languageCode?: string): Locale {
  return languageCode === "es" ? "es" : EN;
}
