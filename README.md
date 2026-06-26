POS Local — Gestion de magasin (Frontend-only)

Ce projet est une application Web autonome qui utilise PouchDB pour stocker les données localement dans le navigateur. Elle permet de gérer : caisse/ventes, produits, stock, entrepôt, personnel et devis. Les montants sont en Ariary (Ar).

Lancer localement

1. Ouvrir `index.html` dans un navigateur moderne (Chrome, Edge, Firefox).
2. Créer un compte dans l'onglet d'authentification, puis se connecter.

Fonctionnalités principales

- Authentification locale (mot de passe haché via PBKDF2)
- CRUD produits
- Enregistrer ventes (met à jour le stock)
- Gérer entrepôts et personnel
- Créer des devis (devis stockés localement)
- Export / import JSON de la base locale
- Générateur de code local: télécharge un fichier JSON contenant un code à usage local
- Option de synchronisation avec un CouchDB distant (saisir URL complète comme `https://user:pass@host:5984/dbname`) — sync live/retry

Sécurité & limitations

- Tout est stocké localement dans IndexedDB via PouchDB. Ne pas considérer comme sécurisé pour des environnements critiques sans audit.
- Le hachage PBKDF2 implémenté côté client sert à éviter le stockage de mots de passe en clair, mais la sécurité dépend du navigateur.

Prochaines étapes possibles

- Ajouter recherche et pagination
- Ajouter rapports et impressions de tickets
- Ajouter permissions et rôles utilisateur

Tests automatisés (Playwright)

1. Installer Node.js (>=14) et initialiser un projet :

```bash
npm init -y
```

2. Installer Playwright (chromium) :

```bash
npm i -D @playwright/test
npx playwright install chromium
```

3. Lancer le test (le script ouvre `index.html` via `file://`) :

```bash
npx playwright test tests/playwright-test.js
```

Remarques :
- Si votre environnement bloque l'accès `file://`, servez le dossier local via un petit serveur HTTP, par exemple :

```bash
python -m http.server 8000
# puis ouvrir http://localhost:8000/index.html ou adapter le test pour utiliser http://localhost:8000/
```


