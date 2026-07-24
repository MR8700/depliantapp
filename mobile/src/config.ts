// URL de base de l'API DepliantApp. `__DEV__` bascule automatiquement selon
// le type de build (Expo Go / dev client => true ; build EAS "production"
// => false), donc rien à changer à la main avant de publier un APK.
//
// En développement sur un appareil physique relié en USB (adb), "localhost"
// fonctionne via `adb reverse tcp:8010 tcp:8010` (redirige le "localhost" du
// téléphone vers celui de la machine de dev) -- pas besoin de connaître l'IP
// LAN. Sans adb reverse (Wi-Fi uniquement), remplace temporairement par l'IP
// LAN de la machine qui fait tourner `uvicorn`.
const URL_DEV = "http://localhost:8010";
const URL_PRODUCTION = "https://depliantapp.onrender.com";

export const API_BASE_URL = __DEV__ ? URL_DEV : URL_PRODUCTION;
