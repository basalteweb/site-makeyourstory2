# Studio de création MakeYourStory

Le studio interne est accessible dans l’administration, puis dans chaque commande réglée. Il permet de partir d’un dossier programmé sur mesure ou d’une composition personnalisable facultative.

## Préparer une création

1. Ouvrir la commande et consulter les informations et photos transmises.
2. Choisir « Créer ma composition » dans un studio encore vide, avec l’une des trois ambiances. Les informations et jusqu’à six photos confirmées sont copiées dans une version indépendante. Autre possibilité : programmer la création avec `index.html` à la racine et importer le dossier ZIP dans « Ma création ».
3. Ouvrir « Studio de création » et choisir la version de travail.
4. Ajuster les textes statiques de `index.html`, les variables de couleur CSS au format `#RRGGBB`, les fichiers image et les animations proposées sur les titres et images.
5. Vérifier l’aperçu en largeur mobile puis ordinateur. Les essais sont privés et temporaires, pendant 15 minutes au maximum. « Actualiser l’aperçu » les recrée au besoin.
6. Enregistrer une nouvelle version. Cette action n’envoie aucun e-mail et ne change ni la version proposée au client, ni celle publiée.
7. Après vérification, proposer explicitement la version au client pour validation. Publier ensuite depuis « Ma création », une fois la version validée.

Les effets visuels du studio respectent la préférence de réduction des animations. Les animations JavaScript et les textes générés par un script se retouchent dans le code. `data-mys-label` donne un libellé explicite à un bloc et `data-mys-lock` exclut une zone gérée par des scripts de l’édition visuelle. Le studio affiche au maximum 120 fragments de texte, 60 variables de couleur et 30 blocs animables. Ces limites ne suppriment aucun élément du dossier.

## Photos originales et retouchées

La galerie contient les photos confirmées par le client. Chaque original est téléchargeable. Pour une retouche externe, sélectionner la photo de départ puis importer un JPG, PNG ou WebP jusqu’à 12 Mo. La relation avec la photo de départ est conservée ; l’original reste inchangé. Les retouches intermédiaires sont réservées à l’administration.

Dans l’onglet Images, choisir un original ou une retouche pour remplacer un fichier image de la création. Ce remplacement fonctionne également pour un fichier employé en fond CSS. Si un fichier est utilisé à plusieurs endroits, tous ces usages prendront la nouvelle image. Pour ajouter un emplacement ou modifier le cadrage, retoucher le dossier de code.

Les médias choisis sont copiés dans la nouvelle version autonome. Une modification ou suppression ultérieure du fichier de travail ne remplace donc pas silencieusement la photographie de la version validée.

## Exporter, retoucher et réimporter

« Télécharger le dossier ZIP » exporte la version enregistrée sélectionnée, avec HTML, CSS, JavaScript et médias. Les essais non enregistrés ne sont pas exportés. Le dossier peut être retouché dans l’éditeur habituel puis réimporté comme nouvelle version. Le studio accepte un dossier jusqu’à 40 Mo pour garantir sa réimportation dans la limite ZIP existante de 45 Mo. Le plafond actuel est de 20 versions par projet ; aucune version précédente n’est écrasée automatiquement.

Les paramètres d’animation sont inclus dans le HTML exporté ; les scripts propres à la création sont conservés. Les formulaires de réponse restent hébergés et gérés par MakeYourStory : exporter le code ne transporte pas une base RSVP utilisable hors connexion.

## Relier un bouton au RSVP réel

```html
<button type="button" data-mys-rsvp>Répondre à notre invitation</button>
```

Sur l’invitation publiée, la fonction commune ouvre le formulaire associé à cet événement. Aucun identifiant ni clé n’est à inscrire dans le code. Les RSVP doivent être activés. Le conteneur conserve également un accès commun au formulaire. L’invitation reste isolée dans une iframe sans accès aux sessions ou à l’administration ; un message reçu d’une autre fenêtre ne peut pas déclencher cette navigation.

## Livraison et invités

Après validation puis publication, le client retrouve le lien et un QR code dans « Ma création », et reçoit la notification de publication. Le lien se partage sans quota de diffusion prévu par l’application. Il reste soumis à la durée de publication de la commande, actuellement 12 mois par défaut ; ce n’est pas un hébergement perpétuel. Toute personne possédant ce lien peut consulter la création et le transmettre.

Les invités n’accèdent jamais à l’espace privé du client. Le formulaire recueille présence ou refus, adultes, enfants, accompagnants si activés, message et informations alimentaires facultatives si activées avec consentement séparé. Un lien personnel permet de modifier la réponse jusqu’à la clôture. Le client retrouve les réponses, messages, statistiques et export CSV dans « Mes invités ».

Jusqu’à cinq questions facultatives peuvent être ajoutées : oui/non, choix parmi 2 à 8 propositions, ou texte libre. Le libellé et la réponse sont conservés ensemble et inclus dans l’export Excel. Ne pas utiliser ces questions pour remplacer le champ alimentaire et son consentement.

Chaque invité ayant répondu dispose aussi d’une conversation privée avec les organisateurs, accessible uniquement par son lien personnel. Le client ouvre « Échanger » sur la réponse concernée. Les formulaires sont idempotents, limités en fréquence et plafonnés à 100 messages par réponse. L’invité peut actualiser la conversation pour lire la réponse ; aucune notification par e-mail n’est envoyée à l’invité, qui n’a pas à fournir d’adresse. Les organisateurs peuvent recevoir une notification si leur option est active. La conversation reste disponible après la date limite RSVP tant que les interactions et la publication sont actives. Dépublier, archiver ou désactiver les interactions ferme l’accès invité.

La liste nominative accepte un nom ou foyer à la fois, ou jusqu’à 100 lignes à la fois. Réimporter les mêmes noms ne les duplique pas. Les liens individuels ouvrent la création puis son formulaire prérempli. Un lien de foyer correspond à une réponse ; utiliser des lignes distinctes pour des réponses indépendantes.

Le titre, le lieu et les informations pratiques de l’événement alimentent le bouton d’itinéraire et le fichier calendrier ICS. Le calendrier réserve la journée entière ; les horaires restent indiqués dans l’invitation et les informations pratiques. Aucune adresse n’est transmise à Google avant un clic sur l’itinéraire. L’invitation publique propose ces actions dans une barre dédiée, sans menus d’administration.

Dans « Ma création », le client dispose d’un aperçu intégré, du QR code affiché, d’un message prêt à copier, du partage natif, d’un lien WhatsApp et d’un e-mail prérempli. Ces liens n’envoient aucun message automatiquement.

Les données alimentaires sont effacées sept jours après l’événement. Aucun détail alimentaire n’est repris dans les notifications. Pour les réponses en attente, la liste facultative des invités et les liens individuels évitent d’afficher un compteur inventé.

## Périmètre et sécurité

Les réglages sont contrôlés côté serveur, y compris l’appartenance des fichiers au projet. Une couleur ne peut pas injecter une URL ou du code CSS ; un texte ne devient pas du HTML exécutable. Les sauvegardes de version sont idempotentes et transactionnelles ; les fichiers créés lors d’un échec sont nettoyés. Les aperçus sont temporaires, non indexables et plafonnés en mémoire. Aucun original, média, texte client, secret ou réponse d’invité ne doit être ajouté au dépôt GitHub public.

La migration `003-studio.sql` est additive : provenance des retouches et identifiant d’enregistrement des versions. Elle ne modifie aucun paiement, propriétaire ou statut de publication.

La migration additive `004-guest-experience.sql` ajoute les informations pratiques, les questions, les réponses complémentaires et les conversations invitées. `sudo bash bin/deployer-studio.sh` conserve l’image précédente, sauvegarde PostgreSQL, construit l’application, applique les migrations et attend une application saine. Les médias et les paiements restent dans leurs volumes et services existants. Les données de démonstration du script `tests/preview.mjs` sont isolées en mémoire et ne font jamais partie du démarrage de production.
