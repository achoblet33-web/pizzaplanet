// main.js
// Gestion du statut d'ouverture et estimation du temps d'attente
// Horaires mis à jour : 17:30 - 22:30 tous les jours

const RESTAURANT_SCHEDULE = [
  { open: "17:30", close: "22:30" }
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
    // Estimation : pic 19:30 - 21:00
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
    statusSubtext.innerText = "Horaires : 17h30 - 22h30";
    waitTimeDisplay.innerText = "Réouverture au prochain service";
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderStatus();
  setInterval(renderStatus, 60000);
});

// --- Mobile menu toggle ---
(function(){
  const toggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');

  if (!toggle || !mobileNav) return;

  function openMenu(){
    toggle.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    mobileNav.classList.add('open');
    mobileNav.removeAttribute('hidden');
    const first = mobileNav.querySelector('a');
    if (first) first.focus();
    document.documentElement.style.overflow = 'hidden';
  }

  function closeMenu(){
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    mobileNav.classList.remove('open');
    mobileNav.setAttribute('hidden', '');
    document.documentElement.style.overflow = '';
    toggle.focus();
  }

  toggle.addEventListener('click', (e) => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    if (expanded) closeMenu(); else openMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
      closeMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (!mobileNav.classList.contains('open')) return;
    const isInside = mobileNav.contains(e.target) || toggle.contains(e.target);
    if (!isInside) closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && mobileNav.classList.contains('open')) {
      closeMenu();
    }
  });

  mobileNav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') closeMenu();
  });
})();
