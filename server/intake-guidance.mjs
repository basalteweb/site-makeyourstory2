const guide=(text,example)=>({text,example});

export function intakeGuidance(order,step,field) {
  const kind=order.category;
  const common={
    first:guide('Le prénom à écrire dans votre invitation, avec son orthographe et ses accents.','Camille'),
    second:guide('Le prénom de la deuxième personne, tel qu’il doit apparaître dans votre invitation.','Julien'),
    first_last:guide('Le nom de famille à faire apparaître. Si vous préférez seulement vos prénoms, cochez l’option au-dessus.','Martin'),
    second_last:guide('Le nom de famille de la deuxième personne. L’option « uniquement nos prénoms » permet de ne pas le renseigner.','Durand'),
    person_last:guide('Ajoutez le nom de famille si vous souhaitez l’afficher. Vous pouvez laisser ce champ vide.','Martin'),
    age:guide('L’âge qui sera célébré. Précisez si vous préférez ne pas le faire apparaître.','40 ans, à afficher sur l’invitation'),
    family:guide('Citez seulement les membres de la famille que vous souhaitez mentionner sur le faire-part.','Camille et Julien, et son grand frère Louis'),
    measures:guide('Ces détails sont facultatifs. Indiquez le poids et la taille à la naissance, avec leurs unités.','3,340 kg et 50 cm'),
    dates:guide('Écrivez les dates ou les années que vous souhaitez faire apparaître, dans la présentation de votre choix.','1950 – 2026'),
    title:guide('Quelques mots pour la couverture de votre album. Un prénom, un événement ou un lieu suffisent.','Notre été en famille · 2026'),
    addresses:guide('L’adresse permettra aux invités de retrouver le lieu. Précisez la rue, le code postal et la ville.','[numéro et rue], 63000 Clermont-Ferrand'),
    reception_place:guide('Le nom du lieu où se dérouleront le cocktail, le repas ou les festivités après la cérémonie.','Domaine des Lilas · salle de réception'),
    reception_address:guide('L’adresse de la réception, surtout si elle se déroule ailleurs que la cérémonie.','[numéro et rue], [code postal et ville]'),
    reception_time:guide('L’heure à partir de laquelle les invités doivent rejoindre la réception.','Cocktail à 18 h, dîner à 20 h'),
    agenda:guide('Décrivez les temps forts dans l’ordre, avec les horaires déjà connus. Nous nous en servirons pour présenter le programme.','15 h : cérémonie · 18 h : cocktail · 20 h : dîner'),
    deadline:guide('Le dernier jour souhaité pour recevoir les réponses des invités. Choisissez une date avant l’événement pour vous organiser. Vous pourrez la modifier dans les réglages des invités.','Pour une fête le 20 août, demander une réponse avant le 1er août'),
    contact:guide('Un téléphone ou un e-mail que vos invités pourront utiliser pour poser une question : celui des mariés, d’un témoin ou de l’organisateur. Indiquez uniquement des coordonnées que vous souhaitez faire apparaître sur la création partagée. Ce champ est facultatif.','Camille, notre témoin : camille@example.com'),
    dress:guide('Une indication utile pour choisir sa tenue : style, couleurs ou thème. Laissez vide s’il n’y a aucune consigne.','Tenue chic et décontractée ; des chaussures adaptées au jardin'),
    details:guide('Les renseignements pratiques qui aideront vos proches à s’organiser. Écrivez seulement ce qui est utile pour votre événement.','Parking sur place, accès par le portail côté jardin, brunch le lendemain à 11 h'),
    mood:guide('Décrivez le style et l’émotion que vous aimez en quelques mots. Aucun vocabulaire de création n’est nécessaire.','Élégant, naturel et chaleureux, avec une ambiance de jardin'),
    colors:guide('Citez vos couleurs préférées et, si besoin, celles que vous souhaitez éviter. Les noms de couleurs suffisent.','Ivoire, rose poudré et vert sauge ; éviter le rouge')
  };
  if(common[field.key]) return common[field.key];
  if(field.key==='person') return {
    naissance:guide('Le prénom de bébé, avec les accents et l’orthographe souhaités. Si vous le gardez encore secret, cochez l’option pour le préciser plus tard.','Charlie'),
    hommage:guide('Le prénom et le nom tels que vous souhaitez les faire apparaître dans l’hommage.','Marie Martin'),
    anniversaire:guide('Le prénom de la personne à l’honneur, ou le surnom que ses proches utilisent si vous préférez.','Camille')
  }[kind];
  if(field.key==='date') return kind==='naissance'?guide('La date de naissance qui apparaîtra sur le faire-part. Si bébé n’est pas encore arrivé, cochez l’option pour compléter plus tard.','Choisissez le jour, le mois et l’année dans le calendrier'):kind==='album'?guide('Une date symbolique pour la couverture ou le récit. Vous pouvez laisser ce champ vide.','La date du voyage, d’un anniversaire ou des retrouvailles'):guide('La date de l’événement à annoncer à vos proches. Si elle n’est pas encore fixée, utilisez l’option proposée sous les champs.','Choisissez le jour, le mois et l’année dans le calendrier');
  if(field.key==='places') return guide(kind==='mariage'?'Le nom de la mairie, de l’église ou du lieu de cérémonie. Pour plusieurs cérémonies, précisez chaque lieu et son rôle.':'Le nom et l’adresse du lieu où les proches sont attendus. Vous pouvez préciser l’accès si nécessaire.',kind==='mariage'?'Mairie de Clermont-Ferrand, puis cérémonie laïque au Domaine des Lilas':'Salle des Lilas, [adresse et ville]');
  if(field.key==='times') return kind==='naissance'?guide('L’heure de naissance, si vous souhaitez l’afficher. Ce détail est facultatif.','8 h 42'):guide('L’heure à laquelle les invités sont attendus. Pour plusieurs rendez-vous, associez chaque horaire à son moment.','Cérémonie à 15 h 30 ; accueil des invités dès 15 h');
  if(field.key==='story_meeting') return {
    mariage:guide('Racontez où et comment vous vous êtes rencontrés, puis ce qui vous a marqués. Quelques phrases avec vos mots suffisent ; vous pouvez passer cette question.','Nous nous sommes rencontrés chez des amis. Une conversation, puis une longue promenade…'),
    naissance:guide('Partagez une émotion ou un souvenir des premiers jours que vous aimeriez retrouver dans le faire-part. Quelques mots suffisent.','Son premier regard et la rencontre avec son grand frère : un moment tout doux.'),
    hommage:guide('Évoquez un souvenir, une qualité ou une passion de la personne. Prenez votre temps ; cette réponse est facultative.','Sa générosité, ses histoires au coin du feu et les dimanches dans son jardin.'),
    album:guide('Expliquez ce qui relie vos photos : le moment, les personnes ou l’émotion que vous souhaitez conserver.','Notre premier voyage tous ensemble, entre balades et fous rires.')
  }[kind];
  if(field.key==='story_beginnings') return kind==='mariage'?guide('Choisissez un souvenir de vos débuts : premier rendez-vous, voyage ou petit moment qui compte. Il n’est pas nécessaire de raconter toute votre vie.','Notre premier week-end à la mer, avec un pique-nique improvisé sous la pluie.'):guide('Expliquez l’ambiance souhaitée et si la fête doit rester une surprise.','Un anniversaire surprise, joyeux et plein d’anecdotes, entre amis.');
  if(field.key==='story_milestones') return guide('Citez les grandes étapes qui vous tiennent à cœur, dans l’ordre si vous le souhaitez. Les dates exactes ne sont pas indispensables.','Notre emménagement en 2020, notre voyage en Italie, puis la demande en mariage.');
  if(field.key==='story_personality') return guide(kind==='mariage'?'Racontez vos passions, un rituel ou une petite anecdote qui fait sourire vos proches.':'Présentez une passion, un trait de caractère ou une anecdote de la personne à l’honneur.',kind==='mariage'?'Nos randonnées du dimanche, nos playlists et notre passion pour la cuisine.':'Toujours partante pour une aventure et imbattable aux jeux de société.');
  if(field.key==='copy') return {
    mariage:guide('Un texte que vous aimeriez faire apparaître sur l’invitation. Si vous n’avez pas d’idée, laissez vide : nous vous accompagnerons.','Et si l’on écrivait la suite ensemble ?'),
    anniversaire:guide('Le petit mot qui donnera envie de venir fêter ce moment. Vous pouvez nous laisser proposer le texte.','40 ans, des souvenirs et encore tant de choses à partager !'),
    naissance:guide('Votre annonce aux proches : une phrase tendre ou quelques mots de bienvenue suffisent.','Notre famille s’agrandit : bienvenue à Charlie, notre petit bonheur.'),
    hommage:guide('Le texte, la pensée ou les quelques mots que vous souhaitez transmettre. Cette étape peut rester vide si vous préférez être accompagné.','Nous gardons précieusement son sourire et tous les moments partagés.'),
    album:guide('Indiquez l’ordre des photos et les légendes souhaitées. Utilisez les noms des fichiers pour repérer les souvenirs.','Photo « plage.jpg » en couverture ; « famille.jpg » : notre première soirée ensemble.')
  }[kind];
  return guide('Indiquez ce que vous souhaitez retrouver dans votre création, avec vos mots. Vous pourrez relire et modifier cette réponse avant l’envoi.','Quelques mots ou quelques phrases suffisent.');
}
