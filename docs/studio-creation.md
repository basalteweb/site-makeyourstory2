# Studio de création MakeYourStory

Le studio interne est accessible dans l’administration, puis dans chaque commande réglée. Il modifie le dossier programmé pour le projet. Il ne génère pas une invitation à partir d’un modèle imposé.

## Préparer une création

1. Ouvrir la commande et consulter les informations et photos transmises.
2. Programmer la création, avec `index.html` à la racine et les chemins relatifs des fichiers CSS, JavaScript et médias. Importer ce dossier au format ZIP dans « Ma création ».
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

Les invités n’accèdent jamais à l’espace privé du client. Le formulaire recueille présence ou refus, adultes, enfants, accompagnants si activés, message et informations alimentaires facultatives si activées avec consentement séparé. Un lien personnel permet de modifier la réponse jusqu’à la clôture. Le client retrouve les réponses, messages, statistiques et export CSV dans « Mes invités ». Le message est attaché à la réponse ; il n’existe pas de discussion instantanée aller-retour avec l’invité dans ce lot.

Les données alimentaires sont effacées sept jours après l’événement. Aucun détail alimentaire n’est repris dans les notifications. Pour les réponses en attente, la liste facultative des invités et les liens individuels évitent d’afficher un compteur inventé.

## Périmètre et sécurité

Les réglages sont contrôlés côté serveur, y compris l’appartenance des fichiers au projet. Une couleur ne peut pas injecter une URL ou du code CSS ; un texte ne devient pas du HTML exécutable. Les sauvegardes de version sont idempotentes et transactionnelles ; les fichiers créés lors d’un échec sont nettoyés. Les aperçus sont temporaires, non indexables et plafonnés en mémoire. Aucun original, média, texte client, secret ou réponse d’invité ne doit être ajouté au dépôt GitHub public.

La migration `003-studio.sql` est additive : provenance des retouches et identifiant d’enregistrement des versions. Elle ne modifie aucun paiement, propriétaire ou statut de publication.
