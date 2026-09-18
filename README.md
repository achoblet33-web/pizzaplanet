# Planet Pizza — plateforme de commande

Cette branche pose la fondation du futur système :

- `index.html`, `menu.html`, `contact.html` : site client existant
- `customer.html` + `customer.js` : nouvelle interface de commande, panier et futur checkout
- `admin.html` + `admin.js` : interface restaurateur pour commandes et stocks

## Architecture cible

```text
Client -> Cloudflare Pages -> Worker API -> D1
                                  |-> Stripe Checkout
                                  |-> notifications
Restaurateur -> Admin -> Worker API -> D1
```

## Prochaine étape backend

Créer un Worker Cloudflare avec D1 et les tables :

- restaurants
- users
- categories
- products
- ingredients
- recipes
- orders
- order_items
- inventory_movements

Les routes prévues sont `/api/products`, `/api/orders`, `/api/stocks` et `/api/checkout`.

**Important :** l'interface admin actuelle est une maquette fonctionnelle côté navigateur. Avant toute mise en production, elle doit être protégée par authentification et toutes les écritures doivent être validées côté Worker.

## Déploiement

Le dépôt peut être connecté à Cloudflare Pages pour le frontend. Le Worker et D1 seront ajoutés ensuite afin d'éviter de mettre des secrets ou une logique métier sensible dans les fichiers publics.