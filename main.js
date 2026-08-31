// main.js
// Gestion du statut d'ouverture et estimation du temps d'attente
const RESTAURANT_SCHEDULE = [
  { open: "11:30", close: "14:00" },
  { open: "18:30", close: "22:30" }
];
const CUTOFF_MINUTES = 30;
const TIMEZONE = 'America/Martinique';

function getCurrentMinutesInTimezone(timezone = TIMEZONE, date = new Date()) {
  const options = { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('fr-FR', options);
  const parts = formatter.formatToParts(date);
  let hours = 0, minutes = 0;
  parts.forEach(p => {
    if (p.type === 'hour') hours = parseInt(p.value, 10);
    if (p.type === 'minute') minutes = parseInt(p.value, 10);
  });
  if (hours === 24) hours = 0;
  return hours * 60 + minutes;
}

function evaluateStoreStatus(currentMinutes = null, schedule = RESTAURANT_SCHEDULE, cutoff = CUTOFF_MINUTES) {
  if (currentMinutes === null) currentMinutes = getCurrentMinutesInTimezone();
  let isOpen = false, canOrder = false, currentSlot = null;
  for (let slot of schedule) {
    const [openH, openM] = slot.open.split(':').map(Number);
    const [closeH, closeM] = slot.close.split(':').map(Number);
    const openTime = openH * 60 + openM;
    const closeTime = closeH * 60 + closeM;
    const cutoffTime = closeTime - cutoff;
    if (currentMinutes >= openTime && currentMinutes < closeTime) {
      isOpen = true;
      currentSlot = slot;
      if (currentMinutes < cutoffTime) canOrder = true;
      break;
    }
  }
  return { isOpen, canOrder, currentSlot, currentMinutes };
}

function renderStatus() {
  const { isOpen, canOrder, currentMinutes } = evaluateStoreStatus();
  const statusBadge = document.getElementById('statusBadge');
  const waitTimeDisplay = document.getElementById('waitTimeDisplay');
  const statusSubtext = document.getElementById('statusSubtext');

  if (!statusBadge || !waitTimeDisplay || !statusSubtext) return;

  if (canOrder) {
    statusBadge.innerHTML = "🟢 <span class='status-open'>PRISE DE COMMANDE OUVERTE</span>";
    statusSubtext.innerText = "Temps d'attente estimé en cuisine :";
    if (currentMinutes >= (19 * 60 + 30) && currentMinutes <= (21 * 60)) {
      waitTimeDisplay.innerText = "25 - 35 min";
    } else {
      waitTimeDisplay.innerText = "15 - 20 min";
    }
  } else if (isOpen) {
    statusBadge.innerHTML = "🟠 <span class='status-warning'>COMMANDES FERMÉES (FIN DE SERVICE)</span>";
    statusSubtext.innerText = "Le restaurant est ouvert mais la prise de commande est arrêtée 30 min avant la fermeture.";
    waitTimeDisplay.innerText = "Service en cours";
  } else {
    statusBadge.innerHTML = "🔴 <span class='status-closed'>RESTAURANT FERMÉ</span>";
    statusSubtext.innerText = "Horaires : 11h30 - 14h00 & 18h30 - 22h30";
    waitTimeDisplay.innerText = "Réouverture au prochain service";
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderStatus();
  setInterval(renderStatus, 60000);
});

// Exports pour tests unitaires si environnement CommonJS
if (typeof module !== 'undefined') {
  module.exports = { getCurrentMinutesInTimezone, evaluateStoreStatus, renderStatus };
}
