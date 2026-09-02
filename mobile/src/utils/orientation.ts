import * as Device from "expo-device";
import * as ScreenOrientation from "expo-screen-orientation";

// app.json fixe "portrait" comme orientation STATIQUE (manifest natif) --
// nécessaire comme base sûre pour un téléphone, dont aucun écran de cette
// app n'est pensé pour le paysage (formulaires/listes à largeur fixe). Sur
// tablette, où le paysage est l'usage naturel, on lève cette contrainte au
// runtime plutôt que d'ouvrir la rotation libre à TOUT le monde -- ce qui
// aurait juste déplacé le problème sur téléphone (rotation accidentelle
// vers des écrans non prévus pour ça).
export async function configurerOrientation(): Promise<void> {
  try {
    const estTablette = Device.deviceType === Device.DeviceType.TABLET;
    if (estTablette) {
      await ScreenOrientation.unlockAsync();
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
  } catch {
    // Web/plateforme sans support de verrouillage d'orientation -- pas
    // bloquant, l'app reste utilisable sans ce réglage.
  }
}
