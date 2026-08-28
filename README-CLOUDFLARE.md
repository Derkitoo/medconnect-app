# MedConnect — installation Cloudflare

Cette archive contient l'application complète, ses routes API et les migrations D1.

## 1. Créer la base

Dans Cloudflare, ouvrez **Workers & Pages > D1 SQL database > Create database** et nommez-la `medconnect-db`.

Copiez son identifiant puis remplacez dans `wrangler.jsonc` la valeur `00000000-0000-0000-0000-000000000000` par l'identifiant réel de la base. Le binding doit rester exactement `DB`.

## 2. Initialiser la structure D1

```bash
npx wrangler login
npx wrangler d1 migrations apply medconnect-db --remote
```

Les migrations présentes dans `drizzle/` créent les tables nécessaires.

## 3. Déployer depuis GitHub

Dans **Workers & Pages > Create application > Import a repository** :

- sélectionnez le dépôt GitHub `Derkitoo/medconnect-app` ;
- branche de production : `main` ;
- si les fichiers restent dans un sous-dossier, Root directory : `MedConnect-GitHub-source` ;
- commande de build : `npm run build` ;
- commande de déploiement : `npm run deploy`.

Le premier déploiement fournit une adresse `*.workers.dev`. Les suivants sont déclenchés automatiquement par les mises à jour de la branche principale.

## 4. Vérifications obligatoires

- ouvrir l'accès Aidant et créer une famille de test ;
- ouvrir le lien Patient dans une fenêtre privée ;
- vérifier l'ajout d'un médicament et l'enregistrement D1 ;
- vérifier que le lien Patient ne contient jamais le paramètre `access` ;
- configurer ensuite le domaine personnalisé.

La base de l'ancien prototype n'est pas transférée automatiquement.
