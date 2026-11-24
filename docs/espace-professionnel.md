# MakeYourStory PRO

L’espace `/pro/` est distinct de l’administration et de l’espace personnel des clients. La page publique `professionnels.html` propose la demande d’accès et la connexion. L’identité est vérifiée par le même lien personnel à usage unique que l’espace client.

## Activation

Une inscription crée un compte en attente et envoie un lien de vérification à son propriétaire. La répétition d’une demande publique ne modifie pas les informations d’un compte existant. Les comptes administrateurs ne deviennent pas des comptes partenaires.

Dans Administration → Professionnels, MakeYourStory peut ajouter un compte, examiner ses informations déclarées, l’activer, le suspendre et convenir d’une date de fin d’accès. La suspension ou l’échéance bloque immédiatement les prochaines requêtes du professionnel, y compris les fichiers, le studio et les écritures provenant d’un onglet déjà ouvert. Les clients conservent leur accès et les créations publiées restent disponibles jusqu’à leur échéance normale. Les aperçus temporaires émis au professionnel sont également bloqués.

L’activation du compte professionnel reste administrée. Les achats sont configurés séparément dans Administration → Professionnels → Offres et abonnements. La création déléguée est toujours sur devis, en supplément.

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

## Achats à l’unité et abonnement

La migration `008-professional-billing.sql` ajoute le catalogue PRO, les tentatives Checkout, les abonnements, les droits de création et le journal des notifications Stripe. Les deux tarifs de lancement proposés (19,90 € à l’unité ; 29,90 €/mois pour cinq créations) sont **fermés à l’achat par défaut**. L’administrateur peut modifier le prix et le quota puis ouvrir chaque formule depuis `/admin/offres-pro`. Un tarif fermé ne produit aucun produit ou prélèvement Stripe. Une ouverture vérifie la présence de toutes les notifications de facturation requises ; les prix Stripe sont créés uniquement à cette activation. Le tarif et le quota des abonnements existants sont conservés lors d’un changement du catalogue.

Après activation du compte, le professionnel choisit sa formule dans `/pro/offres`. Le paiement unique achète une création à utiliser une fois, sans abonnement. Le forfait est un abonnement mensuel fixe : cinq nouvelles créations par période payée au tarif proposé, quota non reportable. Ce n’est pas de la facturation à l’usage : aucun dépassement n’est prélevé automatiquement. Après épuisement, le professionnel peut acheter une création à l’unité. La création déléguée consomme également une place et sa réalisation nécessite toujours un devis distinct.

Les droits sont attribués exclusivement après réception d’une notification Stripe signée et vérification du titulaire, du montant, de la devise, de la formule et de l’encaissement. Le retour du navigateur ne donne aucun droit. Une facture d’abonnement simplement marquée payée manuellement, sans PaymentIntent encaissé, n’ouvre pas de quota. Les notifications sont idempotentes. La consommation d’une place et la création du projet partagent une transaction sous verrou du compte professionnel, empêchant les créations simultanées au-delà du quota. Les projets déjà ouverts sont préservés lorsque les droits expirent.

Le portail de facturation Stripe permet de consulter les factures, de mettre à jour le moyen de paiement et d’arrêter le renouvellement à la fin de la période. Il n’autorise ni changement libre de produit ni modification des quantités. Ce portail reste accessible au professionnel suspendu pour qu’il puisse gérer son abonnement. La fin d’abonnement, les impayés, remboursements et alertes de fraude bloquent les nouvelles créations concernées ; les clients et leurs invitations déjà livrées sont préservés. Un incident est signalé à MakeYourStory. L’administrateur peut clore la vérification pour les prochaines périodes réglées, sans rétablir de droits remboursés, et offrir des créations avec un motif journalisé.

Les encaissements PRO sont séparés des commandes des clients : le professionnel est l’acheteur de son outil, le client ne reçoit aucune fausse facture de la plateforme. Les factures et reçus Stripe sont accessibles dans « Mes offres ». La mention de TVA configurée pour MakeYourStory est affichée ; aucune collecte de TVA ni Stripe Tax n’est activée par cette modification.

### Événements requis sur le webhook existant

Conserver les événements de paiement existants et ajouter :

- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`
- `charge.dispute.created`, `radar.early_fraud_warning.created`

Le webhook conserve son URL et son secret. Pour un remboursement, litige ou signalement, le PaymentIntent est relié à ses InvoicePayments, puis à l’Invoice et à sa Subscription. Les nouveaux achats doivent rester fermés tant que les tarifs proposés ne sont pas validés.
