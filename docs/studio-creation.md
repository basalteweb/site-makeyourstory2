# Studio de création MakeYourStory

Le studio interne est accessible dans l’administration, puis dans chaque commande réglée. Il permet de partir d’un dossier programmé sur mesure ou d’une composition personnalisable facultative.

## Préparer une création

1. Ouvrir la commande et consulter les informations et photos transmises.
2. Choisir « Créer ma composition » dans un studio encore vide, avec l’une des trois ambiances. Les informations et jusqu’à vingt photos de la sélection transmise sont copiées dans une version indépendante (32 Mo de photos au total maximum). Autre possibilité : programmer la création avec `index.html` à la racine et importer le dossier ZIP dans « Ma création ».
3. Suivre les cinq étapes : projet, photos et emplacements, textes, style, vérification et livraison. Les administrateurs ouvrent uniquement l’administration ; leurs rubriques distinguent clairement la création, les éléments, les messages et les invités du client.
4. Ajuster les textes statiques, les couleurs, chaque emplacement de photo et les animations proposées. Le brouillon, son étape et son nom se sauvegardent automatiquement. La protection de révision empêche deux onglets d’écraser leurs changements. Le brouillon reste distinct des versions proposées et publiées.
5. Vérifier l’aperçu en largeur mobile puis ordinateur. Chaque URL d’aperçu expire après 15 minutes ; « Actualiser l’aperçu » la recrée depuis les réglages conservés dans le brouillon.
6. Enregistrer une nouvelle version. Cette action n’envoie aucun e-mail et ne change ni la version proposée au client, ni celle publiée.
7. Après vérification, proposer explicitement la version au client pour validation. Publier ensuite depuis « Ma création », une fois la version validée.

Les effets visuels du studio respectent la préférence de réduction des animations. Les animations JavaScript et les textes générés par un script se retouchent dans le code. `data-mys-label` donne un libellé explicite à un bloc et `data-mys-lock` exclut une zone gérée par des scripts de l’édition visuelle. Le studio affiche au maximum 120 fragments de texte, 60 variables de couleur et 30 blocs animables. Ces limites ne suppriment aucun élément du dossier.

Le panneau « Réponses du client » reste accessible à côté des réglages et s’ouvre automatiquement à l’étape Textes sur ordinateur. Il reprend les questions de l’offre commandée, avec l’histoire, les noms, les dates, les lieux et les préférences transmis. La recherche et la copie d’une réponse permettent de rédiger sans quitter le studio. Sur mobile, le panneau repliable reste à portée pendant l’édition. Les brouillons de préparation que le client n’a pas envoyés n’y figurent pas ; la copie ne remplace aucun texte automatiquement.

## Photos originales et retouchées

La bibliothèque contient la sélection confirmée par le client et les photos ajoutées dans le studio. Le sélecteur accepte jusqu’à 20 photos à la fois, envoyées séparément avec reprise et identifiant évitant les doublons. Chaque photo JPG, PNG ou WebP est limitée à 12 Mo, dans les limites de stockage du projet. Pour une retouche externe, sélectionner la photo de départ puis importer sa version retouchée. L’original reste inchangé. Les ajouts du studio et les retouches intermédiaires sont réservés à l’administration jusqu’à leur incorporation dans une création livrée.

À l’étape Photos et emplacements, chaque image HTML non protégée reçoit un emplacement indépendant, même si plusieurs emplacements utilisaient le même fichier. Choisir sa photo, conserver son cadrage ou sélectionner « Remplir le cadre » / « Voir toute la photo », puis son centrage. Les images d’arrière-plan restent proposées séparément comme remplacement de fichier.

Une nouvelle galerie peut contenir jusqu’à 20 photos, avec légendes et ordre modifiables, en une, deux ou trois colonnes sur ordinateur et une colonne sur mobile. Elle se place après la couverture, après le récit, avant les informations ou avant la signature. Dans un dossier sur mesure qui ne possède pas de section `cover`, `story` ou `details`, elle est insérée avant le pied de page. Après enregistrement, ses images deviennent à leur tour des emplacements indépendants. Le studio inspecte jusqu’à 60 emplacements de photo, sans modifier les zones `data-mys-lock`.

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

Après le règlement, le client est guidé dans « Ma préparation », avec un accueil adapté à son offre. Pour un mariage, il renseigne les noms et prénoms, puis raconte sa rencontre, ses débuts, ses étapes et sa complicité, avant les informations pratiques et les photos. Les autres catégories ont leurs propres questions. Le récit reste facultatif ; une information encore inconnue peut être signalée lorsque cette option est proposée. Chaque étape se sauvegarde, avec un bouton pour faire une pause et reprendre. Les brouillons restent privés jusqu’à la validation du récapitulatif et l’envoi explicite. Le studio reçoit alors les informations et la sélection confirmée, sans remplacer une version déjà publiée.

Les repères photos suivent l’offre : cinq photos de couple conseillées, avec portraits individuels facultatifs ; trois à cinq photos conseillées pour naissance ou anniversaire ; un portrait peut suffire pour un hommage. Ces créations peuvent aussi être réalisées sans photo. Les albums acceptent respectivement une à dix photos (Mini) et dix à vingt photos (Complet). Le client peut transmettre ses photos plus tard. Les fichiers JPG, PNG et WebP sont limités à 12 Mo chacun ; retirer une photo de la sélection conserve l’original et permet de la remettre. La navigation privée ne contient pas « Tarifs » et son historique n’affiche que des informations compréhensibles par le client.

Après validation puis publication, le client retrouve le lien et un QR code dans « Ma création », et reçoit la notification de publication. Le lien se partage sans quota de diffusion prévu par l’application. Il reste soumis à la durée de publication de la commande, actuellement 12 mois par défaut ; ce n’est pas un hébergement perpétuel. Toute personne possédant ce lien peut consulter la création et le transmettre.

Les invités n’accèdent jamais à l’espace privé du client. Le formulaire recueille présence ou refus, adultes, enfants, accompagnants si activés, message et informations alimentaires facultatives si activées avec consentement séparé. Un lien personnel permet de modifier la réponse jusqu’à la clôture. Le client retrouve les réponses, messages, statistiques et export CSV dans « Mes invités ».

Le tableau de bord sépare Vue d’ensemble, Réponses, Messages, Liste des invités et Réglages. Le taux est le nombre d’invitations personnelles ayant reçu une réponse (présence ou refus), divisé par le nombre de personnes ou foyers de la liste. Sans liste, aucun pourcentage n’est affiché. Les réponses du lien général comptent dans les participants et restent consultables, sans augmenter ce taux. Le compteur de conversations à lire inclut les messages initiaux et les nouvelles questions ; seule l’ouverture d’une conversation les marque comme lus.

La rubrique Réservations regroupe les réponses pratiques des participants. Une question de quantité accepte de 0 à 30 unités et totalise les demandes ; les choix oui/non ou de menu sont comptés, avec le détail de chaque foyer. Ce sont les demandes transmises aux organisateurs, sans encaissement ni gestion d’un stock de places. Les libellés et types des réponses sont conservés pour ne pas mélanger des questions renommées. Toutes les réponses restent dans l’export CSV. Une première publication d’invitation de mariage ou d’anniversaire active le RSVP si aucun réglage explicite n’a encore été enregistré ; un choix de désactivation est respecté.

Les petits « ? » de la préparation et des champs de configuration expliquent l’usage et montrent un exemple. Ils s’ouvrent au clic ou au clavier, dans le formulaire, et se referment avec Échap. Le contact demandé dans la préparation est facultatif et destiné aux invités, avec indication claire de sa diffusion sur la création.

Jusqu’à cinq questions facultatives peuvent être ajoutées : oui/non, choix parmi 2 à 8 propositions, ou texte libre. Le libellé et la réponse sont conservés ensemble et inclus dans l’export Excel. Ne pas utiliser ces questions pour remplacer le champ alimentaire et son consentement.

Chaque invité ayant répondu dispose aussi d’une conversation privée avec les organisateurs, accessible uniquement par son lien personnel. Le client ouvre « Échanger » sur la réponse concernée. Les formulaires sont idempotents, limités en fréquence et plafonnés à 100 messages par réponse. L’invité peut actualiser la conversation pour lire la réponse ; aucune notification par e-mail n’est envoyée à l’invité, qui n’a pas à fournir d’adresse. Les organisateurs peuvent recevoir une notification si leur option est active. La conversation reste disponible après la date limite RSVP tant que les interactions et la publication sont actives. Dépublier, archiver ou désactiver les interactions ferme l’accès invité.

La liste nominative accepte un nom ou foyer à la fois, ou jusqu’à 100 lignes à la fois. Réimporter les mêmes noms ne les duplique pas. Les liens individuels ouvrent la création puis son formulaire prérempli. Un lien de foyer correspond à une réponse ; utiliser des lignes distinctes pour des réponses indépendantes.

Le titre, le lieu et les informations pratiques de l’événement alimentent le bouton d’itinéraire et le fichier calendrier ICS. Le calendrier réserve la journée entière ; les horaires restent indiqués dans l’invitation et les informations pratiques. Aucune adresse n’est transmise à Google avant un clic sur l’itinéraire. L’invitation publique propose ces actions dans une barre dédiée, sans menus d’administration.

Dans « Ma création », le client dispose d’un aperçu intégré, du QR code affiché, d’un message prêt à copier, du partage natif, d’un lien WhatsApp et d’un e-mail prérempli. Ces liens n’envoient aucun message automatiquement.

Les données alimentaires sont effacées sept jours après l’événement. Aucun détail alimentaire n’est repris dans les notifications. Pour les réponses en attente, la liste facultative des invités et les liens individuels évitent d’afficher un compteur inventé.

## Périmètre et sécurité

Les réglages sont contrôlés côté serveur, y compris l’appartenance des fichiers au projet. Une couleur ne peut pas injecter une URL ou du code CSS ; un texte ne devient pas du HTML exécutable. Les sauvegardes de version sont idempotentes et transactionnelles ; les fichiers créés lors d’un échec sont nettoyés. Les aperçus sont temporaires, non indexables et plafonnés en mémoire. Aucun original, média, texte client, secret ou réponse d’invité ne doit être ajouté au dépôt GitHub public.

La migration `003-studio.sql` est additive : provenance des retouches et identifiant d’enregistrement des versions. Elle ne modifie aucun paiement, propriétaire ou statut de publication.

La migration additive `004-guest-experience.sql` ajoute les informations pratiques, les questions, les réponses complémentaires et les conversations invitées. `005-guided-preparation.sql` ajoute la préparation guidée, l’identifiant d’envoi des photos et les marqueurs de lecture. `sudo bash bin/deployer-studio.sh` conserve l’image précédente, sauvegarde PostgreSQL, construit l’application, applique les migrations et attend une application saine. Les médias et les paiements restent dans leurs volumes et services existants. Les données de démonstration du script `tests/preview.mjs` sont isolées en mémoire et ne font jamais partie du démarrage de production.

La migration `006-guided-studio.sql` ajoute le brouillon de conception et le repère de configuration explicite des RSVP. Le moteur de réglages et les étapes de conception sont séparés de l’autorisation administrative pour être réutilisables ultérieurement dans un espace partenaire. Aucun rôle partenaire, abonnement ni accès supplémentaire aux projets n’est créé par cette évolution : une future intégration devra appliquer son propre périmètre de projets avant d’appeler ce moteur.
