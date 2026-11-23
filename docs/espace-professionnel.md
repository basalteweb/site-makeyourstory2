# MakeYourStory PRO

L’espace `/pro/` est distinct de l’administration et de l’espace personnel des clients. La page publique `professionnels.html` propose la demande d’accès et la connexion. L’identité est vérifiée par le même lien personnel à usage unique que l’espace client.

## Activation

Une inscription crée un compte en attente et envoie un lien de vérification à son propriétaire. La répétition d’une demande publique ne modifie pas les informations d’un compte existant. Les comptes administrateurs ne deviennent pas des comptes partenaires.

Dans Administration → Professionnels, MakeYourStory peut ajouter un compte, examiner ses informations déclarées, l’activer, le suspendre et convenir d’une date de fin d’accès. La suspension ou l’échéance bloque immédiatement les prochaines requêtes du professionnel, y compris les fichiers, le studio et les écritures provenant d’un onglet déjà ouvert. Les clients conservent leur accès et les créations publiées restent disponibles jusqu’à leur échéance normale. Les aperçus temporaires émis au professionnel sont également bloqués.

L’activation est administrée pour cette première version. Aucun abonnement Stripe, tarif mensuel, prélèvement ou forfait de création déléguée n’est créé automatiquement. Ces paramètres commerciaux devront être convenus avant d’automatiser la facturation.

## Projet autonome

Le professionnel renseigne le nom et l’e-mail du client, choisit une création et confirme que ce dernier lui a confié ce projet. La création est idempotente. Le dossier apparaît dans ses projets et dans sa liste de clients ; il n’accède jamais aux autres commandes du même client ni à celles d’un autre partenaire.

Le bouton « Envoyer son accès au client » adresse au client un lien personnel de connexion. Une relance dans les cinq minutes ne produit pas de second envoi. Le professionnel ne voit jamais le lien de connexion ni la session du client. Le lien de préparation copiable demande une connexion au client.

Le client suit la préparation guidée existante, transmet ses photos et valide la version proposée depuis son propre espace. Le professionnel retrouve les réponses transmises dans le studio, peut composer, importer, retoucher, enregistrer et proposer des versions, puis publier uniquement après la validation du client. Les RSVP, réservations, messages et exports restent associés au projet et sont accessibles au client et au professionnel chargé de sa création.

Les messages et les notifications relatifs au travail autonome sont adressés au professionnel chargé du projet. Les messages de celui-ci affichent son nom d’activité. Les e-mails de connexion et les notifications ne sont pas exposés dans son espace.

## Projet délégué

La délégation peut être choisie à la création ou demandée ensuite. MakeYourStory reçoit une demande ; les modalités et la prise en charge doivent être explicitement confirmées par l’administrateur. Tant que la demande n’est pas acceptée, le professionnel peut la reprendre en autonomie. Une demande refusée rend le studio modifiable au professionnel.

Pour un projet délégué, le professionnel consulte les informations et les versions en lecture seule. Les écritures sont bloquées côté serveur. MakeYourStory réalise la création dans son administration, en conservant la validation du client avant publication.

## Isolation et comptes

`007-professionals.sql` ajoute `professional_accounts`, l’association `professional_projects` et la destination des liens de connexion. Toutes les routes professionnelles relisent la session, l’activation, l’échéance et l’appartenance du projet. Les moteurs du studio et du suivi invités sont réutilisés avec ce périmètre explicite, sans accorder de privilège administrateur au professionnel.

Les dossiers professionnels portent la source `professional` et le statut `included`. Ils n’ont ni encaissement Stripe ni `paid_at` artificiel. Le montant catalogue reste une référence interne ; l’interface client présente un accompagnement professionnel. Aucun justificatif de paiement n’est émis et le rapprochement Stripe est bloqué pour ces dossiers. Les encaissements et remboursements existants restent calculés sur les montants réellement enregistrés.

La migration conserve les données existantes. Le script de déploiement sauvegarde PostgreSQL, conserve l’image précédente et contrôle les nouvelles tables avant le redémarrage.
