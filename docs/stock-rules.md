# Règles de rupture de stock

Le stock ne bloque pas automatiquement une pizza dès qu'un ingrédient atteint zéro.

## Règle

Une pizza est bloquée uniquement si :

1. un ingrédient de sa recette a une quantité `<= 0` ;
2. le restaurateur a explicitement confirmé la rupture avec `out_of_stock_confirmed = 1`.

Tant que la confirmation n'est pas faite, la pizza reste commandable. Le tableau de bord signale toutefois l'ingrédient à zéro pour permettre une vérification physique du stock.

## Confirmation

`PATCH /api/admin/stocks` avec :

```json
{"id": 12, "action": "confirm_out"}
```

La confirmation est refusée si la quantité est supérieure à zéro.

## Réapprovisionnement

Dès qu'une quantité repasse au-dessus de zéro, la confirmation de rupture est automatiquement supprimée.

## Protection checkout

Le catalogue public applique cette règle et D1 possède en plus un trigger qui empêche l'insertion d'une ligne de commande pour un produit bloqué par une rupture confirmée.
