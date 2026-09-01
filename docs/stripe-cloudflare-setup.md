# Stripe + Cloudflare — mise en service

## 1. Créer la base D1

Depuis le dossier du projet :

```bash
npx wrangler login
npx wrangler d1 create planet-pizza-db
```

Copier le `database_id` retourné dans `wrangler.toml` à la place de `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.

Appliquer le schéma et les migrations :

```bash
npx wrangler d1 execute planet-pizza-db --remote --file=data/schema.sql
npx wrangler d1 execute planet-pizza-db --remote --file=data/migrations/002_inventory_trigger.sql
npx wrangler d1 execute planet-pizza-db --remote --file=data/migrations/003_stock_confirmation.sql
npx wrangler d1 execute planet-pizza-db --remote --file=data/migrations/004_block_confirmed_outage_orders.sql
npx wrangler d1 execute planet-pizza-db --remote --file=data/migrations/005_stripe.sql
```

Puis charger les données du restaurant/menu avec le seed du projet si nécessaire.

## 2. Créer le compte Stripe

Dans Stripe, activer le mode test pour commencer. Récupérer la clé secrète `sk_test_...` dans les clés API.

Ne jamais la mettre dans GitHub, HTML ou JavaScript navigateur.

## 3. Ajouter le secret Stripe à Cloudflare Pages

```bash
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name planet-pizza
```

Entrer la clé `sk_test_...` lorsqu'elle est demandée.

## 4. Créer le webhook Stripe

Déployer d'abord le site, puis dans Stripe créer un endpoint webhook :

```text
https://VOTRE-DOMAINE/api/webhooks/stripe
```

Événements nécessaires :

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

Stripe fournit alors un secret de signature `whsec_...`.

Ajouter ce secret à Cloudflare :

```bash
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name planet-pizza
```

## 5. Déployer

Le projet utilise les Pages Functions dans `/functions`. Cloudflare les route automatiquement selon leur chemin.

```bash
npx wrangler pages deploy . --project-name planet-pizza
```

Si le projet est déjà connecté à GitHub dans Cloudflare Pages, un push sur la branche configurée peut également déclencher le déploiement.

## 6. Tester avant le mode réel

Utiliser uniquement les cartes de test Stripe en mode test.

Scénario :

1. ouvrir `customer.html` ;
2. ajouter une pizza ;
3. cliquer sur `Continuer` ;
4. remplir le nom ;
5. payer avec une carte de test Stripe ;
6. vérifier que la commande passe à `payment_status = paid` dans D1 ;
7. vérifier que `stock_deducted = 1` ;
8. vérifier les lignes `stripe_payment_consumption` dans `inventory_movements` ;
9. vérifier que la commande apparaît comme `confirmed` dans l'administration.

## Important

Le navigateur ne déduit jamais le stock. Le stock est consommé uniquement par le webhook serveur après confirmation du paiement Stripe.

Une commande abandonnée ou un paiement échoué ne consomme donc pas le stock.
