# API Cloudflare

Ce dossier documente l'emplacement prévu pour les fonctions serveur si le dépôt est déployé avec Cloudflare Pages Functions.

Pour le MVP, les endpoints suivants seront nécessaires :

- `GET /api/products` — catalogue public, uniquement les produits actifs et disponibles
- `GET /api/orders` — commandes restaurateur authentifié
- `PATCH /api/orders/:id` — changement d'état d'une commande
- `GET /api/stocks` — inventaire restaurateur
- `PATCH /api/stocks/:id` — ajustement de stock
- `POST /api/checkout` — création d'une session Stripe côté serveur
- `POST /api/webhooks/stripe` — confirmation fiable du paiement

Le Worker/Pages Function devra vérifier l'identité du restaurateur et recalculer les totaux côté serveur. Le navigateur ne doit jamais être la source de vérité pour le prix, le stock ou le paiement.